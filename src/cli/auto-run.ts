/**
 * 非交互创作推进：start 后对所有门禁自动批准，直到 exported / failed。
 * 与 replay 基本场景同源语义，供 CLI 主路径在无 TUI 时跑通。
 */
import { createGraphRunner } from "../agent/runner.js";
import { createFileWriter } from "../artifacts/files.js";
import { loadTheme, type Theme } from "../config/theme.js";
import type { WritingModel } from "../agent/fixed-model.js";
import type {
  ConfirmationPackage,
  DecisionInput,
  GraphRunner,
  RunOutput,
  RunState,
  StartInput,
} from "../domain/service.js";
import type { StyleProfile } from "../style/index.js";
import { createInMemoryWorkflowService } from "../workflow/service.js";
import { AppError } from "../shared/errors.js";

export type AutoRunOptions = {
  topic: string;
  materials: string[];
  mode: "normal" | "fast";
  workspaceRoot: string;
  workspaceId: string | null;
  model?: WritingModel;
  theme?: Theme;
  styleProfile?: StyleProfile | null;
  /** 测试可注入 runner；默认内存业务库 + 固定/注入模型。 */
  runner?: GraphRunner;
  maxGates?: number;
  /**
   * 门禁确认。不给就自动批准（现有非交互行为）。
   * 给了就让调用方逐道门禁决定，`index` 从 1 开始，供确认卡编号。
   */
  confirm?: (gate: ConfirmationPackage, index: number) => Promise<DecisionInput>;
};

export type AutoRunResult = {
  status: RunState["status"];
  stage: string;
  output: RunOutput;
  gateCount: number;
  error: string | null;
  sessionId: string;
};

function approve(gate: NonNullable<RunState["gate"]>): DecisionInput {
  return {
    artifactId: gate.artifactId,
    artifactHash: gate.artifactHash,
    confirmationHash: gate.confirmationHash,
    decision: "approve",
  };
}

export async function runAutoApprovedWriting(options: AutoRunOptions): Promise<AutoRunResult> {
  const theme =
    options.theme ??
    loadTheme({}).theme;
  const service = createInMemoryWorkflowService();
  const runner =
    options.runner ??
    createGraphRunner({
      service,
      files: createFileWriter(),
      theme,
      ...(options.model === undefined ? {} : { model: options.model }),
      ...(options.styleProfile === undefined ? {} : { styleProfile: options.styleProfile }),
    });

  const startInput: StartInput = {
    topic: options.topic,
    materials: options.materials,
    mode: options.mode,
    workspace: { root: options.workspaceRoot, workspaceId: options.workspaceId },
  };

  let state = await runner.start(startInput);
  let gateCount = 0;
  const maxGates = options.maxGates ?? 12;

  while (state.status === "awaiting_confirmation" && state.gate !== null) {
    gateCount += 1;
    if (gateCount > maxGates) {
      throw new AppError(
        "RUNTIME",
        `创作超过 ${maxGates} 个门禁仍未结束`,
        "可能存在回退死循环；请带 --debug 重试或改用 npm run replay 排查",
      );
    }
    state = await runner.resume(
      options.confirm === undefined
        ? approve(state.gate)
        : await options.confirm(state.gate, gateCount),
    );
  }

  const emptyOutput: RunOutput = {
    outlinePath: null,
    draftPath: null,
    exportedPath: null,
    htmlPath: null,
    htmlError: null,
  };

  return {
    status: state.status,
    stage: state.session.stage,
    output: state.output ?? emptyOutput,
    gateCount,
    error: state.error,
    sessionId: state.session.id,
  };
}
