import Database from "better-sqlite3";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import type { Checkpoint, CheckpointMetadata } from "@langchain/langgraph";

import {
  FIXED_CANDIDATE_TEXT,
  artifactHashOf,
  countRows,
  createBusinessSchema,
  makeExperimentResult,
  makeTempWorkspace,
  sha256,
  type Check,
  type Db,
  type ExperimentResult,
} from "./shared.js";

/** 预序列化写入依赖 SqliteSaver 自己的 checkpoints 表结构（见 dist/index.d.ts 与 setup() 建表语句）。 */
const CHECKPOINTS_INSERT =
  "INSERT OR REPLACE INTO checkpoints (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)";

const CHECKPOINT_CHANNEL_VALUES = {
  stage: "awaiting_confirmation",
  artifact_status: "temporary",
};

function makeCheckpoint(tag: string): Checkpoint {
  return {
    v: 4,
    id: `ckpt-${tag}`,
    ts: "2026-10-29T00:00:00.000Z",
    channel_values: CHECKPOINT_CHANNEL_VALUES,
    channel_versions: { stage: 1, artifact_status: 1 },
    versions_seen: {},
  };
}

const CHECKPOINT_METADATA: CheckpointMetadata = { source: "loop", step: 1, parents: {} };

/** 业务四件套：版本、门禁、阶段、trace，sessionId 同时当作 threadId 便于按线程统计。 */
function writeBusinessRows(db: Db, sessionId: string): void {
  const artifactId = `art-${sha256(sessionId).slice(0, 12)}`;
  const artifactHash = artifactHashOf(FIXED_CANDIDATE_TEXT);
  db.prepare(
    "INSERT INTO sessions (id, stage, stage_version) VALUES (?, 'awaiting_confirmation', 1)",
  ).run(sessionId);
  db.prepare(
    "INSERT INTO artifact_versions (id, session_id, artifact_hash, status, body) VALUES (?, ?, ?, 'temporary', ?)",
  ).run(artifactId, sessionId, artifactHash, FIXED_CANDIDATE_TEXT);
  db.prepare(
    "INSERT INTO gates (id, session_id, artifact_id, artifact_hash, state, decision) VALUES (?, ?, ?, ?, 'awaiting_confirmation', NULL)",
  ).run(`gate-${sessionId}`, sessionId, artifactId, artifactHash);
  db.prepare("INSERT INTO trace (session_id, event, dedupe_key) VALUES (?, ?, ?)").run(
    sessionId,
    "artifact_generated:temporary",
    `generated:${artifactId}`,
  );
}

const BUSINESS_COUNT_SQL = {
  sessions: "SELECT COUNT(*) AS n FROM sessions WHERE id = ?",
  artifact_versions: "SELECT COUNT(*) AS n FROM artifact_versions WHERE session_id = ?",
  gates: "SELECT COUNT(*) AS n FROM gates WHERE session_id = ?",
  trace: "SELECT COUNT(*) AS n FROM trace WHERE session_id = ?",
} as const;

function countBusinessRows(db: Db, sessionId: string): number {
  let total = 0;
  for (const sql of Object.values(BUSINESS_COUNT_SQL)) {
    const row = db.prepare(sql).get(sessionId) as { n: number } | undefined;
    total += row?.n ?? 0;
  }
  return total;
}

function countCheckpointsForThread(db: Db, threadId: string): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM checkpoints WHERE thread_id = ?").get(threadId) as
    | { n: number }
    | undefined;
  return row?.n ?? 0;
}

const CRASH_MESSAGE = "注入故障：业务写入后崩溃（模拟进程在 DB 提交前退出）";

type AttemptSummary = { businessRows: number; checkpointRows: number; raised: string | null };

/**
 * 分支 A：复用同一个 better-sqlite3 连接，在 db.transaction() 内调用 saver.put()。
 * saver.put() 是 async，序列化在微任务里完成，INSERT 实际发生在事务提交/回滚之后。
 */
async function attemptSaverPutInsideTransaction(
  db: Db,
  saver: SqliteSaver,
  input: { threadId: string; crash: boolean },
): Promise<AttemptSummary> {
  const config = { configurable: { thread_id: input.threadId, checkpoint_ns: "" } };
  const checkpoint = makeCheckpoint(input.threadId);
  let pendingWrite: Promise<unknown> = Promise.resolve();
  let raised: string | null = null;

  const transaction = db.transaction(() => {
    writeBusinessRows(db, input.threadId);
    pendingWrite = saver.put(config, checkpoint, CHECKPOINT_METADATA);
    if (input.crash) {
      throw new Error(CRASH_MESSAGE);
    }
  });

  try {
    transaction();
  } catch (error) {
    raised = error instanceof Error ? error.message : String(error);
  }
  // 关键：等待异步写真正执行完，才能看到它落在事务外。
  await pendingWrite;

  return {
    businessRows: countBusinessRows(db, input.threadId),
    checkpointRows: countCheckpointsForThread(db, input.threadId),
    raised,
  };
}

/**
 * 分支 B（候选修正方案）：事务外先完成序列化，事务内用同一连接直接 INSERT checkpoints 行，
 * 使 checkpoint 与业务四件套落在同一个 sqlite 事务里。代价是绕过 saver.put()，依赖其表结构。
 */
async function attemptPreparedCheckpointInTransaction(
  db: Db,
  saver: SqliteSaver,
  input: { threadId: string; crash: boolean },
): Promise<AttemptSummary> {
  const checkpoint = makeCheckpoint(input.threadId);
  const [checkpointType, checkpointBlob] = await saver.serde.dumpsTyped(checkpoint);
  const [metadataType, metadataBlob] = await saver.serde.dumpsTyped(CHECKPOINT_METADATA);
  if (checkpointType !== metadataType) {
    throw new Error("checkpoint 与 metadata 序列化类型不一致，与 saver.put() 的约束冲突");
  }

  let raised: string | null = null;
  const transaction = db.transaction(() => {
    writeBusinessRows(db, input.threadId);
    db.prepare(CHECKPOINTS_INSERT).run(
      input.threadId,
      "",
      checkpoint.id,
      null,
      checkpointType,
      checkpointBlob,
      metadataBlob,
    );
    if (input.crash) {
      throw new Error(CRASH_MESSAGE);
    }
  });

  try {
    transaction();
  } catch (error) {
    raised = error instanceof Error ? error.message : String(error);
  }

  if (!input.crash) {
    const tuple = await saver.getTuple({
      configurable: { thread_id: input.threadId, checkpoint_ns: "", checkpoint_id: checkpoint.id },
    });
    if (tuple === undefined) {
      throw new Error("预序列化写入的 checkpoint 无法被 saver.getTuple() 读回");
    }
    if (tuple.checkpoint.channel_values["stage"] !== CHECKPOINT_CHANNEL_VALUES.stage) {
      throw new Error("读回的 checkpoint channel_values.stage 与写入值不一致");
    }
  }

  return {
    businessRows: countBusinessRows(db, input.threadId),
    checkpointRows: countCheckpointsForThread(db, input.threadId),
    raised,
  };
}

export type E3Evidence = {
  saverSharesExternalConnection: boolean;
  businessTablesPresent: number;
  putInsideTransactionSuccess: AttemptSummary;
  putInsideTransactionCrash: AttemptSummary;
  preparedInsideTransactionSuccess: AttemptSummary;
  preparedInsideTransactionCrash: AttemptSummary;
};

export type E3Result = ExperimentResult & { evidence: E3Evidence };

export async function runE3(): Promise<E3Result> {
  const workspace = await makeTempWorkspace("t0-e3-");
  const db = new Database(workspace.path("shared.sqlite"));

  try {
    createBusinessSchema(db);
    const saver = new SqliteSaver(db);
    // setup() 内含 PRAGMA journal_mode=WAL 与建表，必须在事务外先触发。
    await saver.getTuple({ configurable: { thread_id: "e3-warmup" } });

    const putSuccess = await attemptSaverPutInsideTransaction(db, saver, {
      threadId: "e3-put-success",
      crash: false,
    });
    const putCrash = await attemptSaverPutInsideTransaction(db, saver, {
      threadId: "e3-put-crash",
      crash: true,
    });
    const preparedSuccess = await attemptPreparedCheckpointInTransaction(db, saver, {
      threadId: "e3-prepared-success",
      crash: false,
    });
    const preparedCrash = await attemptPreparedCheckpointInTransaction(db, saver, {
      threadId: "e3-prepared-crash",
      crash: true,
    });

    const saverSharesExternalConnection = saver.db === db;

    const checks: Check[] = [
      {
        label: "可复用外部 better-sqlite3 连接",
        pass: saverSharesExternalConnection,
        detail: `constructor(db: Database, serde?: SerializerProtocol)；saver.db === 传入实例 = ${saverSharesExternalConnection}`,
      },
      {
        label: "saver.put() 在事务内调用：成功时五者都在",
        pass:
          putSuccess.businessRows === 4 &&
          putSuccess.checkpointRows === 1 &&
          putSuccess.raised === null,
        detail: `业务行=${putSuccess.businessRows} checkpoint 行=${putSuccess.checkpointRows}`,
      },
      {
        label: "saver.put() 在事务内调用：抛错后未共同回滚",
        pass: putCrash.businessRows === 0 && putCrash.checkpointRows === 1,
        detail: `业务行=${putCrash.businessRows}（已回滚） checkpoint 行=${putCrash.checkpointRows}（留下）；注入错误=${putCrash.raised ?? "无"}`,
      },
      {
        label: "预序列化 + 同事务 INSERT：五者一致且可读回",
        pass:
          preparedSuccess.businessRows === 4 &&
          preparedSuccess.checkpointRows === 1 &&
          preparedSuccess.raised === null,
        detail: `业务行=${preparedSuccess.businessRows} checkpoint 行=${preparedSuccess.checkpointRows}；saver.getTuple() 读回 stage=${CHECKPOINT_CHANNEL_VALUES.stage}`,
      },
      {
        label: "预序列化 + 同事务 INSERT：抛错后全回滚",
        pass: preparedCrash.businessRows === 0 && preparedCrash.checkpointRows === 0,
        detail: `业务行=${preparedCrash.businessRows} checkpoint 行=${preparedCrash.checkpointRows}；注入错误=${preparedCrash.raised ?? "无"}`,
      },
      {
        label: "checkpoints/writes 表由 SqliteSaver 建立并共享",
        pass: countRows(db, "checkpoints") === 3 && countRows(db, "writes") === 0,
        detail: `checkpoints 总行数=${countRows(db, "checkpoints")}（含事先的 0 + put 成功 1 + put 崩溃残留 1 + 预序列化 1）`,
      },
    ];

    const evidence: E3Evidence = {
      saverSharesExternalConnection,
      businessTablesPresent: countBusinessRows(db, "e3-prepared-success"),
      putInsideTransactionSuccess: putSuccess,
      putInsideTransactionCrash: putCrash,
      preparedInsideTransactionSuccess: preparedSuccess,
      preparedInsideTransactionCrash: preparedCrash,
    };

    const result = makeExperimentResult({
      id: "E3",
      title: "业务事务与 checkpoint 的共同提交边界",
      expected:
        "同一 sqlite 文件里，业务版本/门禁/阶段/trace 与 checkpoint 要么一起提交、要么一起回滚",
      actual:
        `共享连接=${saverSharesExternalConnection}；事务内调用 saver.put() 崩溃后 业务行=${putCrash.businessRows} checkpoint 行=${putCrash.checkpointRows}；` +
        `预序列化 + 事务内 INSERT 崩溃后 业务行=${preparedCrash.businessRows} checkpoint 行=${preparedCrash.checkpointRows}`,
      conclusion: resultPass(checks)
        ? "SqliteSaver 接受外部 Database，但 put()/putWrites() 是 async，无法参与 better-sqlite3 的同步事务：事务内调用会出现业务回滚而 checkpoint 残留。要满足 ADR 0009 的同一事务提交，必须在事务外预序列化、事务内直接用同一连接写 checkpoints（候选方案，绕过 put() 且依赖其表结构）"
        : "共同提交边界结论未成立，见失败项",
      checks,
    });

    return { ...result, evidence };
  } finally {
    db.close();
    await workspace.cleanup();
  }
}

function resultPass(checks: readonly Check[]): boolean {
  return checks.every((check) => check.pass);
}
