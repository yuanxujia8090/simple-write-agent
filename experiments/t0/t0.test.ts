import { describe, expect, it } from "vitest";

import { runE1 } from "./e1-interrupt-resume.js";
import { runE2 } from "./e2-duplicate-confirm.js";
import { runE3 } from "./e3-transaction.js";
import { runE4 } from "./e4-file-db-boundary.js";
import { runE5 } from "./e5-saver-capability.js";
import type { ExperimentResult } from "./shared.js";

const TIMEOUT_MS = 20_000;

function checkFailure(result: ExperimentResult): string {
  return result.checks
    .filter((check) => !check.pass)
    .map((check) => `${check.label}：${check.detail}`)
    .join("\n");
}

describe("T0 关键机制实验", () => {
  it("E1 中断后恢复拿回同一候选，且仍为 temporary", async () => {
    const result = await runE1();
    expect(result.pass, checkFailure(result)).toBe(true);
    expect(result.evidence.artifactHashAfter).toBe(result.evidence.expectedArtifactHash);
    expect(result.evidence.artifactIdAfter).toBe(result.evidence.artifactIdBefore);
    expect(result.evidence.statusAfterResume).toBe("temporary");
    expect(result.evidence.stageAfterResume).toBe("awaiting_confirmation");
    expect(result.evidence.generateNodeRunsAfterResume).toBe(0);
    expect(result.evidence.checkpointRows).toBeGreaterThanOrEqual(2);
  }, TIMEOUT_MS);

  it("E2 同一确认提交两次只推进一次阶段", async () => {
    const result = await runE2();
    expect(result.pass, checkFailure(result)).toBe(true);
    expect(result.evidence.firstOutcome.applied).toBe(true);
    expect(result.evidence.secondOutcome.applied).toBe(false);
    expect(result.evidence.secondOutcome.reason).toBe("duplicate_confirmation");
    expect(result.evidence.stageVersion).toBe(1);
    expect(result.evidence.confirmationEvents).toBe(1);
    expect(result.evidence.confirmationRows).toBe(1);
  }, TIMEOUT_MS);

  it("E3 事务内调用 saver.put() 不会与业务写入共同回滚，预序列化写法可以", async () => {
    const result = await runE3();
    expect(result.pass, checkFailure(result)).toBe(true);
    expect(result.evidence.saverSharesExternalConnection).toBe(true);
    expect(result.evidence.putInsideTransactionSuccess).toMatchObject({
      businessRows: 4,
      checkpointRows: 1,
    });
    expect(result.evidence.putInsideTransactionCrash).toMatchObject({
      businessRows: 0,
      checkpointRows: 1,
    });
    expect(result.evidence.preparedInsideTransactionSuccess).toMatchObject({
      businessRows: 4,
      checkpointRows: 1,
    });
    expect(result.evidence.preparedInsideTransactionCrash).toMatchObject({
      businessRows: 0,
      checkpointRows: 0,
    });
  }, TIMEOUT_MS);

  it("E4 崩溃后未登记文件被显式报告，人工 adopt/discard 后才收敛", async () => {
    const result = await runE4();
    expect(result.pass, checkFailure(result)).toBe(true);
    expect(result.evidence.unregisteredAfterCrash).toBe(1);
    expect(result.evidence.versionsAfterCrash).toBe(0);
    expect(result.evidence.fileRowsAfterCrash).toBe(0);
    expect(result.evidence.unregisteredAfterRerun).toBe(1);
    expect(result.evidence.crashPrompt).toContain("未登记版本");
    expect(result.evidence.adoptedArtifactStatus).toBe("temporary");
    expect(result.evidence.dbHashMatchesFile).toBe(true);
    expect(result.evidence.unregisteredAfterDiscard).toBe(0);
    expect(result.evidence.discardedOriginalExists).toBe(false);
    expect(result.evidence.discardedBackupExists).toBe(true);
    expect(result.evidence.normalConsistent).toBe(2);
  }, TIMEOUT_MS);

  it("E5 SqliteSaver 接受外部连接，但写入口是异步的", async () => {
    const result = await runE5();
    expect(result.pass, checkFailure(result)).toBe(true);
    expect(result.evidence.constructorSignature).toContain("db: Database");
    expect(result.evidence.acceptsExternalDatabase).toBe(true);
    expect(result.evidence.putIsAsync).toBe(true);
    expect(result.evidence.putWritesIsAsync).toBe(true);
    expect(result.evidence.nodeExecutionLog).toEqual(["generate", "confirmGate", "confirmGate"]);
  }, TIMEOUT_MS);
});
