import Database from "better-sqlite3";

import {
  FIXED_CANDIDATE_TEXT,
  FIXED_DECISION,
  FIXED_SESSION_ID,
  artifactHashOf,
  confirmationHashOf,
  countRows,
  createBusinessSchema,
  makeExperimentResult,
  makeTempWorkspace,
  sha256,
  type Check,
  type ConfirmationDecision,
  type Db,
  type ExperimentResult,
} from "./shared.js";

export const E2_ARTIFACT_ID = `art-${sha256(FIXED_CANDIDATE_TEXT).slice(0, 12)}`;

export type ConfirmationCommitInput = {
  sessionId: string;
  artifactId: string;
  artifactHash: string;
  confirmationHash: string;
  decision: ConfirmationDecision;
  nextStage: string;
};

export type ConfirmationCommitOutcome = {
  applied: boolean;
  reason: "applied" | "duplicate_confirmation";
  stage: string;
  stageVersion: number;
  confirmationEvents: number;
};

type SessionRow = { stage: string; stage_version: number };

function countConfirmationEvents(db: Db, sessionId: string): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM trace WHERE session_id = ? AND event LIKE 'confirmation:%'")
    .get(sessionId) as { n: number } | undefined;
  return row?.n ?? 0;
}

/**
 * 业务侧确认提交：同一 (artifactId, artifactHash, confirmationHash, decision) 只允许生效一次。
 * 整个判断 + 写入在同一个 sqlite 事务内完成，第二次调用不推进阶段、不重复写 trace。
 */
export function commitConfirmation(
  db: Db,
  input: ConfirmationCommitInput,
): ConfirmationCommitOutcome {
  const transaction = db.transaction((payload: ConfirmationCommitInput): ConfirmationCommitOutcome => {
    const session = db
      .prepare("SELECT stage, stage_version FROM sessions WHERE id = ?")
      .get(payload.sessionId) as SessionRow | undefined;
    if (session === undefined) {
      throw new Error(`会话不存在：${payload.sessionId}`);
    }

    const existing = db
      .prepare(
        "SELECT id FROM confirmations WHERE artifact_id = ? AND artifact_hash = ? AND confirmation_hash = ? AND decision = ?",
      )
      .get(payload.artifactId, payload.artifactHash, payload.confirmationHash, payload.decision);

    if (existing !== undefined) {
      return {
        applied: false,
        reason: "duplicate_confirmation",
        stage: session.stage,
        stageVersion: session.stage_version,
        confirmationEvents: countConfirmationEvents(db, payload.sessionId),
      };
    }

    db.prepare(
      "INSERT INTO confirmations (artifact_id, artifact_hash, confirmation_hash, decision) VALUES (?, ?, ?, ?)",
    ).run(payload.artifactId, payload.artifactHash, payload.confirmationHash, payload.decision);
    db.prepare(
      "UPDATE gates SET state = 'decided', decision = ? WHERE session_id = ? AND artifact_id = ?",
    ).run(payload.decision, payload.sessionId, payload.artifactId);
    db.prepare("UPDATE sessions SET stage = ?, stage_version = stage_version + 1 WHERE id = ?").run(
      payload.nextStage,
      payload.sessionId,
    );
    db.prepare(
      "INSERT OR IGNORE INTO trace (session_id, event, dedupe_key) VALUES (?, ?, ?)",
    ).run(
      payload.sessionId,
      `confirmation:${payload.decision}`,
      `confirmation:${payload.artifactId}:${payload.confirmationHash}`,
    );

    return {
      applied: true,
      reason: "applied",
      stage: payload.nextStage,
      stageVersion: session.stage_version + 1,
      confirmationEvents: countConfirmationEvents(db, payload.sessionId),
    };
  });

  return transaction(input);
}

export type E2Evidence = {
  firstOutcome: ConfirmationCommitOutcome;
  secondOutcome: ConfirmationCommitOutcome;
  stage: string;
  stageVersion: number;
  traceRows: number;
  confirmationEvents: number;
  confirmationRows: number;
  gateDecision: string | null;
  artifactStatus: string;
};

export type E2Result = ExperimentResult & { evidence: E2Evidence };

export async function runE2(): Promise<E2Result> {
  const workspace = await makeTempWorkspace("t0-e2-");
  const db = new Database(workspace.path("business.sqlite"));

  try {
    createBusinessSchema(db);
    const artifactHash = artifactHashOf(FIXED_CANDIDATE_TEXT);
    const confirmationHash = confirmationHashOf({
      artifactId: E2_ARTIFACT_ID,
      artifactHash,
      decision: FIXED_DECISION,
    });

    db.prepare("INSERT INTO sessions (id, stage, stage_version) VALUES (?, ?, ?)").run(
      FIXED_SESSION_ID,
      "awaiting_confirmation",
      0,
    );
    db.prepare(
      "INSERT INTO artifact_versions (id, session_id, artifact_hash, status, body) VALUES (?, ?, ?, ?, ?)",
    ).run(E2_ARTIFACT_ID, FIXED_SESSION_ID, artifactHash, "temporary", FIXED_CANDIDATE_TEXT);
    db.prepare(
      "INSERT INTO gates (id, session_id, artifact_id, artifact_hash, state, decision) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("gate-t0", FIXED_SESSION_ID, E2_ARTIFACT_ID, artifactHash, "awaiting_confirmation", null);
    db.prepare("INSERT INTO trace (session_id, event, dedupe_key) VALUES (?, ?, ?)").run(
      FIXED_SESSION_ID,
      "artifact_generated:temporary",
      `generated:${E2_ARTIFACT_ID}`,
    );

    const input: ConfirmationCommitInput = {
      sessionId: FIXED_SESSION_ID,
      artifactId: E2_ARTIFACT_ID,
      artifactHash,
      confirmationHash,
      decision: FIXED_DECISION,
      nextStage: "outline_ready",
    };

    const firstOutcome = commitConfirmation(db, input);
    const secondOutcome = commitConfirmation(db, input);

    const session = db
      .prepare("SELECT stage, stage_version FROM sessions WHERE id = ?")
      .get(FIXED_SESSION_ID) as SessionRow;
    const artifact = db
      .prepare("SELECT status FROM artifact_versions WHERE id = ?")
      .get(E2_ARTIFACT_ID) as { status: string };
    const gate = db
      .prepare("SELECT decision FROM gates WHERE id = ?")
      .get("gate-t0") as { decision: string | null };

    const checks: Check[] = [
      {
        label: "首次确认生效",
        pass: firstOutcome.applied && firstOutcome.reason === "applied",
        detail: `applied=${firstOutcome.applied} reason=${firstOutcome.reason}`,
      },
      {
        label: "重复确认被识别为已处理",
        pass: !secondOutcome.applied && secondOutcome.reason === "duplicate_confirmation",
        detail: `applied=${secondOutcome.applied} reason=${secondOutcome.reason}`,
      },
      {
        label: "阶段只推进一次",
        pass: session.stage === "outline_ready" && session.stage_version === 1,
        detail: `stage=${session.stage} stage_version=${session.stage_version}`,
      },
      {
        label: "trace 只有一条确认事件",
        pass: countConfirmationEvents(db, FIXED_SESSION_ID) === 1,
        detail: `确认事件=${countConfirmationEvents(db, FIXED_SESSION_ID)}；trace 总行数=${countRows(db, "trace")}`,
      },
      {
        label: "确认表只有一行",
        pass: countRows(db, "confirmations") === 1 && gate.decision === FIXED_DECISION,
        detail: `confirmations=${countRows(db, "confirmations")} gate.decision=${String(gate.decision)}`,
      },
      {
        label: "候选状态不被确认写入顺带改成已采纳",
        pass: artifact.status === "temporary",
        detail: `artifact_versions.status=${artifact.status}（采纳由后续版本切换决定，本实验只验证幂等）`,
      },
    ];

    const evidence: E2Evidence = {
      firstOutcome,
      secondOutcome,
      stage: session.stage,
      stageVersion: session.stage_version,
      traceRows: countRows(db, "trace"),
      confirmationEvents: countConfirmationEvents(db, FIXED_SESSION_ID),
      confirmationRows: countRows(db, "confirmations"),
      gateDecision: gate.decision,
      artifactStatus: artifact.status,
    };

    const result = makeExperimentResult({
      id: "E2",
      title: "重复确认幂等（同一决策提交两次）",
      expected: "第二次提交被识别为已处理；阶段只推进一次；trace 只有一条确认事件",
      actual: `第一次=${firstOutcome.reason} 第二次=${secondOutcome.reason}；stage_version=${session.stage_version}；确认事件=${evidence.confirmationEvents}；confirmations=${evidence.confirmationRows}`,
      conclusion: resultPass(checks)
        ? "以 (artifactId + artifactHash + confirmationHash + decision) 为唯一键，重复确认可在业务事务内识别并跳过，不会二次推进阶段"
        : "重复确认未被完整识别，见失败项",
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
