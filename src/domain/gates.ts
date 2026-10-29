import type { ArtifactKind, GateId, GateType, SessionMode, Stage } from "./types.js";

export type GateDefinition = {
  id: GateId;
  type: GateType;
  label: string;
  /** 产出该产物的阶段，也是门禁展示时所在阶段。 */
  stage: Stage;
  artifactKind: ArtifactKind;
  /** 普通模式包含全部内容门禁；快速模式只保留论点和终稿。 */
  modes: SessionMode[];
  /** 批准后进入的阶段；快速模式跳过被省略的门禁。 */
  approveStage: Record<SessionMode, Stage>;
  /** 修改或拒绝时回到的阶段（PRD §3.7）。 */
  rollbackStage: Stage;
};

export const GATE_DEFINITIONS: Record<GateId, GateDefinition> = {
  materials: {
    id: "materials",
    type: "adoption",
    label: "素材采纳",
    stage: "research",
    artifactKind: "material_batch",
    modes: ["normal"],
    approveStage: { normal: "thesis", fast: "thesis" },
    rollbackStage: "research",
  },
  thesis: {
    id: "thesis",
    type: "content",
    label: "论点确认",
    stage: "thesis",
    artifactKind: "thesis",
    modes: ["normal", "fast"],
    approveStage: { normal: "outline", fast: "drafting" },
    rollbackStage: "thesis",
  },
  outline: {
    id: "outline",
    type: "content",
    label: "大纲确认",
    stage: "outline",
    artifactKind: "outline",
    modes: ["normal"],
    approveStage: { normal: "drafting", fast: "drafting" },
    rollbackStage: "outline",
  },
  fact_report: {
    id: "fact_report",
    type: "content",
    label: "事实核查报告确认",
    stage: "review",
    artifactKind: "fact_report",
    modes: ["normal"],
    approveStage: { normal: "review", fast: "review" },
    rollbackStage: "research",
  },
  final: {
    id: "final",
    type: "content",
    label: "终稿确认",
    stage: "review",
    artifactKind: "final",
    modes: ["normal", "fast"],
    approveStage: { normal: "exported", fast: "exported" },
    rollbackStage: "drafting",
  },
};

export const ALL_GATE_IDS: GateId[] = ["materials", "thesis", "outline", "fact_report", "final"];

export function gatesForMode(mode: SessionMode): GateDefinition[] {
  return ALL_GATE_IDS.map((id) => GATE_DEFINITIONS[id]).filter((gate) => gate.modes.includes(mode));
}

/** 当前阶段应展示的门禁；同一阶段有多个（review 有事实报告与终稿）时按顺序取第一个。 */
export function gateForStage(stage: Stage, mode: SessionMode): GateDefinition | null {
  return gatesForMode(mode).find((gate) => gate.stage === stage) ?? null;
}

export function gateById(id: GateId): GateDefinition {
  return GATE_DEFINITIONS[id];
}

export function rollbackStageFor(id: GateId): Stage {
  return GATE_DEFINITIONS[id].rollbackStage;
}

export function stageAfterApprove(id: GateId, mode: SessionMode): Stage {
  return GATE_DEFINITIONS[id].approveStage[mode];
}
