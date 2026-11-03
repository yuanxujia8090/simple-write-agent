/** 真实模型适配：结构化输出映射、prompt 内容、错误透传、配置校验。 */
import { describe, expect, it } from "vitest";

import { AppError } from "../shared/errors.js";
import { assertUsableModelConfig } from "./ai-sdk.js";
import type { ChatPort, ObjectRequest, StreamEvent, StreamRequest } from "./chat.js";
import { createAiWritingModel, PROMPTS } from "./writing-model.js";

type Recorded = { request: ObjectRequest<unknown> };

/** 按 schemaName 返回固定结构化结果，记录每次请求，便于断言 prompt 与 schema。 */
function createFakeChat(
  responder: (request: ObjectRequest<unknown>) => unknown,
): { chat: ChatPort; recorded: Recorded[]; streams: StreamRequest[] } {
  const recorded: Recorded[] = [];
  const streams: StreamRequest[] = [];
  return {
    recorded,
    streams,
    chat: {
      async generateObject<T>(request: ObjectRequest<T>) {
        recorded.push({ request: request as ObjectRequest<unknown> });
        return {
          object: responder(request as ObjectRequest<unknown>) as T,
          usage: { inputTokens: 10, outputTokens: 20 },
        };
      },
      // 流式与工具调用属于 SDK 适配层，这里只保证端口被调用时能拿到事件。
      async *streamText(request: StreamRequest): AsyncIterable<StreamEvent> {
        streams.push(request);
        yield { type: "text", text: "片段" };
        yield { type: "tool_call", name: "searchWeb", input: { query: "x" } };
        yield { type: "finish", usage: { inputTokens: 1, outputTokens: 2 }, finishReason: "stop" };
      },
    },
  };
}

const BRIEF = {
  topic: "跨端同步",
  audience: "独立开发者",
  purpose: "讲清取舍",
  tone: null,
};

const MATERIALS = { items: [{ name: "素材一", sourcePath: null, note: "说明" }] };
const THESIS = {
  candidates: [
    { id: "a", claim: "论点 A", reasoning: "理由", relationToBrief: "相关" },
    { id: "b", claim: "论点 B", reasoning: "理由", relationToBrief: "相关" },
    { id: "c", claim: "论点 C", reasoning: "理由", relationToBrief: "相关" },
  ],
  recommendedId: "a",
  rationale: "推荐理由",
  risks: ["风险一"],
};
const OUTLINE = { title: "标题", chapters: [{ heading: "第一章", goal: "目标" }] };
const DRAFT = { title: "标题", markdown: "# 标题\n\n正文" };
const FACT_REPORT = {
  items: [
    {
      fact: "断言",
      source: null,
      kind: "external_fact",
      verifyStatus: "unverified",
      reasonCode: "missing_source",
    },
  ],
  downgrades: [{ fact: "断言", reasonCode: "missing_source" }],
};
const FINAL = { title: "标题", markdown: "# 标题\n\n改写后" };

function responder(request: ObjectRequest<unknown>): unknown {
  switch (request.schemaName) {
    case "CreativeBrief":
      return BRIEF;
    case "MaterialBatch":
      return MATERIALS;
    case "ThesisCandidates":
      return THESIS;
    case "Outline":
      return OUTLINE;
    case "Draft":
      return DRAFT;
    case "FactReport":
      return FACT_REPORT;
    case "FinalDraft":
      return FINAL;
    default:
      throw new Error(`未预期的 schemaName：${request.schemaName}`);
  }
}

describe("真实模型适配", () => {
  it("每个阶段都用对应 schema 的结构化结果返回领域对象", async () => {
    const { chat, recorded } = createFakeChat(responder);
    const model = createAiWritingModel({ chat });

    const brief = await model.brief({ topic: "跨端同步" });
    expect(brief).toEqual({
      topic: "跨端同步",
      audience: "独立开发者",
      purpose: "讲清取舍",
      tone: null,
    });
    // 领域类型里 constraints 可省略：模型没给就不带这个键
    expect("constraints" in brief).toBe(false);

    const materials = await model.materials({ topic: "跨端同步", supplied: ["notes/a.md"] });
    expect(materials.items).toHaveLength(1);

    const thesis = await model.thesis({ brief, materials });
    expect(thesis.recommendedId).toBe("a");
    expect(thesis.candidates).toHaveLength(3);

    const outline = await model.outline({ brief, thesis });
    expect(outline.chapters[0]?.heading).toBe("第一章");

    const draft = await model.draft({ outline, thesis });
    expect(draft.markdown).toContain("# 标题");

    const factReport = await model.factReport({ draft });
    expect(factReport.downgrades[0]?.reasonCode).toBe("missing_source");

    const final = await model.final({ draft, factReport });
    expect(final.markdown).toContain("改写后");

    expect(recorded.map((item) => item.request.schemaName)).toEqual([
      "CreativeBrief",
      "MaterialBatch",
      "ThesisCandidates",
      "Outline",
      "Draft",
      "FactReport",
      "FinalDraft",
    ]);
    // 每次调用都带同一套系统约束，且温度与 schema 名都显式给出
    for (const { request } of recorded) {
      expect(request.system).toContain("不虚构事实");
      expect(request.temperature).toBe(0.4);
    }
  });

  it("prompt 里带上了上游产物的关键信息", async () => {
    const { chat, recorded } = createFakeChat(responder);
    const model = createAiWritingModel({ chat });

    const brief = await model.brief({ topic: "把知识库变成工作台" });
    expect(PROMPTS.brief({ topic: "把知识库变成工作台" })).toContain("把知识库变成工作台");
    expect(recorded[0]?.request.prompt).toContain("把知识库变成工作台");

    const materials = await model.materials({ topic: "t", supplied: ["notes/a.md", "notes/b.md"] });
    const thesis = await model.thesis({ brief, materials });
    const thesisPrompt = recorded.find((item) => item.request.schemaName === "ThesisCandidates");
    expect(thesisPrompt?.request.prompt).toContain("独立开发者");

    const outline = await model.outline({ brief, thesis });
    const draft = await model.draft({ outline, thesis });
    const factReport = await model.factReport({ draft });
    await model.final({ draft, factReport });
    const finalPrompt = recorded.at(-1)?.request.prompt ?? "";
    expect(finalPrompt).toContain("事实核查");
    expect(finalPrompt).toContain("不新增未核实的事实");
  });

  it("模型调用失败直接抛错，不返回半成品", async () => {
    const chat: ChatPort = {
      async generateObject() {
        throw new AppError("RUNTIME", "模型调用失败：连接被拒绝", "检查接口地址");
      },
      // eslint-disable-next-line require-yield
      async *streamText() {
        yield { type: "error", message: "不会走到这里" };
      },
    };
    const model = createAiWritingModel({ chat });
    await expect(model.brief({ topic: "t" })).rejects.toThrow(AppError);
  });

  it("流式端口能把文本、工具调用与用量事件交出去", async () => {
    const { chat, streams } = createFakeChat(responder);
    const events: StreamEvent[] = [];
    for await (const event of chat.streamText({ system: "s", prompt: "p" })) {
      events.push(event);
    }
    expect(streams).toHaveLength(1);
    expect(events.map((event) => event.type)).toEqual(["text", "tool_call", "finish"]);
    expect(events[1]).toEqual({ type: "tool_call", name: "searchWeb", input: { query: "x" } });
  });
});

describe("模型配置校验", () => {
  const base = {
    provider: "openai-compatible",
    baseURL: "http://localhost:11434/v1",
    modelId: "qwen3:8b",
    apiKey: null,
  };

  it("合法配置通过", () => {
    expect(() => assertUsableModelConfig(base)).not.toThrow();
  });

  it("缺少模型名时给出可读错误", () => {
    expect(() => assertUsableModelConfig({ ...base, modelId: "  " })).toThrow(/未配置模型 ID/);
  });

  it("不支持的接口类型直接拒绝", () => {
    expect(() => assertUsableModelConfig({ ...base, provider: "anthropic" })).toThrow(
      /暂不支持的模型接口类型/,
    );
  });

  it("指定 styleProfile 后 system 含风格正文", async () => {
    const { chat, recorded } = createFakeChat(responder);
    const styleProfile = {
      id: "demo",
      rootDir: "/tmp/demo",
      entryPath: "/tmp/demo/profile.md",
      bodyText: "STYLE_INJECT_MARKER\n短句优先",
    };
    const model = createAiWritingModel({ chat, styleProfile });
    await model.brief({ topic: "测" });
    expect(recorded[0]?.request.system).toContain("STYLE_INJECT_MARKER");
    expect(recorded[0]?.request.system).toContain("写作风格包（demo）");
  });

});
