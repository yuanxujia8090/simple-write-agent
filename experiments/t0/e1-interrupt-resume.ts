import Database from "better-sqlite3";
import { Annotation, Command, END, START, StateGraph, interrupt } from "@langchain/langgraph";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";

import {
  FIXED_CANDIDATE_TEXT,
  FIXED_SESSION_ID,
  FIXED_THREAD_ID,
  artifactHashOf,
  countRows,
  makeExperimentResult,
  makeTempWorkspace,
  sha256,
  type Check,
  type ExperimentResult,
} from "./shared.js";

type InterruptPayload = {
  kind: "confirmation_gate";
  sessionId: string;
  artifactId: string;
  artifactHash: string;
};

/** E1 只覆盖「重新打开确认卡但仍未决定」这一种恢复，避免把确认结果混进生成实验。 */
type GateResume = { decision: "defer" };

const DraftState = Annotation.Root({
  sessionId: Annotation<string>,
  stage: Annotation<string>,
  artifactId: Annotation<string>,
  artifactHash: Annotation<string>,
  artifactStatus: Annotation<"temporary" | "draft">,
  artifactText: Annotation<string>,
  userDecision: Annotation<string>,
  trace: Annotation<string[]>({
    reducer: (left: string[], right: string[]) => left.concat(right),
    default: () => [],
  }),
});

/**
 * 生成节点：只产生 temporary 候选，不询问用户。
 * 门禁节点：interrupt 停在确认卡；恢复后只记录用户决定，不自行提升候选状态。
 */
export function buildDraftGraph(saver: SqliteSaver, log: string[]) {
  const generate = (state: typeof DraftState.State): typeof DraftState.Update => {
    log.push("generate");
    return {
      artifactId: `art-${sha256(state.artifactText).slice(0, 12)}`,
      artifactHash: artifactHashOf(state.artifactText),
      artifactStatus: "temporary",
      stage: "awaiting_confirmation",
      trace: ["artifact_generated:temporary"],
    };
  };

  const confirmGate = (state: typeof DraftState.State): typeof DraftState.Update => {
    log.push("confirmGate");
    const payload: InterruptPayload = {
      kind: "confirmation_gate",
      sessionId: state.sessionId,
      artifactId: state.artifactId,
      artifactHash: state.artifactHash,
    };
    const resume = interrupt<InterruptPayload, GateResume>(payload);
    return {
      userDecision: resume.decision,
      trace: [`confirmation_recorded:${resume.decision}`],
    };
  };

  return new StateGraph(DraftState)
    .addNode("generate", generate)
    .addNode("confirmGate", confirmGate)
    .addEdge(START, "generate")
    .addEdge("generate", "confirmGate")
    .addEdge("confirmGate", END)
    .compile({ checkpointer: saver });
}

export const initialDraftState: typeof DraftState.State = {
  sessionId: FIXED_SESSION_ID,
  stage: "drafting",
  artifactId: "",
  artifactHash: "",
  artifactStatus: "temporary",
  artifactText: FIXED_CANDIDATE_TEXT,
  userDecision: "",
  trace: [],
};

export type E1Evidence = {
  artifactIdBefore: string;
  artifactIdAfter: string;
  artifactHashBefore: string;
  artifactHashAfter: string;
  expectedArtifactHash: string;
  statusAfterResume: string;
  stageAfterResume: string;
  stageBeforeResume: string;
  traceAfterResume: string[];
  interruptStoppedAt: string[];
  generateNodeRunsAfterResume: number;
  checkpointRows: number;
};

export type E1Result = ExperimentResult & { evidence: E1Evidence };

export async function runE1(): Promise<E1Result> {
  const workspace = await makeTempWorkspace("t0-e1-");
  const dbPath = workspace.path("checkpoints.sqlite");
  let db = new Database(dbPath);

  try {
    // 第一段：生成候选后停在确认门禁，落盘到临时 db。
    const firstLog: string[] = [];
    const firstGraph = buildDraftGraph(new SqliteSaver(db), firstLog);
    const config = { configurable: { thread_id: FIXED_THREAD_ID } };
    await firstGraph.invoke(initialDraftState, config);
    const paused = await firstGraph.getState(config);
    const pausedValues = paused.values;
    const artifactIdBefore = pausedValues.artifactId;
    const artifactHashBefore = pausedValues.artifactHash;
    db.close();

    // 第二段：新开 Database 连接 + 新 SqliteSaver 实例，从同一 thread 恢复。
    db = new Database(dbPath);
    const resumeLog: string[] = [];
    const resumedGraph = buildDraftGraph(new SqliteSaver(db), resumeLog);
    await resumedGraph.invoke(new Command({ resume: { decision: "defer" } satisfies GateResume }), config);
    const finalSnapshot = await resumedGraph.getState(config);
    const finalValues = finalSnapshot.values;
    const checkpointRows = countRows(db, "checkpoints");

    const expectedArtifactHash = artifactHashOf(FIXED_CANDIDATE_TEXT);
    const checks: Check[] = [
      {
        label: "生成与确认分离",
        pass: paused.next.length === 1 && paused.next[0] === "confirmGate",
        detail: `第一次 invoke 停在 ${JSON.stringify(paused.next)}，生成节点已执行 ${JSON.stringify(firstLog)}`,
      },
      {
        label: "候选以 temporary 落盘",
        pass: pausedValues.artifactStatus === "temporary" && pausedValues.stage === "awaiting_confirmation",
        detail: `status=${pausedValues.artifactStatus} stage=${pausedValues.stage}`,
      },
      {
        label: "恢复拿回同一候选",
        pass:
          artifactIdBefore === finalValues.artifactId &&
          artifactHashBefore === finalValues.artifactHash &&
          finalValues.artifactHash === expectedArtifactHash,
        detail: `before=${artifactIdBefore}/${artifactHashBefore} after=${finalValues.artifactId}/${finalValues.artifactHash}`,
      },
      {
        label: "恢复后仍未视为已确认",
        pass:
          finalValues.artifactStatus === "temporary" &&
          finalValues.stage === "awaiting_confirmation" &&
          finalValues.userDecision === "defer",
        detail: `status=${finalValues.artifactStatus} stage=${finalValues.stage} decision=${finalValues.userDecision}`,
      },
      {
        label: "恢复只重跑门禁节点",
        pass: resumeLog.length === 1 && resumeLog[0] === "confirmGate",
        detail: `恢复时执行的节点=${JSON.stringify(resumeLog)}`,
      },
      {
        label: "确认写入一条 trace",
        pass: JSON.stringify(finalValues.trace) ===
          JSON.stringify(["artifact_generated:temporary", "confirmation_recorded:defer"]),
        detail: `trace=${JSON.stringify(finalValues.trace)}`,
      },
      {
        label: "checkpoint 已落盘",
        pass: checkpointRows >= 2,
        detail: `checkpoints 行数=${checkpointRows}`,
      },
    ];

    const result = makeExperimentResult({
      id: "E1",
      title: "生成与确认分离（interrupt + SqliteSaver 重启恢复）",
      expected:
        "第一次 invoke 停在确认门禁；新开 Database 连接与 saver 实例恢复后拿回同一候选，候选仍为 temporary，未被当作已确认",
      actual: `停点=${JSON.stringify(paused.next)}；恢复后 artifactId=${finalValues.artifactId} status=${finalValues.artifactStatus} stage=${finalValues.stage}；恢复执行节点=${JSON.stringify(resumeLog)}；checkpoints=${checkpointRows} 行`,
      conclusion: resultPass(checks)
        ? "LangGraph interrupt 能把生成与确认拆成两次运行；确认状态只由恢复时传入的决定决定，候选不会因为被生成或恢复而自动升级"
        : "生成与确认未真正分离，见失败项",
      checks,
    });

    const evidence: E1Evidence = {
      artifactIdBefore,
      artifactIdAfter: finalValues.artifactId,
      artifactHashBefore,
      artifactHashAfter: finalValues.artifactHash,
      expectedArtifactHash,
      statusAfterResume: finalValues.artifactStatus,
      stageAfterResume: finalValues.stage,
      stageBeforeResume: pausedValues.stage,
      traceAfterResume: finalValues.trace,
      interruptStoppedAt: paused.next,
      generateNodeRunsAfterResume: resumeLog.filter((entry) => entry === "generate").length,
      checkpointRows,
    };

    return { ...result, evidence };
  } finally {
    db.close();
    await workspace.cleanup();
  }
}

function resultPass(checks: readonly Check[]): boolean {
  return checks.every((check) => check.pass);
}
