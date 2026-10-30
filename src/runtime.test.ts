/** 持久化运行时：跨进程恢复、外部编辑冲突、checkpoint 同事务写入。 */
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import type { ConfirmationPackage, RunState } from "./domain/service.js";
import { createPersistentRuntime, type PersistentRuntime } from "./runtime.js";

const cleanup: (() => void)[] = [];
const runtimes: PersistentRuntime[] = [];

function makeWorkspace(): { root: string; dbPath: string } {
  const root = mkdtempSync(join(tmpdir(), "writing-agent-runtime-"));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  return { root, dbPath: join(root, "session.db") };
}

function openRuntime(dbPath: string): PersistentRuntime {
  const runtime = createPersistentRuntime({ dbPath });
  runtimes.push(runtime);
  return runtime;
}

afterEach(() => {
  while (runtimes.length > 0) {
    runtimes.pop()?.close();
  }
  while (cleanup.length > 0) {
    cleanup.pop()?.();
  }
});

function requireGate(state: RunState): ConfirmationPackage {
  if (state.gate === null) {
    throw new Error(`状态 ${state.status} 没有门禁`);
  }
  return state.gate;
}

function approve(runner: PersistentRuntime["runner"], state: RunState): Promise<RunState> {
  const gate = requireGate(state);
  return runner.resume({
    decision: "approve",
    artifactId: gate.artifactId,
    artifactHash: gate.artifactHash,
    confirmationHash: gate.confirmationHash,
  });
}

function checkpointRows(dbPath: string, threadId: string): number {
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db
      .prepare("SELECT COUNT(*) AS n FROM checkpoints WHERE thread_id = ?")
      .get(threadId) as { n: number };
    return row.n;
  } finally {
    db.close();
  }
}

describe("持久化运行时", () => {
  it("新进程能打开同一会话并接着确认到导出", async () => {
    const { root, dbPath } = makeWorkspace();
    const topic = "把知识库从收藏夹变成工作台";

    const first = openRuntime(dbPath);
    const started = await first.runner.start({
      topic,
      materials: ["notes/a.md"],
      workspace: { root, workspaceId: "ws-test" },
    });
    expect(started.status).toBe("awaiting_confirmation");
    const gateBefore = requireGate(started);
    const sessionId = started.session.id;
    first.close();
    runtimes.pop();

    // 新连接、新服务、新图：业务状态从库里读，确认卡从 checkpoint 读。
    const second = openRuntime(dbPath);
    const reopened = await second.runner.openSession(sessionId);
    expect(reopened.status).toBe("awaiting_confirmation");
    expect(requireGate(reopened)).toEqual(gateBefore);
    expect(reopened.session.stage).toBe(started.session.stage);

    let state = reopened;
    let guard = 0;
    while (state.status === "awaiting_confirmation") {
      guard += 1;
      expect(guard).toBeLessThanOrEqual(6);
      state = await approve(second.runner, state);
    }

    expect(state.status).toBe("exported");
    expect(state.session.stage).toBe("exported");
    expect(state.session.gates).toHaveLength(5);
    expect(state.output?.exportedPath).not.toBeNull();
    expect(state.session.artifacts.some((item) => item.fileHash !== null)).toBe(true);

    // checkpoint 行确实落在同一个库里，且线程号就是会话号。
    expect(checkpointRows(dbPath, sessionId)).toBeGreaterThan(0);
    expect(second.service.listSessions().map((item) => item.id)).toEqual([sessionId]);
  });

  it("主稿被外部改动后导出被拦住，文件不被覆盖", async () => {
    const { root, dbPath } = makeWorkspace();
    const runtime = openRuntime(dbPath);

    let state = await runtime.runner.start({
      topic: "外部编辑检测",
      workspace: { root, workspaceId: "ws-edit" },
    });
    // 走到终稿门禁前（素材、论点、大纲、事实报告共 4 道）。
    for (let index = 0; index < 4; index += 1) {
      state = await approve(runtime.runner, state);
    }
    expect(requireGate(state).gateId).toBe("final");

    const draftPath = state.output?.draftPath;
    expect(draftPath).not.toBeNull();
    const original = readFileSync(draftPath!, "utf8");
    const edited = `${original}\n\n## 我手动加的一段\n\n这一段是用户在外部编辑器里加的。\n`;
    writeFileSync(draftPath!, edited, "utf8");

    const failed = await approve(runtime.runner, state);
    expect(failed.status).toBe("failed");
    expect(failed.error).toContain("已被外部修改");
    expect(readFileSync(draftPath!, "utf8")).toBe(edited);

    // 业务状态没有被推进：终稿仍是待确认，门禁记录没有新增这条批准。
    const persisted = runtime.service.getSession(state.session.id);
    expect(persisted.stage).toBe("review");
    expect(persisted.gates.some((gate) => gate.gateId === "final")).toBe(false);
  });

  it("撤销外部改动后仍能正常导出", async () => {
    const { root, dbPath } = makeWorkspace();
    const runtime = openRuntime(dbPath);

    let state = await runtime.runner.start({
      topic: "外部编辑后恢复",
      workspace: { root, workspaceId: "ws-restore" },
    });
    for (let index = 0; index < 4; index += 1) {
      state = await approve(runtime.runner, state);
    }
    const draftPath = state.output?.draftPath;
    expect(draftPath).not.toBeNull();
    const original = readFileSync(draftPath!, "utf8");
    appendFileSync(draftPath!, "外部改动", "utf8");

    const blocked = await approve(runtime.runner, state);
    expect(blocked.status).toBe("failed");

    writeFileSync(draftPath!, original, "utf8");
    const resumed = await runtime.runner.openSession(state.session.id);
    const exported = await approve(runtime.runner, resumed);
    expect(exported.status).toBe("exported");
    expect(exported.output?.exportedPath).toBe(draftPath);
  });
});
