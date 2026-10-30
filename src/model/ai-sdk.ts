/**
 * Vercel AI SDK 适配器：把模型配置变成 `ChatPort`。
 * 只做调用与错误翻译；阶段路由、门禁和重试策略都属于编排层。
 */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateObject, streamText, tool, zodSchema, type ToolSet } from "ai";
import type { z } from "zod";

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
    async generateObject<T>(request: ObjectRequest<T>): Promise<ObjectResult<T>> {
      try {
        const result = await generateObject({
          model: languageModel,
          system: request.system,
          prompt: request.prompt,
          schema: zodSchema(request.schema as z.ZodType<T>),
          schemaName: request.schemaName,
          ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
        });
        return { object: result.object as T, usage: usageOf(result.usage) };
      } catch (error) {
        throw asModelError(error);
      }
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
