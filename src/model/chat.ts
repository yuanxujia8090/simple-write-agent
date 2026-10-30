/**
 * 模型调用端口：编排节点只依赖这里，不关心用的是哪家 SDK。
 * - `generateObject`：要结构化结果（阶段产物），失败必须抛错而不是返回半成品。
 * - `streamText`：要流式过程（TUI 展示）；工具调用以事件形式回传。
 */
import type { z } from "zod";

export type ChatUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
};

export type ObjectRequest<T> = {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  /** 部分提供方会把 schema 名作为提示词的一部分。 */
  schemaName: string;
  temperature?: number;
};

export type ObjectResult<T> = {
  object: T;
  usage: ChatUsage;
};

/** 工具定义：名称由 record 的 key 提供，避免两处写名字。 */
export type ChatTool = {
  description: string;
  inputSchema: z.ZodType;
  execute?: (input: unknown) => Promise<unknown>;
};

export type StreamRequest = {
  system: string;
  prompt: string;
  tools?: Record<string, ChatTool>;
};

export type StreamEvent =
  | { type: "text"; text: string }
  | { type: "tool_call"; name: string; input: unknown }
  | { type: "error"; message: string }
  | { type: "finish"; usage: ChatUsage; finishReason: string };

export interface ChatPort {
  generateObject<T>(request: ObjectRequest<T>): Promise<ObjectResult<T>>;
  streamText(request: StreamRequest): AsyncIterable<StreamEvent>;
}
