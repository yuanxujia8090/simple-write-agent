/**
 * 业务表结构与契约清单。
 * `checkpoints` / `writes` 由 checkpoint 保存器 `setup()` 建表，这里只做列名契约校验（ADR 0012）。
 */
import type Database from "better-sqlite3";

import { AppError } from "../shared/errors.js";

export const BUSINESS_SCHEMA_VERSION = 1;

const BUSINESS_SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mode TEXT NOT NULL,
  stage TEXT NOT NULL,
  workspace_root TEXT NOT NULL,
  workspace_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artifact_versions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  file_path TEXT,
  file_hash TEXT,
  parent_artifact_id TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  status_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_artifact_versions_session ON artifact_versions (session_id);

CREATE TABLE IF NOT EXISTS gates (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  gate_id TEXT NOT NULL,
  gate_type TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  artifact_hash TEXT NOT NULL,
  confirmation_hash TEXT NOT NULL,
  decision TEXT NOT NULL,
  revision TEXT,
  decided_at TEXT NOT NULL,
  UNIQUE (artifact_id, artifact_hash, confirmation_hash, decision)
);
CREATE INDEX IF NOT EXISTS idx_gates_session ON gates (session_id);

CREATE TABLE IF NOT EXISTS trace_events (
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  at TEXT NOT NULL,
  type TEXT NOT NULL,
  detail TEXT NOT NULL,
  artifact_id TEXT,
  gate_id TEXT,
  PRIMARY KEY (session_id, seq)
);

CREATE TABLE IF NOT EXISTS revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  gate_id TEXT NOT NULL,
  revision TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_revisions_session ON revisions (session_id);
`;

/** 业务表必须存在的列；迁移或手工改表导致缺列时直接失败，不静默降级。 */
export const REQUIRED_BUSINESS_COLUMNS: Record<string, readonly string[]> = {
  sessions: ["id", "name", "mode", "stage", "workspace_root", "workspace_id", "created_at", "updated_at"],
  artifact_versions: [
    "id",
    "session_id",
    "kind",
    "status",
    "version",
    "content",
    "content_hash",
    "file_path",
    "file_hash",
    "parent_artifact_id",
    "created_at",
    "decided_at",
    "status_reason",
  ],
  gates: [
    "id",
    "session_id",
    "gate_id",
    "gate_type",
    "artifact_id",
    "artifact_hash",
    "confirmation_hash",
    "decision",
    "revision",
    "decided_at",
  ],
  trace_events: ["session_id", "seq", "at", "type", "detail", "artifact_id", "gate_id"],
  revisions: ["id", "session_id", "gate_id", "revision", "at"],
};

/** LangGraph 保存器建的表，本方案直接写入与读取，列名必须与 ADR 0012 一致。 */
export const REQUIRED_CHECKPOINT_COLUMNS: Record<string, readonly string[]> = {
  checkpoints: [
    "thread_id",
    "checkpoint_ns",
    "checkpoint_id",
    "parent_checkpoint_id",
    "type",
    "checkpoint",
    "metadata",
  ],
  writes: ["thread_id", "checkpoint_ns", "checkpoint_id", "task_id", "idx", "channel", "type", "value"],
};

type Db = Database.Database;

export function createBusinessSchema(db: Db): void {
  db.exec(BUSINESS_SCHEMA);
}

function tableColumns(db: Db, table: string): string[] {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return rows.map((row) => row.name);
}

function assertColumns(
  db: Db,
  expected: Record<string, readonly string[]>,
  hint: string,
): void {
  for (const [table, columns] of Object.entries(expected)) {
    const actual = tableColumns(db, table);
    if (actual.length === 0) {
      throw new AppError("RUNTIME", `数据库缺少表：${table}`, hint);
    }
    const missing = columns.filter((column) => !actual.includes(column));
    if (missing.length > 0) {
      throw new AppError(
        "RUNTIME",
        `数据库表 ${table} 缺少列：${missing.join(", ")}`,
        hint,
      );
    }
  }
}

/** 业务表契约：缺表或缺列即失败。 */
export function assertBusinessSchema(db: Db): void {
  assertColumns(db, REQUIRED_BUSINESS_COLUMNS, "删除库文件后重新初始化，或按 docs/design 补迁移");
}

/** checkpoint 表契约：保存器版本变更导致列变化时立即暴露（ADR 0012 要求）。 */
export function assertCheckpointSchema(db: Db): void {
  assertColumns(
    db,
    REQUIRED_CHECKPOINT_COLUMNS,
    "依赖版本可能已变更：重跑 npm run exp:t0 并核对 ADR 0012",
  );
}
