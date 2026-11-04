/**
 * 适配器集成测试：起一个本地假 OpenAI 兼容服务，验证结构化调用「不发 response_format」且能从脏输出里取对象。
 * 不联网、不花钱，替代真实网关烟测中可离线验证的那部分。
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { createAiSdkChat } from "./ai-sdk.js";

type Captured = { path: string; body: Record<string, unknown> };

let server: Server | null = null;

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

/** 起一个只认 chat/completions 的假服务，内容固定。 */
async function startFakeModel(content: string): Promise<{ baseURL: string; captured: Captured[] }> {
  const captured: Captured[] = [];
  const s = createServer(async (request, response) => {
    const raw = await readBody(request);
    captured.push({ path: request.url ?? "", body: JSON.parse(raw) as Record<string, unknown> });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        id: "chatcmpl-test",
        object: "chat.completion",
        created: 0,
        model: "fake-model",
        choices: [
          { index: 0, message: { role: "assistant", content }, finish_reason: "stop" },
        ],
        usage: { prompt_tokens: 11, completion_tokens: 22, total_tokens: 33 },
      }),
    );
  });
  await new Promise<void>((resolve) => s.listen(0, "127.0.0.1", resolve));
  server = s;
  const { port } = s.address() as AddressInfo;
  return { baseURL: `http://127.0.0.1:${port}/v1`, captured };
}

afterEach(async () => {
  if (server !== null) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
  }
});

describe("createAiSdkChat.generateObject", () => {
  it("请求体不带 response_format，并返回 zod 校验后的对象", async () => {
    const { baseURL, captured } = await startFakeModel('```json\n{"title":"本地写作","count":2}\n```');
    const chat = createAiSdkChat({
      model: { provider: "openai-compatible", baseURL, modelId: "fake-model", apiKey: "test-key" },
    });

    const result = await chat.generateObject({
      system: "测试",
      prompt: "给我一个对象",
      schema: z.object({ title: z.string(), count: z.number() }),
      schemaName: "Fake",
    });

    expect(result.object).toEqual({ title: "本地写作", count: 2 });
    expect(result.usage).toEqual({ inputTokens: 11, outputTokens: 22 });
    expect(captured).toHaveLength(1);
    expect(captured[0]?.path).toContain("/chat/completions");
    expect(captured[0]?.body).not.toHaveProperty("response_format");
    // JSON Schema 进了 prompt，模型不靠隐藏参数也能知道结构。
    const messages = captured[0]?.body.messages as { role: string; content: string }[];
    expect(messages.at(-1)?.content).toContain('"title"');
  });

  it("第一次输出不合格时重试一次，第二次通过", async () => {
    let calls = 0;
    const s = createServer(async (request, response) => {
      await readBody(request);
      calls += 1;
      const content = calls === 1 ? "我先想想……（没有 JSON）" : '{"title":"第二次才对"}';
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          id: "chatcmpl-test",
          object: "chat.completion",
          created: 0,
          model: "fake-model",
          choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
        }),
      );
    });
    await new Promise<void>((resolve) => s.listen(0, "127.0.0.1", resolve));
    server = s;
    const { port } = s.address() as AddressInfo;

    const chat = createAiSdkChat({
      model: {
        provider: "openai-compatible",
        baseURL: `http://127.0.0.1:${port}/v1`,
        modelId: "fake-model",
        apiKey: "test-key",
      },
    });

    const result = await chat.generateObject({
      system: "测试",
      prompt: "给我一个对象",
      schema: z.object({ title: z.string() }),
      schemaName: "Fake",
    });

    expect(result.object).toEqual({ title: "第二次才对" });
    expect(calls).toBe(2);
  });

  it("两次都不合格时抛出带 schema 名的可读错误", async () => {
    const { baseURL } = await startFakeModel("完全是散文，没有结构");
    const chat = createAiSdkChat({
      model: { provider: "openai-compatible", baseURL, modelId: "fake-model", apiKey: "test-key" },
    });

    await expect(
      chat.generateObject({
        system: "测试",
        prompt: "给我一个对象",
        schema: z.object({ title: z.string() }),
        schemaName: "Fake",
      }),
    ).rejects.toThrow(/Fake 结构/);
  });
});
