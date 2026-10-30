import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FIXED_DOWNGRADED_CLAIM } from "../agent/fixed-model.js";
import { createGraphRunner } from "../agent/runner.js";
import { createFileWriter } from "../artifacts/files.js";
import { createPersistentRuntime } from "../runtime.js";
import { createInMemoryWorkflowService } from "../workflow/service.js";
import { runReplay } from "./replay.js";

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "writing-agent-replay-test-"));
  roots.push(root);
  return root;
}

function readText(path: string): string {
  return readFileSync(path, "utf8");
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("首条写作闭环重放", () => {
  it("全部批准：5 个门禁走完，产物与文件落盘一致", async () => {
    const root = makeRoot();
    const result = await runReplay({ workspaceRoot: root, scenario: "basic" });

    expect(result.status).toBe("exported");
    expect(result.stage).toBe("exported");
    expect(result.gates.map((gate) => gate.gateId)).toEqual([
      "materials",
      "thesis",
      "outline",
      "fact_report",
      "final",
    ]);
    expect(result.output.outlinePath).not.toBeNull();
    expect(result.output.draftPath).not.toBeNull();
    expect(result.output.exportedPath).toBe(result.output.draftPath);
    expect(readText(result.output.outlinePath!)).toContain("## 1.");
    // HTML 与 Markdown 同 slug、同目录，内容来自同一份主稿
    expect(result.output.htmlPath).toBe(result.output.exportedPath!.replace(/\.md$/, ".html"));
    expect(existsSync(result.output.htmlPath!)).toBe(true);
    const html = readText(result.output.htmlPath!);
    expect(html.startsWith("<div style=")).toBe(true);
    expect(html).toContain("<h1");
    expect(result.output.htmlError).toBeNull();
    expect(readText(result.output.exportedPath!).length).toBeGreaterThan(1500);

    const byKind = new Map(result.artifacts.map((artifact) => [artifact.kind, artifact]));
    expect(byKind.get("thesis")?.status).toBe("draft");
    expect(byKind.get("outline")?.status).toBe("draft");
    expect(byKind.get("fact_report")?.status).toBe("draft");
    expect(byKind.get("final")?.status).toBe("draft");
    expect(result.revisions).toBe(0);
  });

  it("论点要求修改：回退重跑一次并保留修订指令", async () => {
    const root = makeRoot();
    const result = await runReplay({ workspaceRoot: root, scenario: "revise" });

    expect(result.status).toBe("exported");
    expect(result.gates.filter((gate) => gate.gateId === "thesis")).toHaveLength(2);
    expect(result.gates[1]?.decision).toBe("modify");
    expect(result.revisions).toBe(1);
    expect(result.artifacts.some((item) => item.kind === "thesis" && item.status === "rejected")).toBe(
      true,
    );
    expect(result.artifacts.some((item) => item.kind === "thesis" && item.status === "draft")).toBe(
      true,
    );
  });

  it("终稿被拒绝：回退到 drafting，重做后仍能导出", async () => {
    const root = makeRoot();
    const result = await runReplay({ workspaceRoot: root, scenario: "reject" });

    expect(result.status).toBe("exported");
    expect(result.gates[4]?.gateId).toBe("final");
    expect(result.gates[4]?.decision).toBe("reject");
    expect(result.gates.at(-1)?.gateId).toBe("final");
    expect(result.gates.at(-1)?.decision).toBe("approve");
    expect(result.revisions).toBe(1);
    const finals = result.artifacts.filter((item) => item.kind === "final");
    expect(finals.some((item) => item.status === "rejected")).toBe(true);
    expect(finals.some((item) => item.status === "draft")).toBe(true);
    // 终稿是降级改写后的版本：未核实的外部断言被改写成保留怀疑的表述
    expect(readText(result.output.exportedPath!)).toContain(FIXED_DOWNGRADED_CLAIM);
  });
});

describe("快速模式与持久化库", () => {
  it("快速模式只保留论点和终稿两道门禁", async () => {
    const root = makeRoot();
    const result = await runReplay({ workspaceRoot: root, scenario: "basic", mode: "fast" });

    expect(result.status).toBe("exported");
    expect(result.mode).toBe("fast");
    expect(result.gates.map((gate) => gate.gateId)).toEqual(["thesis", "final"]);
    expect(readText(result.output.exportedPath!).length).toBeGreaterThan(1500);
    expect(existsSync(result.output.htmlPath!)).toBe(true);
  });

  it("传入库文件时会话落到 SQLite，并能在新连接里读回", async () => {
    const root = makeRoot();
    const dbPath = join(root, "session.db");
    const result = await runReplay({ workspaceRoot: root, scenario: "basic", dbPath });

    expect(result.dbPath).toBe(dbPath);
    expect(result.status).toBe("exported");

    const reloaded = createPersistentRuntime({ dbPath });
    try {
      const sessions = reloaded.service.listSessions();
      expect(sessions.map((session) => session.id)).toEqual([result.sessionId]);
      expect(sessions[0]?.stage).toBe("exported");
      expect(sessions[0]?.gates).toHaveLength(5);
      expect(sessions[0]?.artifacts.some((item) => item.fileHash !== null)).toBe(true);
    } finally {
      reloaded.close();
    }
  });
});

describe("主题接线", () => {
  it("指定主题文件时用它的名称与配色渲染 HTML", async () => {
    const root = makeRoot();
    const themePath = new URL("../../archive/my-theme.json", import.meta.url).pathname;
    const result = await runReplay({ workspaceRoot: root, scenario: "basic", themePath });

    expect(result.themeName).toBe("橙色");
    expect(result.themeWarnings).toEqual([]);
    const html = readText(result.output.htmlPath!);
    expect(html).toContain("#EF7534");
  });

  it("主题非法时回退到内置默认并保留警告", async () => {
    const root = makeRoot();
    const brokenPath = join(root, "broken-theme.json");
    writeFileSync(brokenPath, JSON.stringify({ version: 2 }), "utf8");
    const result = await runReplay({ workspaceRoot: root, scenario: "basic", themePath: brokenPath });

    expect(result.status).toBe("exported");
    expect(result.themeName).toBe("默认");
    expect(result.themeWarnings.join()).toContain("版本只接受 1");
    expect(existsSync(result.output.htmlPath!)).toBe(true);
  });
});

describe("确认指纹校验", () => {
  it("沿用旧确认卡提交时被拒绝，流程返回失败而不是推进", async () => {
    const root = makeRoot();
    const service = createInMemoryWorkflowService();
    const runner = createGraphRunner({ service, files: createFileWriter() });

    const first = await runner.start({
      topic: "跨端同步",
      mode: "normal",
      workspace: { root, workspaceId: "ws-stale" },
    });
    expect(first.status).toBe("awaiting_confirmation");
    const gate = first.gate!;

    const stale = await runner.resume({
      decision: "approve",
      artifactId: gate.artifactId,
      artifactHash: gate.artifactHash,
      confirmationHash: "sha256:deadbeef",
    });

    expect(stale.status).toBe("failed");
    expect(stale.error).toContain("确认已过期");
    expect(stale.session.stage).toBe("intake");
    expect(stale.session.gates).toHaveLength(0);
  });
});
