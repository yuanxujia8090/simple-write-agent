/** 首条写作闭环重放：固定模型结果 + 脚本化确认决策，验证阶段、门禁与文件衔接。 */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createGraphRunner } from "../agent/runner.js";
import { loadTheme } from "../config/theme.js";
import { createFileWriter } from "../artifacts/files.js";
import { GATE_DEFINITIONS } from "../domain/gates.js";
import type {
  ConfirmationPackage,
  DecisionInput,
  GraphRunner,
  RunOutput,
  RunState,
} from "../domain/service.js";
import type { SessionMode } from "../domain/types.js";
import { createPersistentRuntime } from "../runtime.js";
import { createInMemoryWorkflowService } from "../workflow/service.js";

export type ReplayScenario = "basic" | "revise" | "reject";

export type GateLog = {
  gateId: string;
  label: string;
  decision: string;
  preview: string;
  artifactHash: string;
  confirmationHash: string;
};

export type ReplayOptions = {
  workspaceRoot: string;
  scenario?: ReplayScenario;
  /** 传入时改用 SQLite 持久化；测试一律用临时目录。 */
  dbPath?: string;
  mode?: SessionMode;
  /** 主题文件路径；不传用内置默认主题。 */
  themePath?: string;
  /** 测试用：注入固定时间，避免快照和排序抖动。 */
  now?: () => string;
};

export type ReplayResult = {
  scenario: ReplayScenario;
  mode: SessionMode;
  /** 有持久化库时给出库文件路径，便于二次打开核对。 */
  dbPath: string | null;
  /** 主题来源与提示（非法配置会回退并给警告）。 */
  themeName: string;
  themeWarnings: string[];
  sessionId: string;
  status: RunState["status"];
  stage: string;
  gates: GateLog[];
  output: RunOutput;
  traceCount: number;
  revisions: number;
  /** 便于断言版本生命周期：产物种类 + 状态 + 版本号。 */
  artifacts: { kind: string; status: string; version: number }[];
  error: string | null;
};

const TOPIC = "把知识库从收藏夹变成工作台";
const MATERIALS = ["notes/knowledge-base.md", "notes/weekly-review.md"];

/** 场景化决策：revise 只在论点门禁修改一次；reject 只在终稿门禁拒绝一次。 */
function decide(
  gate: ConfirmationPackage,
  scenario: ReplayScenario,
  seen: { modified: Set<string>; rejected: Set<string> },
): DecisionInput {
  const base = {
    artifactId: gate.artifactId,
    artifactHash: gate.artifactHash,
    confirmationHash: gate.confirmationHash,
  };

  if (scenario === "revise" && gate.gateId === "thesis" && !seen.modified.has(gate.gateId)) {
    seen.modified.add(gate.gateId);
    return {
      ...base,
      decision: "modify",
      feedback: "想去掉工具对比，更想讲个人工作流怎么变。",
      directives: ["减少工具横向对比", "增加一个具体的周末整理场景"],
    };
  }

  if (scenario === "reject" && gate.gateId === "final" && !seen.rejected.has(gate.gateId)) {
    seen.rejected.add(gate.gateId);
    return {
      ...base,
      decision: "reject",
      feedback: "结尾太像总结陈词，希望换成下一步行动清单。",
      directives: ["结尾输出三条可执行动作"],
    };
  }

  return { ...base, decision: "approve" };
}

function logGate(gate: ConfirmationPackage, decision: string): GateLog {
  return {
    gateId: gate.gateId,
    label: GATE_DEFINITIONS[gate.gateId].label,
    decision,
    preview: gate.preview,
    artifactHash: gate.artifactHash,
    confirmationHash: gate.confirmationHash,
  };
}

export async function runReplay(options: ReplayOptions): Promise<ReplayResult> {
  const scenario = options.scenario ?? "basic";
  const workspaceRoot = options.workspaceRoot;
  mkdirSync(workspaceRoot, { recursive: true });

  const mode = options.mode ?? "normal";
  const now = options.now;
  const loadedTheme = loadTheme(
    options.themePath === undefined ? {} : { path: options.themePath },
  );
  const inMemory = () => {
    const service = createInMemoryWorkflowService(now ? { now } : {});
    return {
      runner: createGraphRunner({
        service,
        files: createFileWriter(),
        theme: loadedTheme.theme,
      }) as GraphRunner,
      close: () => undefined,
    };
  };
  const runtime =
    options.dbPath === undefined
      ? inMemory()
      : createPersistentRuntime({
          dbPath: options.dbPath,
          theme: loadedTheme.theme,
          ...(now === undefined ? {} : { now }),
        });
  const runner = runtime.runner;

  const gates: GateLog[] = [];
  const seen = { modified: new Set<string>(), rejected: new Set<string>() };

  let state = await runner.start({
    topic: TOPIC,
    materials: MATERIALS,
    mode,
    workspace: { root: workspaceRoot, workspaceId: "ws-replay" },
  });

  let guard = 0;
  while (state.status === "awaiting_confirmation" && state.gate !== null) {
    guard += 1;
    if (guard > 12) {
      throw new Error("重放超过 12 个门禁仍未结束，可能存在回退死循环");
    }
    const decision = decide(state.gate, scenario, seen);
    gates.push(logGate(state.gate, decision.decision));
    state = await runner.resume(decision);
  }

  const session = state.session;
  try {
    return {
      scenario,
      mode,
      dbPath: options.dbPath ?? null,
      themeName: loadedTheme.theme.name,
      themeWarnings: loadedTheme.warnings,
      sessionId: session.id,
    status: state.status,
    stage: session.stage,
    gates,
    output: state.output ?? {
      outlinePath: null,
      draftPath: null,
      exportedPath: null,
      htmlPath: null,
      htmlError: null,
    },
    traceCount: session.trace.length,
    revisions: session.revisions.length,
    artifacts: session.artifacts.map((artifact) => ({
      kind: artifact.kind,
      status: artifact.status,
      version: artifact.version,
    })),
      error: state.error,
    };
  } finally {
    runtime.close();
  }
}

export function defaultWorkspace(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return join(tmpdir(), `writing-agent-replay-${stamp}`);
}

export function formatResult(result: ReplayResult): string {
  const lines = [
    `写作闭环重放（场景：${result.scenario}，模式：${result.mode}${result.dbPath === null ? "" : "，SQLite 持久化"}）`,
    "",
    ...result.gates.map((gate, index) => {
      const decisionLabel: Record<string, string> = {
        approve: "批准",
        approve_alternative: "批准备选",
        modify: "要求修改",
        reject: "拒绝",
      };
      return `${index + 1}. ${gate.label} → ${decisionLabel[gate.decision] ?? gate.decision}｜${gate.preview}`;
    }),
    "",
    `结果：${result.status}（阶段 ${result.stage}）`,
    `大纲：${result.output.outlinePath ?? "（未生成）"}`,
    `主稿：${result.output.draftPath ?? "（未生成）"}`,
    `导出：${result.output.exportedPath ?? "（未生成）"}`,
    `HTML：${result.output.htmlPath ?? "（未生成）"}${result.output.htmlError === null ? "" : `（失败：${result.output.htmlError}）`}`,
    `主题：${result.themeName}${result.themeWarnings.length === 0 ? "" : `（提示：${result.themeWarnings.join("；")}）`}`,
    `Trace 事件：${result.traceCount} 条；修订指令：${result.revisions} 条`,
  ];
  if (result.error) {
    lines.push(`错误：${result.error}`);
  }
  return lines.join("\n");
}

