/**
 * 运行入口：start 跑到第一个门禁暂停，resume 校验确认指纹后续跑。
 * 图状态与业务状态各存一份，调用方只看到 RunState。
 */
import { Command, INTERRUPT, isInterrupted, type BaseCheckpointSaver } from "@langchain/langgraph";

import { AppError } from "../shared/errors.js";
import type { Theme } from "../config/theme.js";
import type { FileWriter } from "../domain/files.js";
import type { CheckpointPort } from "../domain/store.js";
import type {
  ConfirmationPackage,
  DecisionInput,
  GraphRunner,
  RunOutput,
  RunState,
  StartInput,
  WorkflowService,
} from "../domain/service.js";
import type { WritingModel } from "./fixed-model.js";
import type { StyleProfile } from "../style/index.js";
import { createWritingGraph, type WritingGraphState } from "./graph.js";

export type GraphRunnerOptions = {
  service: WorkflowService;
  files: FileWriter;
  model?: WritingModel;
  /** 传 SqliteSaver 才能跨进程恢复；不传则用进程内 MemorySaver。 */
  checkpointer?: BaseCheckpointSaver;
  /** 稳定 checkpoint 与业务状态同事务提交的取用口（ADR 0012）。 */
  checkpoints?: CheckpointPort;
  /** 导出 HTML 用主题；不传用内置默认主题。 */
  theme?: Theme;
  /** 本地风格包；暴露给装配方，真实模型应在 createAiWritingModel 时注入同一份。 */
  styleProfile?: StyleProfile | null;
};

function errorMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `写作流程执行失败：${detail}`;
}

const runnerStyleProfiles = new WeakMap<GraphRunner, StyleProfile | null>();

/** 读取装配时绑定的风格包；未指定时为 null。 */
export function getRunnerStyleProfile(runner: GraphRunner): StyleProfile | null {
  return runnerStyleProfiles.get(runner) ?? null;
}

export function createGraphRunner(options: GraphRunnerOptions): GraphRunner {
  const { service } = options;
  const styleProfile = options.styleProfile ?? null;
  const graph = createWritingGraph(options);

  let sessionId: string | null = null;
  let pendingGate: ConfirmationPackage | null = null;
  const output: RunOutput = {
    outlinePath: null,
    draftPath: null,
    exportedPath: null,
    htmlPath: null,
    htmlError: null,
  };

  const requireSessionId = (): string => {
    if (sessionId === null) {
      throw new Error("尚未启动写作会话：先调用 start()");
    }
    return sessionId;
  };

  const threadConfig = (id: string) => ({ configurable: { thread_id: id } });

  const recordPaths = (values: WritingGraphState): void => {
    output.outlinePath = values.outlineFilePath ?? null;
    output.draftPath = values.draftFilePath ?? null;
    output.exportedPath = values.exportedFilePath ?? null;
    output.htmlPath = values.htmlFilePath ?? null;
    output.htmlError = values.htmlError ?? null;
  };

  const snapshot = (): RunOutput => ({ ...output });

  const fail = (error: string, gate: ConfirmationPackage | null): RunState => ({
    status: "failed",
    session: service.getSession(requireSessionId()),
    gate,
    output: snapshot(),
    error,
  });

  /** 统一解读一次运行结果：命中 `__interrupt__` 即停在门禁，否则流程已导出。 */
  const settle = (values: WritingGraphState): RunState => {
    recordPaths(values);
    const interrupts = isInterrupted<ConfirmationPackage>(values) ? values[INTERRUPT] : [];
    const gate = interrupts[0]?.value ?? null;
    const session = service.getSession(requireSessionId());
    if (gate === null) {
      pendingGate = null;
      return {
        status: "exported",
        session,
        gate: null,
        output: snapshot(),
        error: null,
      };
    }
    pendingGate = gate;
    return {
      status: "awaiting_confirmation",
      session,
      gate,
      output: snapshot(),
      error: null,
    };
  };

  /**
   * 重新打开已有会话：业务状态从 store 读，未决确认卡从 LangGraph checkpoint 读。
   * 会话不存在时直接抛错，不返回半成品 RunState。
   */
  const openSession = async (sessionIdToOpen: string): Promise<RunState> => {
    if (!service.hasSession(sessionIdToOpen)) {
      throw new AppError("VALIDATION", `会话不存在：${sessionIdToOpen}`, "用 /list 查看可用会话");
    }
    sessionId = sessionIdToOpen;
    output.outlinePath = null;
    output.draftPath = null;
    output.exportedPath = null;
    output.htmlPath = null;
    output.htmlError = null;

    const snapshotState = await graph.getState(threadConfig(sessionIdToOpen));
    const gate =
      snapshotState.tasks
        .flatMap((task) => task.interrupts ?? [])
        .map((item) => item.value as ConfirmationPackage)[0] ?? null;
    pendingGate = gate;
    const session = service.getSession(sessionIdToOpen);
    if (gate === null) {
      return { status: "exported", session, gate: null, output: snapshot(), error: null };
    }
    return { status: "awaiting_confirmation", session, gate, output: snapshot(), error: null };
  };

  const start = async (input: StartInput): Promise<RunState> => {
    const session = service.createSession({
      title: input.topic,
      mode: input.mode ?? "normal",
      workspace: input.workspace,
    });
    sessionId = session.id;
    pendingGate = null;
    output.outlinePath = null;
    output.draftPath = null;
    output.exportedPath = null;
    output.htmlPath = null;
    output.htmlError = null;

    const initial: WritingGraphState = {
      sessionId: session.id,
      mode: session.mode,
      workspaceRoot: session.workspace.root,
      topic: input.topic,
      suppliedMaterials: input.materials ?? [],
      briefArtifact: null,
      materialsArtifact: null,
      thesisArtifact: null,
      outlineArtifact: null,
      draftArtifact: null,
      factReportArtifact: null,
      finalArtifact: null,
      outlineFilePath: null,
      draftFilePath: null,
      draftFileHash: null,
      exportedFilePath: null,
      htmlFilePath: null,
      htmlError: null,
      next: "intake",
    };

    try {
      const values = await graph.invoke(initial, threadConfig(session.id));
      return settle(values);
    } catch (error) {
      return fail(errorMessage(error), null);
    }
  };

  const resume = async (input: DecisionInput): Promise<RunState> => {
    const currentSessionId = requireSessionId();
    const gate = pendingGate;
    if (gate === null) {
      return fail("当前没有等待确认的门禁，无法提交确认", null);
    }
    if (
      input.artifactId !== gate.artifactId ||
      input.artifactHash !== gate.artifactHash ||
      input.confirmationHash !== gate.confirmationHash
    ) {
      return fail(
        `确认已过期：提交的 artifactId/artifactHash/confirmationHash 与门禁 ${gate.gateId} 当前确认卡不一致，请重新生成确认卡`,
        gate,
      );
    }

    try {
      const values = await graph.invoke(
        new Command({
          resume: {
            decision: input.decision,
            ...(input.feedback === undefined ? {} : { feedback: input.feedback }),
            ...(input.directives === undefined ? {} : { directives: input.directives }),
          },
        }),
        threadConfig(currentSessionId),
      );
      return settle(values);
    } catch (error) {
      return fail(errorMessage(error), null);
    }
  };

  const runner: GraphRunner = {
    start,
    resume,
    openSession,
    listSessions: () => service.listSessions(),
  };
  runnerStyleProfiles.set(runner, styleProfile);
  return runner;
}
