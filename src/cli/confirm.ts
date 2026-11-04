/**
 * 终端确认卡：单点人工确认，不做整套 TUI。
 * - `formatCard`：把确认包渲染成几行可读文本。
 * - `parseAnswer`：把一行输入翻成门禁决策；无法识别时返回 null，由调用方重问。
 * - `createTerminalConfirm`：接到 readline 上，逐道门禁问一次。
 */
import { createInterface } from "node:readline/promises";

import type { ConfirmationPackage, DecisionInput } from "../domain/service.js";
import { AppError } from "../shared/errors.js";

const STAGE_LABELS: Record<ConfirmationPackage["gateId"], string> = {
  materials: "素材采纳",
  thesis: "论点",
  outline: "大纲",
  fact_report: "事实核查",
  final: "终稿",
};

export function formatCard(gate: ConfirmationPackage, index: number): string {
  const lines = [
    "",
    `── 确认卡 ${index}：${STAGE_LABELS[gate.gateId]}（阶段 ${gate.stage}）──`,
    `推荐：${gate.recommendation.label}`,
  ];
  if (gate.recommendation.reason.trim() !== "") {
    lines.push(`依据：${gate.recommendation.reason}`);
  }
  if (gate.risks.length > 0) {
    lines.push(`风险：${gate.risks.join("；")}`);
  }
  if (gate.alternatives.length > 0) {
    lines.push(`备选：${gate.alternatives.join("；")}`);
  }
  if (gate.preview.trim() !== "") {
    lines.push("预览：");
    for (const line of gate.preview.trim().split("\n")) {
      lines.push(`  ${line}`);
    }
  }
  lines.push("选择：[Y] 批准推荐 / [m 反馈] 修改 / [n 反馈] 拒绝（Ctrl+C 退出）");
  return lines.join("\n");
}

/** 把一行输入翻成决策。`null` 表示没看懂，调用方应重问而不是默认批准。 */
export function parseAnswer(answer: string, gate: ConfirmationPackage): DecisionInput | null {
  const trimmed = answer.trim();
  const base = {
    artifactId: gate.artifactId,
    artifactHash: gate.artifactHash,
    confirmationHash: gate.confirmationHash,
  };

  if (trimmed === "" || /^(y|yes|是|好|批准|同意)$/i.test(trimmed)) {
    return { ...base, decision: "approve" };
  }

  const modify = /^(?:m|modify|修改|改)(?:\s+([\s\S]+))?$/i.exec(trimmed);
  if (modify) {
    const feedback = modify[1]?.trim() ?? "";
    if (feedback === "") {
      return null;
    }
    return { ...base, decision: "modify", feedback, directives: [feedback] };
  }

  const reject = /^(?:n|no|reject|拒绝|不行)(?:\s+([\s\S]+))?$/i.exec(trimmed);
  if (reject) {
    const feedback = reject[1]?.trim() ?? "";
    if (feedback === "") {
      return null;
    }
    return { ...base, decision: "reject", feedback, directives: [feedback] };
  }

  return null;
}

export type TerminalConfirmOptions = {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
};

/**
 * 建一个只问门禁的交互器。每道门禁独立开一次 readline，
 * 避免长连接占住 stdin 让进程退出不了。
 */
export function createTerminalConfirm(
  options: TerminalConfirmOptions = {},
): (gate: ConfirmationPackage, index: number) => Promise<DecisionInput> {
  return async (gate, index) => {
    const output = options.output ?? process.stdout;
    const rl = createInterface({
      input: options.input ?? process.stdin,
      output,
    });
    try {
      // 不能默认批准：没看懂就重问，防止误按回车推进流程。
      for (;;) {
        const answer = await rl.question(`\n${formatCard(gate, index)}\n> `);
        const decision = parseAnswer(answer, gate);
        if (decision !== null) {
          return decision;
        }
        output.write(
          "没看懂这个选择：批准直接回车或输入 y；修改用 `m 你的意见`；拒绝用 `n 你的理由`。\n",
        );
      }
    } catch (error) {
      throw new AppError(
        "RUNTIME",
        `门禁确认被中断：${error instanceof Error ? error.message : String(error)}`,
        "会话已停在当前阶段；重新运行时可用 --yes 走自动批准",
      );
    } finally {
      rl.close();
    }
  };
}
