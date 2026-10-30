/**
 * SQLite 存储适配器：整份会话在一次事务里替换写入，可同时写稳定 checkpoint 行（ADR 0012）。
 * 业务正文以文件为权威，这里只存版本状态、指纹与 Trace。
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import Database from "better-sqlite3";

import type { PreparedCheckpoint, WorkflowStore } from "../domain/store.js";
import type {
  ArtifactContent,
  ArtifactKind,
  ArtifactStatus,
  ArtifactVersion,
  GateDecision,
  GateId,
  GateRecord,
  GateType,
  RevisionInstruction,
  SessionMode,
  SessionState,
  Stage,
  TraceEvent,
  TraceEventType,
} from "../domain/types.js";
import { AppError } from "../shared/errors.js";
import { createBusinessSchema } from "./schema.js";

type Db = Database.Database;

const CHECKPOINT_INSERT = `INSERT OR REPLACE INTO checkpoints
  (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata)
  VALUES (?, ?, ?, ?, ?, ?, ?)`;

const SESSION_UPSERT = `INSERT INTO sessions
  (id, name, mode, stage, workspace_root, workspace_id, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (id) DO UPDATE SET
    name = excluded.name,
    mode = excluded.mode,
    stage = excluded.stage,
    workspace_root = excluded.workspace_root,
    workspace_id = excluded.workspace_id,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at`;

const ARTIFACT_INSERT = `INSERT INTO artifact_versions
  (id, session_id, kind, status, version, content, content_hash, file_path, file_hash,
   parent_artifact_id, created_at, decided_at, status_reason)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const GATE_INSERT = `INSERT INTO gates
  (id, session_id, gate_id, gate_type, artifact_id, artifact_hash, confirmation_hash,
   decision, revision, decided_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const TRACE_INSERT = `INSERT INTO trace_events
  (session_id, seq, at, type, detail, artifact_id, gate_id)
  VALUES (?, ?, ?, ?, ?, ?, ?)`;

const REVISION_INSERT = `INSERT INTO revisions (session_id, gate_id, revision, at) VALUES (?, ?, ?, ?)`;

type SessionRow = {
  id: string;
  name: string;
  mode: string;
  stage: string;
  workspace_root: string;
  workspace_id: string | null;
  created_at: string;
  updated_at: string;
};

type ArtifactRow = {
  id: string;
  session_id: string;
  kind: string;
  status: string;
  version: number;
  content: string;
  content_hash: string;
  file_path: string | null;
  file_hash: string | null;
  parent_artifact_id: string | null;
  created_at: string;
  decided_at: string | null;
  status_reason: string | null;
};

type GateRow = {
  id: string;
  session_id: string;
  gate_id: string;
  gate_type: string;
  artifact_id: string;
  artifact_hash: string;
  confirmation_hash: string;
  decision: string;
  revision: string | null;
  decided_at: string;
};

type TraceRow = {
  session_id: string;
  seq: number;
  at: string;
  type: string;
  detail: string;
  artifact_id: string | null;
  gate_id: string | null;
};

type RevisionRow = {
  session_id: string;
  gate_id: string;
  revision: string;
  at: string;
};

/**
 * 打开（必要时创建）业务库并建表。WAL 与建表都在事务外完成；
 * `:memory:` 由测试使用，不落磁盘。
 */
export function openWorkflowDatabase(dbPath: string): Db {
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  createBusinessSchema(db);
  return db;
}

/** better-sqlite3 只接受 Buffer；json 序列化的字符串原样写入。 */
function toBlob(value: string | Uint8Array): string | Buffer {
  return typeof value === "string" ? value : Buffer.from(value);
}

function parseJson<T>(text: string, label: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new AppError("RUNTIME", `数据库记录损坏：${label} 不是合法 JSON`, "删除该会话或从备份恢复");
  }
}

export function createSqliteStore(db: Db): WorkflowStore {
  const deleteArtifacts = db.prepare("DELETE FROM artifact_versions WHERE session_id = ?");
  const deleteGates = db.prepare("DELETE FROM gates WHERE session_id = ?");
  const deleteTrace = db.prepare("DELETE FROM trace_events WHERE session_id = ?");
  const deleteRevisions = db.prepare("DELETE FROM revisions WHERE session_id = ?");
  const upsertSession = db.prepare(SESSION_UPSERT);
  const insertArtifact = db.prepare(ARTIFACT_INSERT);
  const insertGate = db.prepare(GATE_INSERT);
  const insertTrace = db.prepare(TRACE_INSERT);
  const insertRevision = db.prepare(REVISION_INSERT);

  const write = db.transaction((session: SessionState, checkpoint: PreparedCheckpoint | null) => {
    // 整份替换：派生行先清后插，配合事务保证外部看不到中间态。
    deleteArtifacts.run(session.id);
    deleteGates.run(session.id);
    deleteTrace.run(session.id);
    deleteRevisions.run(session.id);

    upsertSession.run(
      session.id,
      session.name,
      session.mode,
      session.stage,
      session.workspace.root,
      session.workspace.workspaceId,
      session.createdAt,
      session.updatedAt,
    );

    for (const artifact of session.artifacts) {
      insertArtifact.run(
        artifact.id,
        artifact.sessionId,
        artifact.kind,
        artifact.status,
        artifact.version,
        JSON.stringify(artifact.content),
        artifact.contentHash,
        artifact.filePath,
        artifact.fileHash,
        artifact.parentArtifactId,
        artifact.createdAt,
        artifact.decidedAt,
        artifact.statusReason,
      );
    }
    for (const gate of session.gates) {
      insertGate.run(
        gate.id,
        gate.sessionId,
        gate.gateId,
        gate.gateType,
        gate.artifactId,
        gate.artifactHash,
        gate.confirmationHash,
        gate.decision,
        gate.revision === null ? null : JSON.stringify(gate.revision),
        gate.decidedAt,
      );
    }
    for (const event of session.trace) {
      insertTrace.run(
        session.id,
        event.seq,
        event.at,
        event.type,
        event.detail,
        event.artifactId ?? null,
        event.gateId ?? null,
      );
    }
    for (const revision of session.revisions) {
      insertRevision.run(
        session.id,
        revision.gateId,
        JSON.stringify(revision.revision),
        revision.at,
      );
    }

    if (checkpoint !== null) {
      // checkpoints 表由保存器 setup() 创建；没有 checkpoint 的调用不要求它存在。
      db.prepare(CHECKPOINT_INSERT).run(
        checkpoint.threadId,
        checkpoint.checkpointNs,
        checkpoint.checkpointId,
        checkpoint.parentCheckpointId,
        checkpoint.type,
        toBlob(checkpoint.checkpoint),
        toBlob(checkpoint.metadata),
      );
    }
  });

  const selectSession = db.prepare("SELECT * FROM sessions WHERE id = ?");
  const selectAllSessions = db.prepare("SELECT * FROM sessions ORDER BY updated_at DESC");
  const selectArtifacts = db.prepare(
    "SELECT * FROM artifact_versions WHERE session_id = ? ORDER BY rowid",
  );
  const selectGates = db.prepare("SELECT * FROM gates WHERE session_id = ? ORDER BY rowid");
  const selectTrace = db.prepare(
    "SELECT * FROM trace_events WHERE session_id = ? ORDER BY seq",
  );
  const selectRevisions = db.prepare("SELECT * FROM revisions WHERE session_id = ? ORDER BY id");

  function loadSession(sessionId: string): SessionState | null {
    const row = selectSession.get(sessionId) as SessionRow | undefined;
    if (row === undefined) {
      return null;
    }
    const artifactRows = selectArtifacts.all(sessionId) as ArtifactRow[];
    const gateRows = selectGates.all(sessionId) as GateRow[];
    const traceRows = selectTrace.all(sessionId) as TraceRow[];
    const revisionRows = selectRevisions.all(sessionId) as RevisionRow[];

    const artifacts: ArtifactVersion[] = artifactRows.map((item) => ({
      id: item.id,
      sessionId: item.session_id,
      kind: item.kind as ArtifactKind,
      status: item.status as ArtifactStatus,
      version: item.version,
      content: parseJson<ArtifactContent>(item.content, `artifact_versions.content ${item.id}`),
      contentHash: item.content_hash,
      filePath: item.file_path,
      fileHash: item.file_hash,
      parentArtifactId: item.parent_artifact_id,
      createdAt: item.created_at,
      decidedAt: item.decided_at,
      statusReason: item.status_reason,
    }));

    const gates: GateRecord[] = gateRows.map((item) => ({
      id: item.id,
      sessionId: item.session_id,
      gateId: item.gate_id as GateId,
      gateType: item.gate_type as GateType,
      artifactId: item.artifact_id,
      artifactHash: item.artifact_hash,
      confirmationHash: item.confirmation_hash,
      decision: item.decision as GateDecision,
      revision:
        item.revision === null
          ? null
          : parseJson<RevisionInstruction>(item.revision, `gates.revision ${item.id}`),
      decidedAt: item.decided_at,
    }));

    const trace: TraceEvent[] = traceRows.map((item) => {
      const event: TraceEvent = {
        seq: item.seq,
        at: item.at,
        type: item.type as TraceEventType,
        detail: item.detail,
      };
      if (item.artifact_id !== null) {
        event.artifactId = item.artifact_id;
      }
      if (item.gate_id !== null) {
        event.gateId = item.gate_id as GateId;
      }
      return event;
    });

    const revisions = revisionRows.map((item) => ({
      gateId: item.gate_id as GateId,
      revision: parseJson<RevisionInstruction>(item.revision, `revisions.revision ${item.gate_id}`),
      at: item.at,
    }));

    return {
      id: row.id,
      name: row.name,
      mode: row.mode as SessionMode,
      stage: row.stage as Stage,
      workspace: { root: row.workspace_root, workspaceId: row.workspace_id },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      artifacts,
      gates,
      trace,
      revisions,
    };
  }

  return {
    saveSession(session: SessionState, checkpoint?: PreparedCheckpoint | null): void {
      write(session, checkpoint ?? null);
    },
    loadSession,
    listSessions(): SessionState[] {
      const rows = selectAllSessions.all() as SessionRow[];
      const sessions: SessionState[] = [];
      for (const row of rows) {
        const session = loadSession(row.id);
        if (session !== null) {
          sessions.push(session);
        }
      }
      return sessions;
    },
  };
}
