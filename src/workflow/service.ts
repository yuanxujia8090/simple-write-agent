/**
 * 工作流状态服务：阶段、产出版本、门禁记录和 Trace 的唯一写入者。
 * 提交决定在深拷贝上完成，全部步骤成功后才整份落库，保证失败不留部分状态。
 * 存储由 `WorkflowStore` 提供（内存或 SQLite），本文件不含任何数据库细节。
 */
import { randomUUID } from "node:crypto";

import type { ValidationResult } from "../domain/contracts.js";
import { validateArtifact } from "../domain/contracts.js";
import type { GateDefinition } from "../domain/gates.js";
import { gateById, rollbackStageFor, stageAfterApprove } from "../domain/gates.js";
import type { WorkflowStore } from "../domain/store.js";
import type {
  CommitDecisionInput,
  CommitDecisionResult,
  ConfirmationPackage,
  CreateSessionInput,
  RecordExportInput,
  SaveArtifactInput,
  WorkflowService,
} from "../domain/service.js";
import { buildRevision } from "../domain/service.js";
import type {
  ArtifactKind,
  ArtifactVersion,
  CreativeBriefContent,
  DraftContent,
  FactReportContent,
  FinalContent,
  GateDecision,
  GateId,
  GateRecord,
  MaterialBatchContent,
  OutlineContent,
  SessionState,
  ThesisContent,
  TraceEventType,
} from "../domain/types.js";
import { AppError } from "../shared/errors.js";
import { hashContent } from "../shared/hash.js";
import { createMemoryStore } from "./memory-store.js";

const DEFAULT_SESSION_NAME = "未命名会话";

const KIND_LABELS: Record<ArtifactKind, string> = {
  creative_brief: "创作简报",
  material_batch: "素材批次",
  thesis: "论点",
  outline: "大纲",
  draft: "草稿",
  fact_report: "事实核查报告",
  final: "终稿",
};

const DECISION_LABELS: Record<GateDecision, string> = {
  approve: "已批准推荐",
  approve_alternative: "已批准备选",
  modify: "要求修改",
  reject: "已拒绝",
};

function deepCopy<T>(value: T): T {
  return structuredClone(value);
}

function contractError(result: ValidationResult): AppError {
  const detail = result.issues.map((issue) => issue.message).join("；");
  return new AppError("VALIDATION", `产物未通过阶段契约校验：${detail}`, "修正后重新生成该阶段产物");
}

function staleConfirmation(detail: string): AppError {
  return new AppError("VALIDATION", `确认卡已过期：${detail}`, "请重新生成确认卡后再提交");
}

function addTrace(
  session: SessionState,
  at: string,
  type: TraceEventType,
  detail: string,
  extra: { artifactId?: string; gateId?: GateId } = {},
): void {
  const event = { seq: session.trace.length + 1, at, type, detail } as SessionState["trace"][number];
  if (extra.artifactId !== undefined) {
    event.artifactId = extra.artifactId;
  }
  if (extra.gateId !== undefined) {
    event.gateId = extra.gateId;
  }
  session.trace.push(event);
}

/** 确认卡正文：预览、推荐、风险与备选都由产物内容推导，保证同一产物得到同一指纹。 */
function confirmationBody(artifact: ArtifactVersion): {
  preview: string;
  recommendation: { label: string; reason: string };
  risks: string[];
  alternatives: string[];
} {
  switch (artifact.kind) {
    case "creative_brief": {
      const content = artifact.content as CreativeBriefContent;
      return {
        preview: content.topic,
        recommendation: { label: "确认创作简报", reason: `目标读者：${content.audience}` },
        risks: [],
        alternatives: [],
      };
    }
    case "material_batch": {
      const content = artifact.content as MaterialBatchContent;
      const count = content.items.length;
      return {
        preview: `${count} 条素材`,
        recommendation: { label: "采纳这批素材", reason: `共 ${count} 条素材，采纳后进入研究整理` },
        risks: [],
        alternatives: [],
      };
    }
    case "thesis": {
      const content = artifact.content as ThesisContent;
      const recommended = content.candidates.find((item) => item.id === content.recommendedId);
      const claim = recommended?.claim ?? "";
      return {
        preview: claim,
        recommendation: { label: `推荐论点：${claim}`, reason: content.rationale },
        risks: [...content.risks],
        alternatives: content.candidates
          .filter((item) => item.id !== content.recommendedId)
          .map((item) => item.claim),
      };
    }
    case "outline": {
      const content = artifact.content as OutlineContent;
      return {
        preview: content.title,
        recommendation: { label: "采用该大纲", reason: `共 ${content.chapters.length} 章` },
        risks: [],
        alternatives: [],
      };
    }
    case "draft": {
      const content = artifact.content as DraftContent;
      return {
        preview: content.title,
        recommendation: { label: "采用当前草稿", reason: `正文 ${content.markdown.length} 字` },
        risks: [],
        alternatives: [],
      };
    }
    case "fact_report": {
      const content = artifact.content as FactReportContent;
      const summary = `${content.items.length} 条事实，${content.downgrades.length} 条降级改写`;
      return {
        preview: summary,
        recommendation: { label: "通过事实核查", reason: summary },
        risks: [],
        alternatives: [],
      };
    }
    case "final": {
      const content = artifact.content as FinalContent;
      return {
        preview: content.title,
        recommendation: { label: "导出终稿", reason: "事实核查与内容诊断已完成" },
        risks: [],
        alternatives: [],
      };
    }
  }
}

function confirmationHashFor(gate: GateDefinition, artifact: ArtifactVersion): string {
  const body = confirmationBody(artifact);
  return hashContent({
    gateId: gate.id,
    artifactId: artifact.id,
    artifactHash: artifact.contentHash,
    preview: body.preview,
    recommendation: body.recommendation,
    risks: body.risks,
    alternatives: body.alternatives,
    stage: gate.stage,
  });
}

function isApprove(decision: GateDecision): boolean {
  return decision === "approve" || decision === "approve_alternative";
}

export type WorkflowServiceOptions = {
  store: WorkflowStore;
  createId?: () => string;
  now?: () => string;
};

/** 业务实现；`store` 决定数据落在内存还是 SQLite。 */
export function createWorkflowService(options: WorkflowServiceOptions): WorkflowService {
  const { store } = options;
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date().toISOString());

  function requireSession(sessionId: string): SessionState {
    const session = store.loadSession(sessionId);
    if (session === null) {
      throw new AppError("VALIDATION", `会话不存在：${sessionId}`, "用 /list 查看可用会话");
    }
    return session;
  }

  function hasSession(sessionId: string): boolean {
    return store.loadSession(sessionId) !== null;
  }

  function listSessions(): SessionState[] {
    return store.listSessions();
  }

  function requireArtifact(session: SessionState, artifactId: string): ArtifactVersion {
    const artifact = session.artifacts.find((item) => item.id === artifactId);
    if (artifact === undefined) {
      throw new AppError("VALIDATION", `产物不存在：${artifactId}`, "请重新生成该阶段产物");
    }
    return artifact;
  }

  function createSession(input: CreateSessionInput): SessionState {
    const at = input.now ?? now();
    const title = input.title?.trim() ?? "";
    const session: SessionState = {
      id: `sess-${createId()}`,
      name: title === "" ? DEFAULT_SESSION_NAME : title,
      mode: input.mode ?? "normal",
      stage: "intake",
      workspace: { root: input.workspace.root, workspaceId: input.workspace.workspaceId },
      createdAt: at,
      updatedAt: at,
      artifacts: [],
      gates: [],
      trace: [],
      revisions: [],
    };
    store.saveSession(session);
    return deepCopy(session);
  }

  function getSession(sessionId: string): SessionState {
    return requireSession(sessionId);
  }

  function saveTemporaryArtifact(input: SaveArtifactInput): ArtifactVersion {
    const session = requireSession(input.sessionId);
    const validation = validateArtifact(input.kind, input.content);
    if (!validation.ok) {
      throw contractError(validation);
    }
    const at = input.now ?? now();
    const history = session.artifacts.filter((item) => item.kind === input.kind);
    const version = history.reduce((max, item) => Math.max(max, item.version), 0) + 1;
    session.artifacts = session.artifacts.filter(
      (item) => !(item.kind === input.kind && item.status === "temporary"),
    );
    const artifact: ArtifactVersion = {
      id: `art-${createId()}`,
      sessionId: session.id,
      kind: input.kind,
      status: "temporary",
      version,
      content: deepCopy(input.content),
      contentHash: hashContent(input.content),
      filePath: input.filePath ?? null,
      fileHash: input.fileHash ?? null,
      parentArtifactId: input.parentArtifactId ?? null,
      createdAt: at,
      decidedAt: null,
      statusReason: null,
    };
    session.artifacts.push(artifact);
    addTrace(session, at, "artifact_generated", `${input.kind} v${version} 已生成，等待确认`, {
      artifactId: artifact.id,
    });
    store.saveSession(session);
    return deepCopy(artifact);
  }

  function requestGate(sessionId: string, gateId: GateId): ConfirmationPackage {
    const session = requireSession(sessionId);
    const gate = gateById(gateId);
    const temporary = session.artifacts.filter(
      (item) => item.kind === gate.artifactKind && item.status === "temporary",
    );
    const artifact = temporary.reduce<ArtifactVersion | null>(
      (latest, item) => (latest === null || item.version > latest.version ? item : latest),
      null,
    );
    if (artifact === null) {
      throw new AppError(
        "VALIDATION",
        `没有待确认的${gate.label}产物`,
        "先生成该阶段产物再请求确认",
      );
    }
    const validation = validateArtifact(artifact.kind, artifact.content);
    if (!validation.ok) {
      throw contractError(validation);
    }
    const body = confirmationBody(artifact);
    const confirmationHash = confirmationHashFor(gate, artifact);
    addTrace(session, now(), "confirmation_requested", `${gate.label}确认卡已生成：${body.preview}`, {
      artifactId: artifact.id,
      gateId,
    });
    store.saveSession(session);
    return {
      sessionId: session.id,
      gateId,
      gateType: gate.type,
      stage: gate.stage,
      artifactId: artifact.id,
      artifactHash: artifact.contentHash,
      confirmationHash,
      preview: body.preview,
      recommendation: body.recommendation,
      risks: body.risks,
      alternatives: body.alternatives,
    };
  }

  function commitGateDecision(input: CommitDecisionInput): CommitDecisionResult {
    const session = requireSession(input.sessionId);
    const gate = gateById(input.gateId);
    const artifact = requireArtifact(session, input.artifactId);
    if (artifact.kind !== gate.artifactKind) {
      throw new AppError(
        "VALIDATION",
        `产物类型与${gate.label}不匹配：需要 ${gate.artifactKind}，实际 ${artifact.kind}`,
        "请重新生成该阶段产物",
      );
    }

    // 幂等检查必须在状态校验之前：批准后产物已不是 temporary，重放同一决定仍应返回 duplicate_confirmation。
    const duplicate = session.gates.find(
      (record) =>
        record.gateId === input.gateId &&
        record.artifactId === input.artifactId &&
        record.artifactHash === input.artifactHash &&
        record.confirmationHash === input.confirmationHash &&
        record.decision === input.decision,
    );
    if (duplicate !== undefined) {
      return {
        status: "duplicate_confirmation" as const,
        stage: session.stage,
        session: deepCopy(session),
      };
    }

    if (artifact.status !== "temporary") {
      throw new AppError("VALIDATION", "产物不是待确认版本", "请重新生成该阶段产物");
    }
    if (input.artifactHash !== artifact.contentHash) {
      throw staleConfirmation("产物内容已变化");
    }
    if (input.confirmationHash !== confirmationHashFor(gate, artifact)) {
      throw staleConfirmation("确认卡内容与当前产物不一致");
    }

    const revision = buildRevision(input.feedback, input.directives);
    if (input.decision === "modify" && revision === null) {
      throw new AppError(
        "VALIDATION",
        "要求修改必须提供反馈或修订指令",
        "请说明希望修改什么，或给出修订指令",
      );
    }

    const at = input.now ?? now();
    const work = deepCopy(session);
    const workArtifact = work.artifacts.find((item) => item.id === artifact.id);
    if (workArtifact === undefined) {
      throw new AppError("VALIDATION", `产物不存在：${artifact.id}`, "请重新生成该阶段产物");
    }
    const previousStage = work.stage;
    const superseded: ArtifactVersion[] = [];

    if (isApprove(input.decision)) {
      workArtifact.status = "draft";
      workArtifact.decidedAt = at;
      workArtifact.statusReason = null;
      for (const other of work.artifacts) {
        if (
          other.id !== workArtifact.id &&
          other.kind === workArtifact.kind &&
          other.status === "draft"
        ) {
          other.status = "rejected";
          other.statusReason = "superseded";
          superseded.push(other);
        }
      }
    } else {
      workArtifact.status = "rejected";
      workArtifact.decidedAt = at;
      workArtifact.statusReason = input.decision === "modify" ? "modify_requested" : "rejected";
      if (revision !== null) {
        work.revisions.push({ gateId: input.gateId, revision, at });
      }
    }
    if (input.failAfter === "artifact") {
      throw new Error("failAfter=artifact：注入故障，会话状态未提交");
    }

    const record: GateRecord = {
      id: `gate-${createId()}`,
      sessionId: work.id,
      gateId: input.gateId,
      gateType: gate.type,
      artifactId: workArtifact.id,
      artifactHash: input.artifactHash,
      confirmationHash: input.confirmationHash,
      decision: input.decision,
      revision,
      decidedAt: at,
    };
    work.gates.push(record);
    if (input.failAfter === "gate") {
      throw new Error("failAfter=gate：注入故障，会话状态未提交");
    }

    work.stage = isApprove(input.decision)
      ? stageAfterApprove(input.gateId, work.mode)
      : rollbackStageFor(input.gateId);
    if (input.failAfter === "stage") {
      throw new Error("failAfter=stage：注入故障，会话状态未提交");
    }

    addTrace(
      work,
      at,
      "confirmation_recorded",
      `${gate.label}：${DECISION_LABELS[input.decision]}`,
      { artifactId: workArtifact.id, gateId: input.gateId },
    );
    for (const item of superseded) {
      addTrace(work, at, "artifact_superseded", `${KIND_LABELS[item.kind]} v${item.version} 被新版本取代`, {
        artifactId: item.id,
      });
    }
    if (work.stage !== previousStage) {
      addTrace(work, at, "stage_changed", `阶段 ${previousStage} → ${work.stage}`, {
        gateId: input.gateId,
      });
    }
    if (input.failAfter === "trace") {
      throw new Error("failAfter=trace：注入故障，会话状态未提交");
    }

    work.updatedAt = at;
    // 一次事务：业务行 + 稳定 checkpoint 行一起可见（ADR 0012）。
    store.saveSession(work, input.checkpoint ?? null);
    return { status: "applied" as const, stage: work.stage, session: deepCopy(work) };
  }

  function recordExport(input: RecordExportInput): SessionState {
    const session = requireSession(input.sessionId);
    const artifact = requireArtifact(session, input.artifactId);
    const at = input.now ?? now();
    addTrace(session, at, "export_written", `已导出 ${input.filePath}（${input.contentHash}）`, {
      artifactId: artifact.id,
    });
    session.updatedAt = at;
    store.saveSession(session);
    return deepCopy(session);
  }

  return {
    createSession,
    getSession,
    hasSession,
    listSessions,
    saveTemporaryArtifact,
    requestGate,
    commitGateDecision,
    recordExport,
  };
}

/** 测试与重放默认入口：内存存储 + 同一套业务规则。 */
export function createInMemoryWorkflowService(
  options: { createId?: () => string; now?: () => string } = {},
): WorkflowService {
  return createWorkflowService({ store: createMemoryStore(), ...options });
}
