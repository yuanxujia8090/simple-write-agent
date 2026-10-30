/** SQLite 存储：建表契约、会话往返、原子提交与 checkpoint 同事务。 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { afterEach, describe, expect, it } from "vitest";

import type { PreparedCheckpoint } from "../domain/store.js";
import type { SessionState } from "../domain/types.js";
import {
  REQUIRED_BUSINESS_COLUMNS,
  REQUIRED_CHECKPOINT_COLUMNS,
  assertBusinessSchema,
  assertCheckpointSchema,
  createBusinessSchema,
} from "./schema.js";
import { createSqliteStore, openWorkflowDatabase } from "./sqlite-store.js";

const cleanup: (() => void)[] = [];

function makeDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "writing-agent-store-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, "session.db");
}

afterEach(() => {
  while (cleanup.length > 0) {
    cleanup.pop()?.();
  }
});

function columnsOf(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
    (row) => row.name,
  );
}

/** `setup()` 是 protected：真实装配由 runtime 的子类触发，测试里靠一次读触发建表。 */
async function enableCheckpointTables(db: Database.Database): Promise<void> {
  const saver = new SqliteSaver(db);
  await saver.getTuple({ configurable: { thread_id: "probe", checkpoint_ns: "" } });
}

function preparedCheckpoint(threadId: string): PreparedCheckpoint {
  return {
    threadId,
    checkpointNs: "",
    checkpointId: "ckpt-1",
    parentCheckpointId: null,
    type: "json",
    checkpoint: JSON.stringify({ id: "ckpt-1", channel_values: { stage: "thesis" } }),
    metadata: JSON.stringify({ source: "loop", step: 1, parents: {} }),
  };
}

function sampleSession(): SessionState {
  return {
    id: "sess-1",
    name: "测试会话",
    mode: "normal",
    stage: "thesis",
    workspace: { root: "/workspace", workspaceId: "ws-1" },
    createdAt: "2026-10-30T00:00:00.000Z",
    updatedAt: "2026-10-30T00:01:00.000Z",
    artifacts: [
      {
        id: "art-1",
        sessionId: "sess-1",
        kind: "draft",
        status: "draft",
        version: 2,
        content: { title: "标题", markdown: "# 标题\n\n正文\n" },
        contentHash: "sha256:content",
        filePath: "/workspace/articles/标题.md",
        fileHash: "sha256:file",
        parentArtifactId: null,
        createdAt: "2026-10-30T00:00:10.000Z",
        decidedAt: "2026-10-30T00:00:20.000Z",
        statusReason: null,
      },
    ],
    gates: [
      {
        id: "gate-1",
        sessionId: "sess-1",
        gateId: "thesis",
        gateType: "content",
        artifactId: "art-1",
        artifactHash: "sha256:content",
        confirmationHash: "sha256:confirm",
        decision: "modify",
        revision: { rawFeedback: "换个说法", directives: ["少列工具"] },
        decidedAt: "2026-10-30T00:00:20.000Z",
      },
    ],
    trace: [
      {
        seq: 1,
        at: "2026-10-30T00:00:10.000Z",
        type: "artifact_generated",
        detail: "draft v2 已生成，等待确认",
        artifactId: "art-1",
      },
      {
        seq: 2,
        at: "2026-10-30T00:00:20.000Z",
        type: "stage_changed",
        detail: "阶段 thesis → outline",
        gateId: "thesis",
      },
    ],
    revisions: [
      {
        gateId: "thesis",
        revision: { rawFeedback: "换个说法", directives: ["少列工具"] },
        at: "2026-10-30T00:00:20.000Z",
      },
    ],
  };
}

describe("数据库表结构契约", () => {
  it("业务表与 checkpoint 表都保持方案列名", () => {
    const db = openWorkflowDatabase(makeDbPath());
    const saver = new SqliteSaver(db);
    // setup 是 protected，这里通过一次读写触发（真实装配走 runtime 的子类）。
    const trigger = saver.getTuple({ configurable: { thread_id: "probe", checkpoint_ns: "" } });

    return trigger.then(() => {
      for (const table of Object.keys(REQUIRED_BUSINESS_COLUMNS)) {
        expect(columnsOf(db, table)).toEqual(expect.arrayContaining([...REQUIRED_BUSINESS_COLUMNS[table]!]));
      }
      for (const table of Object.keys(REQUIRED_CHECKPOINT_COLUMNS)) {
        expect(columnsOf(db, table)).toEqual(expect.arrayContaining([...REQUIRED_CHECKPOINT_COLUMNS[table]!]));
      }
      assertBusinessSchema(db);
      assertCheckpointSchema(db);
      db.close();
    });
  });

  it("缺列时直接报错而不是静默降级", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY)");
    expect(() => assertBusinessSchema(db)).toThrowError(/缺少表|缺少列/);
    db.close();
  });
});

describe("会话往返", () => {
  it("整份会话落库后原样读回", () => {
    const db = openWorkflowDatabase(makeDbPath());
    const store = createSqliteStore(db);
    const session = sampleSession();

    store.saveSession(session);

    expect(store.loadSession("sess-1")).toEqual(session);
    expect(store.listSessions()).toHaveLength(1);
    expect(store.loadSession("sess-missing")).toBeNull();
    db.close();
  });

  it("同一会话再次保存时替换派生行，不重复累积", () => {
    const db = openWorkflowDatabase(makeDbPath());
    const store = createSqliteStore(db);
    const session = sampleSession();
    store.saveSession(session);

    session.artifacts = [];
    session.gates = [];
    session.trace = [];
    session.revisions = [];
    session.stage = "exported";
    store.saveSession(session);

    const reloaded = store.loadSession("sess-1");
    expect(reloaded?.stage).toBe("exported");
    expect(reloaded?.artifacts).toHaveLength(0);
    expect(reloaded?.gates).toHaveLength(0);
    const count = db
      .prepare("SELECT COUNT(*) AS n FROM artifact_versions WHERE session_id = ?")
      .get("sess-1") as { n: number };
    expect(count.n).toBe(0);
    db.close();
  });

  it("会话按更新时间倒序返回", () => {
    const db = openWorkflowDatabase(makeDbPath());
    const store = createSqliteStore(db);
    const older = sampleSession();
    const newer: SessionState = {
      ...sampleSession(),
      id: "sess-2",
      updatedAt: "2026-10-31T00:00:00.000Z",
      artifacts: [],
      gates: [],
      trace: [],
      revisions: [],
    };
    store.saveSession(older);
    store.saveSession(newer);

    expect(store.listSessions().map((item) => item.id)).toEqual(["sess-2", "sess-1"]);
    db.close();
  });

  it("checkpoint 行与业务行同批写入", async () => {
    const db = openWorkflowDatabase(makeDbPath());
    await enableCheckpointTables(db);
    const store = createSqliteStore(db);
    store.saveSession(sampleSession(), preparedCheckpoint("sess-1"));

    const row = db
      .prepare("SELECT checkpoint_id FROM checkpoints WHERE thread_id = ?")
      .get("sess-1") as { checkpoint_id: string } | undefined;
    expect(row?.checkpoint_id).toBe("ckpt-1");
    db.close();
  });

  it("写入失败时业务行与 checkpoint 行都不留", async () => {
    const db = openWorkflowDatabase(makeDbPath());
    createBusinessSchema(db);
    await enableCheckpointTables(db);
    const store = createSqliteStore(db);

    // 用一个必失败的保存：重复主键在事务中被回滚，前面的删除也应一并回退。
    store.saveSession(sampleSession());
    const broken = sampleSession();
    broken.gates = [broken.gates[0]!, broken.gates[0]!];
    expect(() => store.saveSession(broken, preparedCheckpoint("sess-1"))).toThrow();

    const artifacts = db
      .prepare("SELECT COUNT(*) AS n FROM artifact_versions WHERE session_id = ?")
      .get("sess-1") as { n: number };
    const checkpoints = db
      .prepare("SELECT COUNT(*) AS n FROM checkpoints WHERE thread_id = ?")
      .get("sess-1") as { n: number };
    expect(artifacts.n).toBe(1);
    expect(checkpoints.n).toBe(0);
    db.close();
  });

  it("损坏的 JSON 直接报错，不返回半份状态", () => {
    const db = openWorkflowDatabase(makeDbPath());
    const store = createSqliteStore(db);
    store.saveSession(sampleSession());
    db.prepare("UPDATE artifact_versions SET content = ? WHERE id = ?").run("null{", "art-1");

    expect(() => store.loadSession("sess-1")).toThrowError(/记录损坏/);
    db.close();
  });
});
