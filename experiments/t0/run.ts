import { runE1 } from "./e1-interrupt-resume.js";
import { runE2 } from "./e2-duplicate-confirm.js";
import { runE3 } from "./e3-transaction.js";
import { runE4 } from "./e4-file-db-boundary.js";
import { runE5 } from "./e5-saver-capability.js";
import {
  makeExperimentResult,
  reportResult,
  reportSummary,
  type ExperimentResult,
} from "./shared.js";

type ExperimentStep = {
  id: string;
  title: string;
  run: () => Promise<ExperimentResult>;
};

const steps: readonly ExperimentStep[] = [
  { id: "E1", title: "生成与确认分离", run: runE1 },
  { id: "E2", title: "重复确认幂等", run: runE2 },
  { id: "E3", title: "事务共同提交", run: runE3 },
  { id: "E4", title: "文件与数据库边界", run: runE4 },
  { id: "E5", title: "保存器能力与 interrupt 写入时机", run: runE5 },
];

function failedResult(step: ExperimentStep, error: unknown): ExperimentResult {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  return makeExperimentResult({
    id: step.id,
    title: step.title,
    expected: "实验按 README 的预期完成",
    actual: `实验抛出异常：${message}`,
    conclusion: "实验未完成，按失败处理",
    checks: [
      {
        label: "实验可执行",
        pass: false,
        detail: stack ?? message,
      },
    ],
  });
}

async function main(): Promise<void> {
  console.log("T0 关键机制实验（固定数据，不调用模型/搜索/网络）");
  const results: ExperimentResult[] = [];

  for (const step of steps) {
    try {
      const result = await step.run();
      results.push(result);
      reportResult(result);
    } catch (error) {
      const result = failedResult(step, error);
      results.push(result);
      reportResult(result);
    }
  }

  if (!reportSummary(results)) {
    process.exitCode = 1;
  }
}

await main();
