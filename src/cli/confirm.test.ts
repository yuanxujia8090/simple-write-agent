/**
 * 确认卡的单点交互测试：只验证「输入 → 决策」与卡片文本，不碰真实终端。
 * 交互器本身（readline）留给手动验收命令覆盖。
 */
import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import type { ConfirmationPackage } from "../domain/service.js";
import { createTerminalConfirm, formatCard, parseAnswer } from "./confirm.js";

const gate: ConfirmationPackage = {
  sessionId: "sess-1",
  gateId: "outline",
  gateType: "content",
  stage: "outline",
  artifactId: "art-1",
  artifactHash: "hash-art",
  confirmationHash: "hash-confirm",
  preview: "# 标题\n第一章目标",
  recommendation: { label: "标题 A", reason: "贴合论点" },
  risks: ["章节偏多"],
  alternatives: ["标题 B"],
};

describe("parseAnswer", () => {
  it("空输入按批准处理", () => {
    expect(parseAnswer("", gate)).toEqual({
      artifactId: "art-1",
      artifactHash: "hash-art",
      confirmationHash: "hash-confirm",
      decision: "approve",
    });
  });

  it("y 与中文批准都算批准", () => {
    for (const answer of ["y", "Y", "yes", "批准", "同意"]) {
      expect(parseAnswer(answer, gate)?.decision).toBe("approve");
    }
  });

  it("m 加反馈是修改，反馈同时作为修订指令", () => {
    const decision = parseAnswer("m 标题再具体一点", gate);
    expect(decision?.decision).toBe("modify");
    expect(decision?.feedback).toBe("标题再具体一点");
    expect(decision?.directives).toEqual(["标题再具体一点"]);
  });

  it("n 加反馈是拒绝", () => {
    const decision = parseAnswer("n 论点站不住", gate);
    expect(decision?.decision).toBe("reject");
    expect(decision?.feedback).toBe("论点站不住");
  });

  it("修改/拒绝不带反馈时返回 null，让调用方重问", () => {
    expect(parseAnswer("m", gate)).toBeNull();
    expect(parseAnswer("n", gate)).toBeNull();
  });

  it("看不懂的输入返回 null，不默认批准", () => {
    expect(parseAnswer("随便吧", gate)).toBeNull();
    expect(parseAnswer("2", gate)).toBeNull();
  });

  it("决策绑定当前确认卡的三个指纹", () => {
    const decision = parseAnswer("y", { ...gate, artifactHash: "other" });
    expect(decision?.artifactHash).toBe("other");
  });
});

describe("formatCard", () => {
  it("包含阶段、推荐、依据、风险、备选与预览", () => {
    const text = formatCard(gate, 2);
    expect(text).toContain("确认卡 2：大纲");
    expect(text).toContain("推荐：标题 A");
    expect(text).toContain("依据：贴合论点");
    expect(text).toContain("风险：章节偏多");
    expect(text).toContain("备选：标题 B");
    expect(text).toContain("  # 标题");
  });

  it("没有依据/风险/备选时不输出空标题行", () => {
    const text = formatCard(
      { ...gate, recommendation: { label: "A", reason: "" }, risks: [], alternatives: [] },
      1,
    );
    expect(text).not.toContain("依据：");
    expect(text).not.toContain("风险：");
    expect(text).not.toContain("备选：");
  });
});

describe("createTerminalConfirm", () => {
  async function waitUntil(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (predicate()) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("等待终端输出超时");
  }

  /** 用内存流代替终端：readline 不要求真 TTY，注入后能稳定跑。 */
  function terminal() {
    const input = new PassThrough();
    const output = new PassThrough();
    const written: string[] = [];
    output.on("data", (chunk: Buffer) => written.push(chunk.toString("utf8")));
    return { input, output, written, confirm: createTerminalConfirm({ input, output }) };
  }

  it("回车批准当前门禁", async () => {
    const { input, confirm } = terminal();
    const pending = confirm(gate, 1);
    input.write("\n");
    await expect(pending).resolves.toMatchObject({ decision: "approve", artifactId: "art-1" });
  });

  it("看不懂的输入会重问，不会默默批准", async () => {
    const { input, written, confirm } = terminal();
    const pending = confirm(gate, 1);
    input.write("随便吧\n");
    // readline 在两次提问之间不缓存行：必须等重问提示出现再给下一次输入。
    await waitUntil(() => written.join("").includes("没看懂"));
    input.write("m 标题再具体一点\n");
    const decision = await pending;
    expect(decision.decision).toBe("modify");
    expect(decision.feedback).toBe("标题再具体一点");
  });
});
