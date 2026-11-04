/**
 * Vercel AI SDK 适配器：把模型配置变成 `ChatPort`。
 * 只做调用与错误翻译；阶段路由、门禁和重试策略都属于编排层。
 */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, streamText, tool, zodSchema, type ToolSet } from "ai";
import { z } from "zod";

import type { ModelConfig } from "../config/index.js";
import { AppError } from "../shared/errors.js";
import type { ChatPort, ChatTool, ChatUsage, ObjectRequest, ObjectResult, StreamEvent, StreamRequest } from "./chat.js";

export type AiSdkChatOptions = {
  model: ModelConfig;
};

const SUPPORTED_PROVIDERS = ["openai-compatible"] as const;

function usageOf(usage: { inputTokens?: number | undefined; outputTokens?: number | undefined } | undefined): ChatUsage {
  return {
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
  };
}

function asModelError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }
  const detail = error instanceof Error ? error.message : String(error);
  return new AppError("RUNTIME", `模型调用失败：${detail}`, "检查 .env.local 里的接口地址与模型名，确认服务已启动");
}

/** JSON 对象：只保证是对象，字段结构由调用方的 zod schema 负责。 */
type JsonObject = Record<string, unknown>;

/**
 * 从模型输出里取出 JSON 对象。
 * 现实中的模型会带代码围栏、前后说明或多余换行，这里只做「找对象」这一件事，
 * 语法与结构校验交给调用方的 zod schema，不在这里猜字段。
 */
export function extractJsonObject(text: string): JsonObject {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new AppError(
      "RUNTIME",
      "模型输出里没有 JSON 对象",
      "换一个支持普通文本输出的模型，或检查 system 提示是否要求了额外格式",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate.slice(start, end + 1));
  } catch (error) {
    throw new AppError(
      "RUNTIME",
      `模型输出的 JSON 无法解析：${error instanceof Error ? error.message : String(error)}`,
      "检查模型是否把正文写成了多段或被截断（maxTokens 太小）",
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AppError(
      "RUNTIME",
      "模型输出的 JSON 顶层不是对象",
      "结构化阶段要求顶层为对象；检查提示词里的 JSON Schema 是否被改成了数组",
    );
  }
  // SAFETY: 上面已确认 parsed 为 null 之外的 object 且非数组，TS 的 typeof 收窄不覆盖 Record 的键值，故此处断言。
  return parsed as JsonObject;
}

/** 把 zod schema 转成给模型看的 JSON Schema 文本，去掉 draft 声明的 $schema 字段省 token。 */
function schemaJson(schema: z.ZodType): string {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  const { $schema: _ignored, ...rest } = json;
  return JSON.stringify(rest);
}

function describeFailure(error: unknown): string {
  if (error instanceof z.ZodError) {
    const first = error.issues[0];
    const path = first?.path.length ? `${first.path.join(".")}：` : "";
    return `${path}${first?.message ?? "结构不匹配"}`;
  }
  return error instanceof Error ? error.message : String(error);
}

/** 校验模型配置：缺模型名或 provider 不认识时不发请求，直接给可读错误。 */
export function assertUsableModelConfig(model: ModelConfig): void {
  if (!(SUPPORTED_PROVIDERS as readonly string[]).includes(model.provider)) {
    throw new AppError(
      "CONFIG",
      `暂不支持的模型接口类型：${model.provider}`,
      `当前只支持 ${SUPPORTED_PROVIDERS.join("、")}`,
    );
  }
  if (model.modelId.trim() === "") {
    throw new AppError(
      "CONFIG",
      "未配置模型 ID",
      "在 .env.local 里填 WRITING_AGENT_MODEL_ID（Ollama 用 `ollama list` 查看名字）",
    );
  }
}

export function createAiSdkChat(options: AiSdkChatOptions): ChatPort {
  assertUsableModelConfig(options.model);
  const provider = createOpenAICompatible({
    name: options.model.provider,
    baseURL: options.model.baseURL,
    // 本地服务通常不需要 key，但 SDK 要求非空字符串。
    apiKey: options.model.apiKey ?? "not-needed",
  });
  const languageModel = provider.chatModel(options.model.modelId);

  return {
    /**
     * 结构化调用不依赖提供方的 `response_format`：不少 OpenAI 兼容网关并不支持它，
     * 传了就直接 400。这里改为普通文本 + JSON Schema 提示 + zod 校验，解析失败重试一次。
     */
    async generateObject<T>(request: ObjectRequest<T>): Promise<ObjectResult<T>> {
      const basePrompt = [
        request.prompt,
        "",
        `只输出一个 JSON 对象，表示 ${request.schemaName}；不要 Markdown 代码围栏，不要额外解释。`,
        "JSON Schema：",
        schemaJson(request.schema),
      ].join("\n");

      let lastText = "";
      let lastFailure = "";
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const prompt =
          attempt === 0
            ? basePrompt
            : [
                basePrompt,
                "",
                `你上一次的输出无法解析（${lastFailure}）。请重新只输出一个 JSON 对象。`,
                "上一次输出：",
                lastText.slice(0, 2000),
              ].join("\n");

        let text: string;
        let usage: ChatUsage;
        try {
          const result = await generateText({
            model: languageModel,
            system: request.system,
            prompt,
            ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
          });
          text = result.text;
          usage = usageOf(result.usage);
        } catch (error) {
          throw asModelError(error);
        }

        try {
          const object = request.schema.parse(extractJsonObject(text)) as T;
          return { object, usage };
        } catch (error) {
          lastText = text;
          lastFailure = describeFailure(error);
        }
      }

      throw new AppError(
        "RUNTIME",
        `模型未返回可用的 ${request.schemaName} 结构：${lastFailure}`,
        "检查该模型是否能稳定输出 JSON；必要时换模型或在 .env.local 里调小温度",
      );
    },

    async *streamText(request: StreamRequest): AsyncIterable<StreamEvent> {
      const tools = request.tools === undefined ? undefined : toSdkTools(request.tools);
      let result: ReturnType<typeof streamText>;
      try {
        result = streamText({
          model: languageModel,
          system: request.system,
          prompt: request.prompt,
          ...(tools === undefined ? {} : { tools }),
        });
      } catch (error) {
        throw asModelError(error);
      }

      try {
        for await (const part of result.fullStream) {
          switch (part.type) {
            case "text-delta":
              yield { type: "text", text: part.text };
              break;
            case "tool-call":
              yield { type: "tool_call", name: part.toolName, input: part.input };
              break;
            case "error":
              yield {
                type: "error",
                message: part.error instanceof Error ? part.error.message : String(part.error),
              };
              break;
            case "finish":
              yield {
                type: "finish",
                usage: usageOf(part.totalUsage),
                finishReason: part.finishReason,
              };
              break;
            default:
              break;
          }
        }
      } catch (error) {
        throw asModelError(error);
      }
    },
  };
}

/**
 * 把本项目的工具定义翻成 SDK 的 `ToolSet`。
 * SDK 的工具泛型按每个工具的 schema 推导，运行时工具集只能按名查找；
 * 这里在适配器边界做一次显式类型转换，让上层拿到稳定的 `ToolSet`。
 */
type SdkToolFactory = (definition: {
  description: string;
  inputSchema: ReturnType<typeof zodSchema>;
  execute?: (input: unknown) => Promise<unknown>;
}) => ToolSet[string];

// SAFETY: `tool()` 的泛型按每个工具自己的 schema 推导，运行时拿不到逐个工具的静态类型；
// 这里只在适配器边界做一次成组转换，工具定义的形状由上面的 SdkToolFactory 逐字约定。
const sdkToolFactory = tool as unknown as SdkToolFactory;

function toSdkTools(tools: Record<string, ChatTool>): ToolSet {
  const mapped: Record<string, ToolSet[string]> = {};
  for (const [name, definition] of Object.entries(tools)) {
    mapped[name] = sdkToolFactory({
      description: definition.description,
      inputSchema: zodSchema(definition.inputSchema),
      ...(definition.execute === undefined ? {} : { execute: definition.execute }),
    });
  }
  return mapped;
}
