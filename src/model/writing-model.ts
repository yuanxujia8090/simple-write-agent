/**
 * 真实模型实现的 `WritingModel`：每个阶段一次结构化调用，prompt 只描述该阶段要产出什么。
 * 工具调用与流式事件走 `ChatPort.streamText`，本文件不自己造 Agent Loop。
 */
import { z } from "zod";

import type {
  CreativeBriefContent,
  DraftContent,
  FactReportContent,
  MaterialBatchContent,
  OutlineContent,
  ThesisContent,
} from "../domain/types.js";
import type { ChatPort } from "./chat.js";
import { appendStyleToSystem, type StyleProfile } from "../style/index.js";
import type {
  BriefInput,
  DraftInput,
  FactReportInput,
  FinalBody,
  FinalInput,
  MaterialsInput,
  OutlineInput,
  ThesisInput,
  WritingModel,
} from "../agent/fixed-model.js";

const SYSTEM =
  "你是中文公众号长文写作助手。只输出符合给定结构的结果；不虚构事实、不编造来源、不写真实个人信息。";

const briefSchema = z.object({
  topic: z.string().min(1),
  audience: z.string().min(1),
  purpose: z.string().min(1),
  constraints: z.array(z.string()).optional(),
  tone: z.string().nullable().optional(),
});

const materialsSchema = z.object({
  items: z
    .array(
      z.object({
        name: z.string().min(1),
        sourcePath: z.string().nullable(),
        note: z.string(),
      }),
    )
    .min(1),
});

const thesisSchema = z.object({
  candidates: z
    .array(
      z.object({
        id: z.string().min(1),
        claim: z.string().min(1),
        reasoning: z.string(),
        relationToBrief: z.string(),
      }),
    )
    .min(3)
    .max(5),
  recommendedId: z.string().min(1),
  rationale: z.string(),
  risks: z.array(z.string()),
});

const outlineSchema = z.object({
  title: z.string().min(1),
  chapters: z.array(z.object({ heading: z.string().min(1), goal: z.string().min(1) })).min(1),
});

const draftSchema = z.object({
  title: z.string().min(1),
  markdown: z.string().min(1),
});

const factSchema = z.object({
  items: z.array(
    z.object({
      fact: z.string().min(1),
      source: z.string().nullable(),
      kind: z.enum(["external_fact", "personal_experience", "opinion", "guess"]),
      verifyStatus: z.enum(["verified", "unverified", "disputed"]),
      reasonCode: z
        .enum(["missing_source", "unverifiable", "unverified_material"])
        .nullable(),
    }),
  ),
  downgrades: z.array(
    z.object({
      fact: z.string().min(1),
      reasonCode: z.enum(["missing_source", "unverifiable", "unverified_material"]),
    }),
  ),
});

const finalSchema = z.object({
  title: z.string().min(1),
  markdown: z.string().min(1),
});

function briefPrompt(input: BriefInput): string {
  return `话题：${input.topic}\n\n请生成创作简报：目标读者、写作目的、约束条件、语气。`;
}

function materialsPrompt(input: MaterialsInput): string {
  const supplied =
    input.supplied.length === 0 ? "（用户没有提供素材文件）" : input.supplied.join("\n");
  return `话题：${input.topic}\n用户提供的素材：\n${supplied}\n\n把这批素材整理成可采纳的素材清单，每条给名称、来源路径（没有就 null）和一句说明。`;
}

/** 各阶段 prompt 在这里集中，便于回看「模型到底看到了什么」。 */
export const PROMPTS = {
  brief: briefPrompt,
  materials: materialsPrompt,
  thesis(input: ThesisInput): string {
    return `创作简报：\n${JSON.stringify(input.brief)}\n\n可选素材：\n${JSON.stringify(input.materials.items)}\n\n给出 3–5 个论点候选，标出一个推荐论点，并说明风险。`;
  },
  outline(input: OutlineInput): string {
    return `创作简报：\n${JSON.stringify(input.brief)}\n\n已确认论点：\n${JSON.stringify(input.thesis)}\n\n据此给出文章标题与章节大纲，每章一句目标。`;
  },
  draft(input: DraftInput): string {
    return `标题：${input.outline.title}\n章节大纲：\n${JSON.stringify(input.outline.chapters)}\n论点：\n${JSON.stringify(input.thesis)}\n\n写完整 Markdown 草稿，正文不少于 1200 字；没有来源支撑的外部事实要标注为未核实。`;
  },
  factReport(input: FactReportInput): string {
    return `草稿：\n${input.draft.markdown}\n\n逐条抽取事实性陈述，标出 kind、verifyStatus 与 reasonCode；对缺来源或不可验证的外部事实给出降级改写清单。`;
  },
  final(input: FinalInput): string {
    return `草稿：\n${input.draft.markdown}\n\n事实核查：\n${JSON.stringify(input.factReport)}\n\n按降级清单改写，输出终稿标题与 Markdown 正文；不新增未核实的事实。`;
  },
} as const;

export type AiWritingModelOptions = {
  chat: ChatPort;
  /** 采样温度：结构化阶段偏低，草稿阶段可略高。 */
  temperature?: number;
  /** 本地风格包；注入到 system 提示，不进 git。 */
  styleProfile?: StyleProfile | null;
};

export function createAiWritingModel(options: AiWritingModelOptions): WritingModel {
  const { chat } = options;
  const temperature = options.temperature ?? 0.4;
  const system = appendStyleToSystem(SYSTEM, options.styleProfile);

  const ask = async <T>(request: {
    prompt: string;
    schema: z.ZodType<T>;
    schemaName: string;
  }): Promise<T> => {
    const result = await chat.generateObject({
      system,
      prompt: request.prompt,
      schema: request.schema,
      schemaName: request.schemaName,
      temperature,
    });
    return result.object;
  };

  return {
    brief: async (input) => {
      const brief = await ask({
        prompt: PROMPTS.brief(input),
        schema: briefSchema,
        schemaName: "CreativeBrief",
      });
      // 领域类型里 constraints/tone 是可省略属性；校验结果要按「缺省就不带」的写法落回。
      return {
        topic: brief.topic,
        audience: brief.audience,
        purpose: brief.purpose,
        ...(brief.constraints === undefined ? {} : { constraints: brief.constraints }),
        tone: brief.tone ?? null,
      };
    },

    materials: (input) =>
      ask({
        prompt: PROMPTS.materials(input),
        schema: materialsSchema,
        schemaName: "MaterialBatch",
      }),

    thesis: (input) =>
      ask({
        prompt: PROMPTS.thesis(input),
        schema: thesisSchema,
        schemaName: "ThesisCandidates",
      }),

    outline: (input) =>
      ask({
        prompt: PROMPTS.outline(input),
        schema: outlineSchema,
        schemaName: "Outline",
      }),

    draft: (input) =>
      ask({
        prompt: PROMPTS.draft(input),
        schema: draftSchema,
        schemaName: "Draft",
      }),

    factReport: (input) =>
      ask({
        prompt: PROMPTS.factReport(input),
        schema: factSchema,
        schemaName: "FactReport",
      }),

    final: (input) =>
      ask({
        prompt: PROMPTS.final(input),
        schema: finalSchema,
        schemaName: "FinalDraft",
      }),
  };
}
