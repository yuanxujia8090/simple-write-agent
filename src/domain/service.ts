import type {
  ArtifactContent,
  ArtifactKind,
  ArtifactVersion,
  GateDecision,
  GateId,
  GateType,
  RevisionInstruction,
  SessionMode,
  SessionState,
  Stage,
} from "./types.js";

export type CreateSessionInput = {
  title?: string;
  mode?: SessionMode;
  workspace: { root: string; workspaceId: string | null };
  now?: string;
};

export type SaveArtifactInput = {
  sessionId: string;
  kind: ArtifactKind;
  content: ArtifactContent;
  filePath?: string | null;
  parentArtifactId?: string | null;
  now?: string;
};

/** 确认卡内容：用户确认的是这一份具体产物，不是阶段名字。 */
export type ConfirmationPackage = {
  sessionId: string;
  gateId: GateId;
  gateType: GateType;
  stage: Stage;
  artifactId: string;
  artifactHash: string;
  confirmationHash: string;
  /** 给确认卡直接展示的推荐摘要（推荐论点 / 大纲标题 / 终稿标题等）。 */
  preview: string;
  recommendation: { label: string; reason: string };
  risks: string[];
  alternatives: string[];
};

export type CommitDecisionInput = {
  sessionId: string;
  gateId: GateId;
  artifactId: string;
  artifactHash: string;
  confirmationHash: string;
  decision: GateDecision;
  /** 用户原始反馈，拒绝或修改时保存。 */
  feedback?: string;
  /** 结构化修订指令，作为下一轮该阶段输入约束。 */
  directives?: string[];
  /** 测试用的故障注入点：在这些步骤之后抛错，验证全量回滚。 */
  failAfter?: "artifact" | "gate" | "stage" | "trace";
  now?: string;
};

export type CommitDecisionResult = {
  status: "applied" | "duplicate_confirmation";
  stage: Stage;
  session: SessionState;
};

export type RecordExportInput = {
  sessionId: string;
  artifactId: string;
  filePath: string;
  contentHash: string;
  now?: string;
};

/**
 * 工作流状态服务：阶段状态、确认提交和阶段的唯一写入者。
 * 节点只调 `saveTemporaryArtifact` 交候选；推进阶段只能走 `commitGateDecision`。
 */
export interface WorkflowService {
  createSession(input: CreateSessionInput): SessionState;
  getSession(sessionId: string): SessionState;
  /** 保存临时产物；同种类旧 temporary 被替换（旧临时版本不再保留）。 */
  saveTemporaryArtifact(input: SaveArtifactInput): ArtifactVersion;
  /** 为门禁生成确认卡；产物必须存在且通过契约校验。 */
  requestGate(sessionId: string, gateId: GateId): ConfirmationPackage;
  commitGateDecision(input: CommitDecisionInput): CommitDecisionResult;
  recordExport(input: RecordExportInput): SessionState;
}

export type StartInput = {
  topic: string;
  materials?: string[];
  mode?: SessionMode;
  workspace: { root: string; workspaceId: string | null };
};

export type DecisionInput = {
  decision: GateDecision;
  artifactId: string;
  artifactHash: string;
  confirmationHash: string;
  feedback?: string;
  directives?: string[];
};

export type RunOutput = {
  outlinePath: string | null;
  draftPath: string | null;
  exportedPath: string | null;
};

export type RunState = {
  status: "awaiting_confirmation" | "exported" | "failed";
  session: SessionState;
  gate: ConfirmationPackage | null;
  output: RunOutput | null;
  error: string | null;
};

/** 编排入口：start 跑到第一个门禁暂停；resume 提交决定后继续。 */
export interface GraphRunner {
  start(input: StartInput): Promise<RunState>;
  resume(input: DecisionInput): Promise<RunState>;
}

/** 修订指令的统一组装，避免各处自造字段。 */
export function buildRevision(
  feedback: string | undefined,
  directives: string[] | undefined,
): RevisionInstruction | null {
  const raw = (feedback ?? "").trim();
  const list = (directives ?? []).map((item) => item.trim()).filter((item) => item !== "");
  if (raw === "" && list.length === 0) {
    return null;
  }
  return { rawFeedback: raw, directives: list };
}
