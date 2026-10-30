/**
 * 写作编排图：生成节点只交临时候选，门禁用 interrupt 暂停，阶段推进只发生在
 * `service.commitGateDecision`。本阶段用进程内 MemorySaver，不做跨进程恢复。
 */
import {
  Annotation,
  END,
  MemorySaver,
  START,
  StateGraph,
  interrupt,
  type BaseCheckpointSaver,
} from "@langchain/langgraph";

import type { FileWriter } from "../domain/files.js";
import type { CheckpointPort } from "../domain/store.js";
import { gatesForMode, rollbackStageFor } from "../domain/gates.js";
import type { ConfirmationPackage, WorkflowService } from "../domain/service.js";
import type {
  ArtifactContent,
  ArtifactKind,
  CreativeBriefContent,
  DraftContent,
  FactReportContent,
  FinalContent,
  GateDecision,
  GateId,
  MaterialBatchContent,
  OutlineContent,
  SessionMode,
  Stage,
  ThesisContent,
} from "../domain/types.js";
import { AppError } from "../shared/errors.js";
import { fixedModel, type WritingModel } from "./fixed-model.js";

/** 节点顺序即流程顺序；门禁节点的条件边也复用这份名称集合。 */
const FLOW_NODES = [
  "intake",
  "research",
  "materialsGate",
  "thesis",
  "thesisGate",
  "outline",
  "outlineGate",
  "drafting",
  "review",
  "factGate",
  "finalGate",
  "export",
] as const;

export type FlowNode = (typeof FLOW_NODES)[number];

const FLOW_NODE_LIST: FlowNode[] = [...FLOW_NODES];

/** 回退目标阶段对应的重跑节点；门禁只回退到这几处。 */
const STAGE_NODES: Partial<Record<Stage, FlowNode>> = {
  research: "research",
  thesis: "thesis",
  outline: "outline",
  drafting: "drafting",
};

export type ArtifactRef = { id: string; hash: string };

/** 生成节点的产出：指纹进状态用于门禁核对，内容供下游节点使用。 */
export type Generated<Content> = { ref: ArtifactRef; content: Content; fileHash: string | null };

/** 产出一旦生成就覆盖旧槽位；未生成的槽位读到 null。 */
function slot<Value>(initial: Value) {
  return Annotation<Value>({
    reducer: (_current: Value, update: Value) => update,
    default: () => initial,
  });
}

const WritingState = Annotation.Root({
  sessionId: Annotation<string>(),
  mode: Annotation<SessionMode>(),
  workspaceRoot: Annotation<string>(),
  topic: Annotation<string>(),
  suppliedMaterials: Annotation<string[]>({
    reducer: (left: string[], right: string[]) => left.concat(right),
    default: () => [],
  }),
  briefArtifact: slot<Generated<CreativeBriefContent> | null>(null),
  materialsArtifact: slot<Generated<MaterialBatchContent> | null>(null),
  thesisArtifact: slot<Generated<ThesisContent> | null>(null),
  outlineArtifact: slot<Generated<OutlineContent> | null>(null),
  draftArtifact: slot<Generated<DraftContent> | null>(null),
  factReportArtifact: slot<Generated<FactReportContent> | null>(null),
  finalArtifact: slot<Generated<FinalContent> | null>(null),
  outlineFilePath: slot<string | null>(null),
  draftFilePath: slot<string | null>(null),
  draftFileHash: slot<string | null>(null),
  exportedFilePath: slot<string | null>(null),
  next: slot<FlowNode>("intake"),
});

export type WritingGraphState = typeof WritingState.State;

/** 确认门禁恢复时注入的决定，由调用方在 resume 时写入。 */
export type GateResume = {
  decision: GateDecision;
  feedback?: string;
  directives?: string[];
};

export type WritingGraphOptions = {
  service: WorkflowService;
  files: FileWriter;
  model?: WritingModel;
  /** 默认进程内 MemorySaver；传 SqliteSaver 才能跨进程恢复。 */
  checkpointer?: BaseCheckpointSaver;
  /** 提供后，门禁提交会把稳定 checkpoint 与业务状态写进同一事务。 */
  checkpoints?: CheckpointPort;
};

function requireGenerated<Content>(
  value: Generated<Content> | null,
  label: string,
): Generated<Content> {
  if (value === null) {
    throw new Error(`缺少上游产物：${label}`);
  }
  return value;
}

function nodeForStage(stage: Stage): FlowNode {
  const node = STAGE_NODES[stage];
  if (node === undefined) {
    throw new Error(`阶段 ${stage} 没有对应的生成节点，无法回退`);
  }
  return node;
}

/** 验收用的大纲文件内容；与结构化大纲同源，避免两处各写一份章节。 */
function renderOutlineMarkdown(outline: OutlineContent): string {
  const chapters = outline.chapters
    .map((chapter, index) => `## ${index + 1}. ${chapter.heading}\n\n${chapter.goal}`)
    .join("\n\n");
  return `# ${outline.title}\n\n${chapters}\n`;
}

export function createWritingGraph(options: WritingGraphOptions) {
  const { service, files } = options;
  const model = options.model ?? fixedModel;
  const checkpointer = options.checkpointer ?? new MemorySaver();
  const checkpoints = options.checkpoints;

  const save = <Content extends ArtifactContent>(
    sessionId: string,
    kind: ArtifactKind,
    content: Content,
    parent: ArtifactRef | null,
    filePath: string | null = null,
    fileHash: string | null = null,
  ): Generated<Content> => {
    const artifact = service.saveTemporaryArtifact({
      sessionId,
      kind,
      content,
      filePath,
      fileHash,
      parentArtifactId: parent?.id ?? null,
    });
    return { ref: { id: artifact.id, hash: artifact.contentHash }, content, fileHash };
  };

  /**
   * 门禁节点：先向服务取确认卡，再 interrupt 暂停；恢复后只把用户决定交给
   * `commitGateDecision`，并按结果前进或回退到 `rollbackStageFor(gateId)` 对应节点。
   * LangGraph 恢复时会从节点开头重跑，因此本节点的 `requestGate` 会被调用两次，
   * 提交用的是第二次（也就是恢复时）取得的确认卡；服务侧必须让该调用保持只读或幂等。
   */
  const gateStep = async (
    state: WritingGraphState,
    gateId: GateId,
    approvedNext: FlowNode,
  ): Promise<{ next: FlowNode }> => {
    // review 阶段同时有事实核查与终稿两个门禁，gateForStage 只会返回第一个，
    // 因此按 gateId 在当前模式的门禁集合里精确查找，跳过与否都由模式定义决定。
    const enabledGate = gatesForMode(state.mode).find((gate) => gate.id === gateId);
    if (enabledGate === undefined) {
      return { next: approvedNext };
    }

    const confirmation = service.requestGate(state.sessionId, gateId);
    const resume = interrupt<ConfirmationPackage, GateResume>(confirmation);
    // 恢复后只在这里取一次稳定 checkpoint：序列化在事务外完成，写入与业务行同事务。
    const checkpoint =
      checkpoints === undefined ? null : await checkpoints.prepare(state.sessionId);
    service.commitGateDecision({
      sessionId: state.sessionId,
      gateId,
      artifactId: confirmation.artifactId,
      artifactHash: confirmation.artifactHash,
      confirmationHash: confirmation.confirmationHash,
      decision: resume.decision,
      ...(resume.feedback === undefined ? {} : { feedback: resume.feedback }),
      ...(resume.directives === undefined ? {} : { directives: resume.directives }),
      checkpoint,
    });

    const approved = resume.decision === "approve" || resume.decision === "approve_alternative";
    return { next: approved ? approvedNext : nodeForStage(rollbackStageFor(gateId)) };
  };

  const intake = (state: WritingGraphState) => {
    const brief = model.brief({ topic: state.topic });
    return { briefArtifact: save(state.sessionId, "creative_brief", brief, null) };
  };

  const research = (state: WritingGraphState) => {
    const materials = model.materials({
      topic: state.topic,
      supplied: state.suppliedMaterials,
    });
    return {
      materialsArtifact: save(
        state.sessionId,
        "material_batch",
        materials,
        state.briefArtifact?.ref ?? null,
      ),
    };
  };

  const materialsGate = (state: WritingGraphState) => gateStep(state, "materials", "thesis");

  const generateThesis = (state: WritingGraphState) => {
    const brief = requireGenerated(state.briefArtifact, "创作简报");
    const materials = requireGenerated(state.materialsArtifact, "素材批次");
    const content = model.thesis({ brief: brief.content, materials: materials.content });
    return { thesisArtifact: save(state.sessionId, "thesis", content, materials.ref) };
  };

  const thesisGate = (state: WritingGraphState) => gateStep(state, "thesis", "outline");

  const generateOutline = (state: WritingGraphState) => {
    const brief = requireGenerated(state.briefArtifact, "创作简报");
    const thesisArtifact = requireGenerated(state.thesisArtifact, "论点");
    const content = model.outline({ brief: brief.content, thesis: thesisArtifact.content });
    const file = files.writeOutline({
      workspaceRoot: state.workspaceRoot,
      title: content.title,
      markdown: renderOutlineMarkdown(content),
    });
    return {
      outlineArtifact: save(
        state.sessionId,
        "outline",
        content,
        thesisArtifact.ref,
        file.path,
        file.hash,
      ),
      outlineFilePath: file.path,
    };
  };

  const outlineGate = (state: WritingGraphState) => gateStep(state, "outline", "drafting");

  const generateDraft = (state: WritingGraphState) => {
    const outlineArtifact = requireGenerated(state.outlineArtifact, "大纲");
    const thesisArtifact = requireGenerated(state.thesisArtifact, "论点");
    const content = model.draft({
      outline: outlineArtifact.content,
      thesis: thesisArtifact.content,
    });
    const file = files.writeDraft({
      workspaceRoot: state.workspaceRoot,
      title: content.title,
      markdown: content.markdown,
    });
    return {
      draftArtifact: save(
        state.sessionId,
        "draft",
        content,
        outlineArtifact.ref,
        file.path,
        file.hash,
      ),
      draftFilePath: file.path,
      draftFileHash: file.hash,
    };
  };

  /**
   * review 阶段产出事实核查报告与终稿两种产物，节点顺序里没有独立的终稿生成节点，
   * 所以两者都在本节点生成。终稿只引用本次生成的事实核查报告版本；报告被修改或
   * 拒绝时，流程会回到上游，下一次执行本节点会覆盖这两个临时产物。
   */
  const generateReviewArtifacts = (state: WritingGraphState) => {
    const draft = requireGenerated(state.draftArtifact, "主稿");
    const factReportContent = model.factReport({ draft: draft.content });
    const factReportArtifact = save(
      state.sessionId,
      "fact_report",
      factReportContent,
      draft.ref,
    );

    const body = model.final({ draft: draft.content, factReport: factReportContent });
    const finalContent: FinalContent = {
      title: body.title,
      markdown: body.markdown,
      factReportArtifactId: factReportArtifact.ref.id,
    };
    const finalArtifact = save(state.sessionId, "final", finalContent, factReportArtifact.ref);

    return { factReportArtifact, finalArtifact };
  };

  const factGate = (state: WritingGraphState) => gateStep(state, "fact_report", "finalGate");

  /**
   * 外部编辑检测：磁盘主稿与本会话记录的文件指纹不一致时，不覆盖用户改动。
   * 门禁前也检查一次：确认的是磁盘上那份稿子，改了就不该按旧确认推进。
   */
  const verifyDraftUnchanged = (state: WritingGraphState): void => {
    if (state.draftFilePath === null || state.draftFileHash === null) {
      return;
    }
    const onDisk = files.readHash(state.draftFilePath);
    if (onDisk !== state.draftFileHash) {
      throw new AppError(
        "VALIDATION",
        `主稿已被外部修改，未覆盖：${state.draftFilePath}`,
        "保留或另存你的改动后重新确认；本次没有写入任何文件",
      );
    }
  };

  const finalGate = (state: WritingGraphState) => {
    verifyDraftUnchanged(state);
    return gateStep(state, "final", "export");
  };

  const exportFinal = (state: WritingGraphState) => {
    const final = requireGenerated(state.finalArtifact, "终稿");
    // 最后一道防线：门禁到导出之间文件仍可能被改。
    verifyDraftUnchanged(state);
    const file = files.exportMarkdown({
      workspaceRoot: state.workspaceRoot,
      title: final.content.title,
      markdown: final.content.markdown,
      // 默认导出位置就是本会话自己的主稿：替换它，而不是另存一份 -2
      ...(state.draftFilePath === null ? {} : { replacePath: state.draftFilePath }),
    });
    service.recordExport({
      sessionId: state.sessionId,
      artifactId: final.ref.id,
      filePath: file.path,
      contentHash: file.hash,
    });
    return { exportedFilePath: file.path };
  };

  return new StateGraph(WritingState)
    .addNode("intake", intake)
    .addNode("research", research)
    .addNode("materialsGate", materialsGate)
    .addNode("thesis", generateThesis)
    .addNode("thesisGate", thesisGate)
    .addNode("outline", generateOutline)
    .addNode("outlineGate", outlineGate)
    .addNode("drafting", generateDraft)
    .addNode("review", generateReviewArtifacts)
    .addNode("factGate", factGate)
    .addNode("finalGate", finalGate)
    .addNode("export", exportFinal)
    .addEdge(START, "intake")
    .addEdge("intake", "research")
    .addEdge("research", "materialsGate")
    .addConditionalEdges("materialsGate", (state) => state.next, FLOW_NODE_LIST)
    .addEdge("thesis", "thesisGate")
    .addConditionalEdges("thesisGate", (state) => state.next, FLOW_NODE_LIST)
    .addEdge("outline", "outlineGate")
    .addConditionalEdges("outlineGate", (state) => state.next, FLOW_NODE_LIST)
    .addEdge("drafting", "review")
    .addEdge("review", "factGate")
    .addConditionalEdges("factGate", (state) => state.next, FLOW_NODE_LIST)
    .addConditionalEdges("finalGate", (state) => state.next, FLOW_NODE_LIST)
    .addEdge("export", END)
    .compile({ checkpointer });
}
