/** 领域类型：阶段、产物、门禁、修订指令。这里只有类型与常量，不含 IO。 */

export const STAGES = [
  "idle",
  "intake",
  "research",
  "thesis",
  "outline",
  "drafting",
  "review",
  "exported",
] as const;

export type Stage = (typeof STAGES)[number];

export type SessionMode = "normal" | "fast";

export type ArtifactKind =
  | "creative_brief"
  | "material_batch"
  | "thesis"
  | "outline"
  | "draft"
  | "fact_report"
  | "final";

export type ArtifactStatus = "temporary" | "draft" | "rejected";

// ---- 阶段产物内容 ----

export type CreativeBriefContent = {
  topic: string;
  audience: string;
  purpose: string;
  constraints?: string[];
  tone?: string | null;
};

export type MaterialBatchContent = {
  items: {
    name: string;
    sourcePath: string | null;
    note: string;
  }[];
};

export type ThesisCandidate = {
  id: string;
  claim: string;
  reasoning: string;
  relationToBrief: string;
};

export type ThesisContent = {
  candidates: ThesisCandidate[];
  recommendedId: string;
  rationale: string;
  risks: string[];
};

export type OutlineChapter = {
  heading: string;
  goal: string;
};

export type OutlineContent = {
  title: string;
  chapters: OutlineChapter[];
};

export type DraftContent = {
  title: string;
  markdown: string;
};

export type FactKind = "external_fact" | "personal_experience" | "opinion" | "guess";

export type VerifyStatus = "verified" | "unverified" | "disputed";

export type FactReasonCode = "missing_source" | "unverifiable" | "unverified_material";

export type FactCheckItem = {
  fact: string;
  source: string | null;
  kind: FactKind;
  verifyStatus: VerifyStatus;
  reasonCode: FactReasonCode | null;
};

export type FactReportContent = {
  items: FactCheckItem[];
  /** 快速模式自动降级的改写清单；每条只降级、不新增。 */
  downgrades: { fact: string; reasonCode: FactReasonCode }[];
};

export type FinalContent = {
  title: string;
  markdown: string;
  factReportArtifactId: string;
};

export type ArtifactContent =
  | CreativeBriefContent
  | MaterialBatchContent
  | ThesisContent
  | OutlineContent
  | DraftContent
  | FactReportContent
  | FinalContent;

// ---- 版本与门禁 ----

export type ArtifactVersion = {
  id: string;
  sessionId: string;
  kind: ArtifactKind;
  status: ArtifactStatus;
  /** 同一会话内同种类产物的递增序号，从 1 开始。 */
  version: number;
  content: ArtifactContent;
  contentHash: string;
  /** 落盘产物才有；内存结构化产物为 null。 */
  filePath: string | null;
  /** 上游产物（如大纲引用论点的 artifactId），没有则 null。 */
  parentArtifactId: string | null;
  createdAt: string;
  decidedAt: string | null;
  /** 被拒绝或被新版本取代时的原因码，便于回放。 */
  statusReason: string | null;
};

export type GateId = "materials" | "thesis" | "outline" | "fact_report" | "final";

export type GateType = "adoption" | "content";

export type GateDecision = "approve" | "approve_alternative" | "modify" | "reject";

export type RevisionInstruction = {
  /** 用户原始反馈，原样保留。 */
  rawFeedback: string;
  /** 结构化修订指令，作为下一轮该阶段输入约束。 */
  directives: string[];
};

export type GateRecord = {
  id: string;
  sessionId: string;
  gateId: GateId;
  gateType: GateType;
  artifactId: string;
  artifactHash: string;
  confirmationHash: string;
  decision: GateDecision;
  revision: RevisionInstruction | null;
  decidedAt: string;
};

export type TraceEventType =
  | "artifact_generated"
  | "confirmation_requested"
  | "confirmation_recorded"
  | "stage_changed"
  | "artifact_superseded"
  | "export_written"
  | "error";

export type TraceEvent = {
  seq: number;
  at: string;
  type: TraceEventType;
  /** 已脱敏的简短描述；不含密钥。 */
  detail: string;
  artifactId?: string;
  gateId?: GateId;
};

export type SessionState = {
  id: string;
  name: string;
  mode: SessionMode;
  stage: Stage;
  workspace: {
    root: string;
    workspaceId: string | null;
  };
  createdAt: string;
  updatedAt: string;
  artifacts: ArtifactVersion[];
  gates: GateRecord[];
  trace: TraceEvent[];
  /** 待应用的修订指令，按门禁保存，供下一轮读取。 */
  revisions: { gateId: GateId; revision: RevisionInstruction; at: string }[];
};
