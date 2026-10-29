import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type Database from "better-sqlite3";

/** better-sqlite3 的实例类型挂在默认导入的命名空间上。 */
export type Db = Database.Database;

/** 全部实验共用的固定会话/线程标识，避免每次运行产生随机数据。 */
export const FIXED_SESSION_ID = "sess-t0";
export const FIXED_THREAD_ID = "thread-t0";
export const FIXED_CANDIDATE_TEXT = "固定候选：跨端状态同步的三个坑";
export const FIXED_DECISION = "approve" as const;

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function artifactHashOf(text: string): string {
  return `sha256:${sha256(text)}`;
}

export type ConfirmationDecision = "approve" | "reject";

export type ConfirmationKey = {
  artifactId: string;
  artifactHash: string;
  decision: ConfirmationDecision;
};

export function confirmationHashOf(key: ConfirmationKey): string {
  return `sha256:${sha256(`${key.artifactId}|${key.artifactHash}|${key.decision}`)}`;
}

export type TempWorkspace = {
  dir: string;
  path: (...segments: string[]) => string;
  cleanup: () => Promise<void>;
};

/** 每个实验独立一个临时目录，结束后尽力清理。 */
export async function makeTempWorkspace(prefix: string): Promise<TempWorkspace> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  return {
    dir,
    path: (...segments: string[]) => join(dir, ...segments),
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/** 业务表最小列集合：E2/E3/E4 复用，不含产品级字段。 */
const BUSINESS_SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  stage TEXT NOT NULL,
  stage_version INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS artifact_versions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  artifact_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  body TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS gates (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  artifact_hash TEXT NOT NULL,
  state TEXT NOT NULL,
  decision TEXT
);
CREATE TABLE IF NOT EXISTS trace (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  event TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS confirmations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artifact_id TEXT NOT NULL,
  artifact_hash TEXT NOT NULL,
  confirmation_hash TEXT NOT NULL,
  decision TEXT NOT NULL,
  UNIQUE (artifact_id, artifact_hash, confirmation_hash, decision)
);
CREATE TABLE IF NOT EXISTS artifact_files (
  path TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  registered_at TEXT NOT NULL
);
`;

export function createBusinessSchema(db: Db): void {
  db.exec(BUSINESS_SCHEMA);
}

export const TABLE_NAMES = [
  "sessions",
  "artifact_versions",
  "gates",
  "trace",
  "confirmations",
  "artifact_files",
  "checkpoints",
  "writes",
] as const;

export type TableName = (typeof TABLE_NAMES)[number];

/** 只允许这里列出的表名，SQL 里不拼接任何标识符。 */
const COUNT_SQL: Record<TableName, string> = {
  sessions: "SELECT COUNT(*) AS n FROM sessions",
  artifact_versions: "SELECT COUNT(*) AS n FROM artifact_versions",
  gates: "SELECT COUNT(*) AS n FROM gates",
  trace: "SELECT COUNT(*) AS n FROM trace",
  confirmations: "SELECT COUNT(*) AS n FROM confirmations",
  artifact_files: "SELECT COUNT(*) AS n FROM artifact_files",
  checkpoints: "SELECT COUNT(*) AS n FROM checkpoints",
  writes: "SELECT COUNT(*) AS n FROM writes",
};

export function countRows(db: Db, table: TableName): number {
  const row = db.prepare(COUNT_SQL[table]).get() as { n: number } | undefined;
  if (row === undefined) {
    throw new Error(`统计表 ${table} 行数失败`);
  }
  return row.n;
}

export type Check = { label: string; pass: boolean; detail: string };

export type ExperimentResult = {
  id: string;
  title: string;
  expected: string;
  actual: string;
  conclusion: string;
  pass: boolean;
  checks: Check[];
};

export type ExperimentOptions = { quiet?: boolean };

export function makeExperimentResult(input: Omit<ExperimentResult, "pass">): ExperimentResult {
  return { ...input, pass: input.checks.every((check) => check.pass) };
}

export function reportResult(result: ExperimentResult, options: ExperimentOptions = {}): void {
  if (options.quiet === true) {
    return;
  }
  console.log(`\n=== ${result.id} ${result.title} ===`);
  console.log(`预期：${result.expected}`);
  console.log(`实际：${result.actual}`);
  console.log(`结论：${result.conclusion}`);
  for (const check of result.checks) {
    console.log(`  ${check.pass ? "[通过]" : "[失败]"} ${check.label}：${check.detail}`);
  }
}

export function reportSummary(results: readonly ExperimentResult[]): boolean {
  console.log("\n=== T0 汇总 ===");
  for (const result of results) {
    console.log(`${result.pass ? "PASS" : "FAIL"}  ${result.id}  ${result.title}`);
  }
  const passed = results.filter((result) => result.pass).length;
  const allPassed = passed === results.length && results.length > 0;
  console.log(`总计：${passed}/${results.length} PASS → ${allPassed ? "PASS" : "FAIL"}`);
  return allPassed;
}
