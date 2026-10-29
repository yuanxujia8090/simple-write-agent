import { describe, expect, it } from "vitest";

import type { CommitDecisionInput, ConfirmationPackage } from "../domain/service.js";
import type {
  FactReportContent,
  FinalContent,
  GateDecision,
  MaterialBatchContent,
  OutlineContent,
  ThesisContent,
} from "../domain/types.js";
import { AppError } from "../shared/errors.js";
import { createInMemoryWorkflowService } from "./service.js";

const WORKSPACE = { root: "/tmp/writing-agent-test", workspaceId: "ws-1" };

function createService(): ReturnType<typeof createInMemoryWorkflowService> {
  let tick = 0;
  return createInMemoryWorkflowService({
    createId: (() => {
      let count = 0;
      return () => `id${++count}`;
    })(),
    now: () => new Date(Date.UTC(2026, 9, 29, 0, 0, tick++)).toISOString(),
  });
}

function thesisContent(claims: string[] = ["主张一", "主张二", "主张三"]): ThesisContent {
  return {
    candidates: claims.map((claim, index) => ({
      id: `c${index + 1}`,
      claim,
      reasoning: `理由${index + 1}`,
      relationToBrief: `关系${index + 1}`,
    })),
    recommendedId: "c1",
    rationale: "最贴近读者痛点",
    risks: ["案例可能不足"],
  };
}

function outlineContent(): OutlineContent {
  return {
    title: "跨端同步的坑",
    chapters: [
      { heading: "为什么同步难", goal: "建立问题意识" },
      { heading: "三个坑", goal: "给出经验" },
    ],
  };
}

function materialsContent(): MaterialBatchContent {
  return { items: [{ name: "现场笔记", sourcePath: "/tmp/notes.md", note: "同步失败案例" }] };
}

function factReportContent(): FactReportContent {
  return {
    items: [
      {
        fact: "用户反馈同步冲突",
        source: null,
        kind: "personal_experience",
        verifyStatus: "unverified",
        reasonCode: null,
      },
    ],
    downgrades: [],
  };
}

function finalContent(): FinalContent {
  return { title: "跨端同步的坑", markdown: "终稿正文", factReportArtifactId: "art-report" };
}

function decision(
  pkg: ConfirmationPackage,
  value: GateDecision,
  extra: Partial<CommitDecisionInput> = {},
): CommitDecisionInput {
  return {
    sessionId: pkg.sessionId,
    gateId: pkg.gateId,
    artifactId: pkg.artifactId,
    artifactHash: pkg.artifactHash,
    confirmationHash: pkg.confirmationHash,
    decision: value,
    ...extra,
  };
}

function expectAppError(run: () => unknown): AppError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    const appError = error as AppError;
    expect(appError.code).toBe("VALIDATION");
    return appError;
  }
  throw new Error("预期抛出 AppError，但没有抛错");
}

describe("createSession", () => {
  it("生成默认会话：id 前缀、未命名、normal、intake、记录工作目录", () => {
    const service = createService();
    const session = service.createSession({ workspace: WORKSPACE });
    expect(session.id).toBe("sess-id1");
    expect(session.name).toBe("未命名会话");
    expect(session.mode).toBe("normal");
    expect(session.stage).toBe("intake");
    expect(session.workspace).toEqual(WORKSPACE);
    expect(session.artifacts).toEqual([]);
    expect(session.gates).toEqual([]);
    expect(session.trace).toEqual([]);
    expect(session.revisions).toEqual([]);
    expect(session.createdAt).toBe(session.updatedAt);
  });

  it("使用标题作为会话名并保留快速模式", () => {
    const service = createService();
    const session = service.createSession({
      title: "  跨端同步  ",
      mode: "fast",
      workspace: WORKSPACE,
    });
    expect(session.name).toBe("跨端同步");
    expect(session.mode).toBe("fast");
  });
});

describe("saveTemporaryArtifact", () => {
  it("缺字段的创作简报被拒，并给出可读中文与修复提示", () => {
    const service = createService();
    const session = service.createSession({ workspace: WORKSPACE });
    const error = expectAppError(() =>
      service.saveTemporaryArtifact({
        sessionId: session.id,
        kind: "creative_brief",
        content: { topic: "同步", audience: " ", purpose: "" },
      }),
    );
    expect(error.message).toContain("创作简报缺少目标读者");
    expect(error.message).toContain("创作简报缺少写作目的");
    expect(error.hint).toBe("修正后重新生成该阶段产物");
    expect(service.getSession(session.id).artifacts).toEqual([]);
  });

  it("论点候选不足 3 个被拒", () => {
    const service = createService();
    const session = service.createSession({ workspace: WORKSPACE });
    const error = expectAppError(() =>
      service.saveTemporaryArtifact({
        sessionId: session.id,
        kind: "thesis",
        content: thesisContent(["只有一个", "只有两个"]),
      }),
    );
    expect(error.message).toContain("论点候选必须是 3–5 个");
  });

  it("保存临时产物：版本 1、指纹、等待确认 Trace、会话阶段不变", () => {
    const service = createService();
    const session = service.createSession({ workspace: WORKSPACE });
    const artifact = service.saveTemporaryArtifact({
      sessionId: session.id,
      kind: "thesis",
      content: thesisContent(),
    });
    expect(artifact.status).toBe("temporary");
    expect(artifact.version).toBe(1);
    expect(artifact.decidedAt).toBeNull();
    expect(artifact.statusReason).toBeNull();
    expect(artifact.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    const stored = service.getSession(session.id);
    expect(stored.stage).toBe("intake");
    expect(stored.trace.map((event) => event.type)).toEqual(["artifact_generated"]);
    expect(stored.trace[0]?.detail).toBe("thesis v1 已生成，等待确认");
    expect(stored.trace[0]?.artifactId).toBe(artifact.id);
  });

  it("同种类旧临时版本被替换，draft 与 rejected 版本保留", () => {
    const service = createService();
    const session = service.createSession({ workspace: WORKSPACE });
    const v1 = service.saveTemporaryArtifact({
      sessionId: session.id,
      kind: "thesis",
      content: thesisContent(),
    });
    service.commitGateDecision(decision(service.requestGate(session.id, "thesis"), "approve"));

    const v2 = service.saveTemporaryArtifact({
      sessionId: session.id,
      kind: "thesis",
      content: thesisContent(["新主张一", "新主张二", "新主张三"]),
    });
    const v3 = service.saveTemporaryArtifact({
      sessionId: session.id,
      kind: "thesis",
      content: thesisContent(["再改一", "再改二", "再改三"]),
    });
    service.commitGateDecision(
      decision(service.requestGate(session.id, "thesis"), "modify", {
        feedback: "论证太薄",
        directives: ["补一个真实案例"],
      }),
    );
    const v4 = service.saveTemporaryArtifact({
      sessionId: session.id,
      kind: "thesis",
      content: thesisContent(["四一", "四二", "四三"]),
    });
    const v5 = service.saveTemporaryArtifact({
      sessionId: session.id,
      kind: "thesis",
      content: thesisContent(["五一", "五二", "五三"]),
    });

    const stored = service.getSession(session.id);
    expect(stored.artifacts.map((item) => item.id)).toEqual([v1.id, v3.id, v5.id]);
    expect(stored.artifacts.map((item) => item.status)).toEqual(["draft", "rejected", "temporary"]);
    expect(stored.artifacts.every((item) => item.kind === "thesis")).toBe(true);
    expect(stored.artifacts.find((item) => item.id === v3.id)?.statusReason).toBe("modify_requested");
    expect(stored.artifacts.some((item) => item.id === v2.id)).toBe(false);
    expect(stored.artifacts.some((item) => item.id === v4.id)).toBe(false);
  });

  it("版本号按同种类历史递增，不复用被替换版本的序号", () => {
    const service = createService();
    const session = service.createSession({ workspace: WORKSPACE });
    const first = service.saveTemporaryArtifact({
      sessionId: session.id,
      kind: "thesis",
      content: thesisContent(),
    });
    service.saveTemporaryArtifact({
      sessionId: session.id,
      kind: "outline",
      content: outlineContent(),
    });
    const third = service.saveTemporaryArtifact({
      sessionId: session.id,
      kind: "thesis",
      content: thesisContent(["改一", "改二", "改三"]),
    });
    expect(first.version).toBe(1);
    expect(third.version).toBe(2);
  });
});

describe("requestGate", () => {
  it("没有待确认产物时给出可读错误", () => {
    const service = createService();
    const session = service.createSession({ workspace: WORKSPACE });
    const error = expectAppError(() => service.requestGate(session.id, "thesis"));
    expect(error.message).toBe("没有待确认的论点确认产物");
    expect(error.hint).toBe("先生成该阶段产物再请求确认");
  });

  it("同一产物两次请求得到相同确认指纹，风险与备选来自内容", () => {
    const service = createService();
    const session = service.createSession({ workspace: WORKSPACE });
    const artifact = service.saveTemporaryArtifact({
      sessionId: session.id,
      kind: "thesis",
      content: thesisContent(),
    });
    const first = service.requestGate(session.id, "thesis");
    service.saveTemporaryArtifact({
      sessionId: session.id,
      kind: "outline",
      content: outlineContent(),
    });
    const second = service.requestGate(session.id, "thesis");

    expect(first.artifactId).toBe(artifact.id);
    expect(second.confirmationHash).toBe(first.confirmationHash);
    expect(first.artifactHash).toBe(artifact.contentHash);
    expect(first.stage).toBe("thesis");
    expect(first.preview).toBe("主张一");
    expect(first.recommendation).toEqual({
      label: "推荐论点：主张一",
      reason: "最贴近读者痛点",
    });
    expect(first.risks).toEqual(["案例可能不足"]);
    expect(first.alternatives).toEqual(["主张二", "主张三"]);
  });

  it("内容变化后确认指纹变化", () => {
    const service = createService();
    const session = service.createSession({ workspace: WORKSPACE });
    service.saveTemporaryArtifact({
      sessionId: session.id,
      kind: "thesis",
      content: thesisContent(),
    });
    const before = service.requestGate(session.id, "thesis");
    const replacement = service.saveTemporaryArtifact({
      sessionId: session.id,
      kind: "thesis",
      content: thesisContent(["改后一", "主张二", "主张三"]),
    });
    const after = service.requestGate(session.id, "thesis");
    expect(after.artifactId).toBe(replacement.id);
    expect(after.confirmationHash).not.toBe(before.confirmationHash);
  });

  it("其他产物种类的确认卡预览符合规则", () => {
    const service = createService();
    const session = service.createSession({ workspace: WORKSPACE });
    service.saveTemporaryArtifact({
      sessionId: session.id,
      kind: "material_batch",
      content: materialsContent(),
    });
    service.saveTemporaryArtifact({
      sessionId: session.id,
      kind: "outline",
      content: outlineContent(),
    });
    service.saveTemporaryArtifact({
      sessionId: session.id,
      kind: "fact_report",
      content: factReportContent(),
    });
    service.saveTemporaryArtifact({
      sessionId: session.id,
      kind: "final",
      content: finalContent(),
    });
    expect(service.requestGate(session.id, "materials").preview).toBe("1 条素材");
    expect(service.requestGate(session.id, "materials").recommendation.label).toBe("采纳这批素材");
    expect(service.requestGate(session.id, "outline").preview).toBe("跨端同步的坑");
    expect(service.requestGate(session.id, "outline").recommendation.reason).toBe("共 2 章");
    expect(service.requestGate(session.id, "fact_report").preview).toBe("1 条事实，0 条降级改写");
    const final = service.requestGate(session.id, "final");
    expect(final.preview).toBe("跨端同步的坑");
    expect(final.recommendation).toEqual({
      label: "导出终稿",
      reason: "事实核查与内容诊断已完成",
    });
  });
});

describe("commitGateDecision 批准", () => {
  it("批准后产物转 draft、阶段推进、门禁与 Trace 落库", () => {
    const service = createService();
    const session = service.createSession({ workspace: WORKSPACE });
    const artifact = service.saveTemporaryArtifact({
      sessionId: session.id,
      kind: "thesis",
      content: thesisContent(),
    });
    const pkg = service.requestGate(session.id, "thesis");
    const result = service.commitGateDecision(decision(pkg, "approve"));

    expect(result.status).toBe("applied");
    expect(result.stage).toBe("outline");
    const stored = service.getSession(session.id);
    expect(stored.stage).toBe("outline");
    const approved = stored.artifacts.find((item) => item.id === artifact.id);
    expect(approved?.status).toBe("draft");
    expect(approved?.decidedAt).not.toBeNull();
    expect(approved?.statusReason).toBeNull();
    expect(stored.gates).toHaveLength(1);
    expect(stored.gates[0]).toMatchObject({
      gateId: "thesis",
      gateType: "content",
      artifactId: artifact.id,
      artifactHash: pkg.artifactHash,
      confirmationHash: pkg.confirmationHash,
      decision: "approve",
      revision: null,
    });
    expect(stored.trace.map((event) => event.type)).toEqual([
      "artifact_generated",
      "confirmation_requested",
      "confirmation_recorded",
      "stage_changed",
    ]);
    expect(result.session).toEqual(stored);
  });

  it("新版本批准后旧 draft 标记 superseded，阶段不重复推进", () => {
    const service = createService();
    const session = service.createSession({ workspace: WORKSPACE });
    const first = service.saveTemporaryArtifact({
      sessionId: session.id,
      kind: "thesis",
      content: thesisContent(),
    });
    service.commitGateDecision(decision(service.requestGate(session.id, "thesis"), "approve"));
    const second = service.saveTemporaryArtifact({
      sessionId: session.id,
      kind: "thesis",
      content: thesisContent(["改后一", "改后二", "改后三"]),
    });
    service.commitGateDecision(decision(service.requestGate(session.id, "thesis"), "approve"));

    const stored = service.getSession(session.id);
    const superseded = stored.artifacts.find((item) => item.id === first.id);
    expect(superseded?.status).toBe("rejected");
    expect(superseded?.statusReason).toBe("superseded");
    expect(stored.artifacts.find((item) => item.id === second.id)?.status).toBe("draft");
    expect(stored.stage).toBe("outline");
    expect(stored.gates).toHaveLength(2);
    expect(stored.trace.filter((event) => event.type === "stage_changed")).toHaveLength(1);
    const supersededEvent = stored.trace.find((event) => event.type === "artifact_superseded");
    expect(supersededEvent?.artifactId).toBe(first.id);
  });

  it("快速模式下论点批准直接进入 drafting", () => {
    const service = createService();
    const session = service.createSession({ workspace: WORKSPACE, mode: "fast" });
    service.saveTemporaryArtifact({ sessionId: session.id, kind: "thesis", content: thesisContent() });
    const result = service.commitGateDecision(
      decision(service.requestGate(session.id, "thesis"), "approve"),
    );
    expect(result.stage).toBe("drafting");
  });
});

describe("commitGateDecision 指纹与幂等", () => {
  it("artifactHash 不符时拒绝并提示重新生成确认卡", () => {
    const service = createService();
    const session = service.createSession({ workspace: WORKSPACE });
    service.saveTemporaryArtifact({ sessionId: session.id, kind: "thesis", content: thesisContent() });
    const pkg = service.requestGate(session.id, "thesis");
    const error = expectAppError(() =>
      service.commitGateDecision({ ...decision(pkg, "approve"), artifactHash: "sha256:deadbeef" }),
    );
    expect(error.message).toContain("确认卡已过期");
    expect(error.hint).toBe("请重新生成确认卡后再提交");
    const stored = service.getSession(session.id);
    expect(stored.stage).toBe("intake");
    expect(stored.gates).toEqual([]);
  });

  it("confirmationHash 不符时拒绝且不改状态", () => {
    const service = createService();
    const session = service.createSession({ workspace: WORKSPACE });
    service.saveTemporaryArtifact({ sessionId: session.id, kind: "thesis", content: thesisContent() });
    const pkg = service.requestGate(session.id, "thesis");
    const before = service.getSession(session.id);
    const error = expectAppError(() =>
      service.commitGateDecision({ ...decision(pkg, "approve"), confirmationHash: "sha256:beef" }),
    );
    expect(error.message).toContain("确认卡内容与当前产物不一致");
    expect(service.getSession(session.id)).toEqual(before);
  });

  it("重复提交返回 duplicate_confirmation 且不二次推进", () => {
    const service = createService();
    const session = service.createSession({ workspace: WORKSPACE });
    service.saveTemporaryArtifact({ sessionId: session.id, kind: "thesis", content: thesisContent() });
    const pkg = service.requestGate(session.id, "thesis");
    service.commitGateDecision(decision(pkg, "approve"));
    const before = service.getSession(session.id);

    const repeat = service.commitGateDecision(decision(pkg, "approve"));
    expect(repeat.status).toBe("duplicate_confirmation");
    expect(repeat.stage).toBe("outline");
    expect(repeat.session).toEqual(before);
    const after = service.getSession(session.id);
    expect(after).toEqual(before);
    expect(after.gates).toHaveLength(1);
    expect(after.trace).toHaveLength(before.trace.length);
  });

  it("已决定产物再次提交被拒（产物不是待确认版本）", () => {
    const service = createService();
    const session = service.createSession({ workspace: WORKSPACE });
    service.saveTemporaryArtifact({ sessionId: session.id, kind: "thesis", content: thesisContent() });
    const pkg = service.requestGate(session.id, "thesis");
    service.commitGateDecision(decision(pkg, "approve"));
    const error = expectAppError(() => service.commitGateDecision(decision(pkg, "reject")));
    expect(error.message).toBe("产物不是待确认版本");
  });

  it("产物不存在或类型不匹配时给出可读错误", () => {
    const service = createService();
    const session = service.createSession({ workspace: WORKSPACE });
    const missing = expectAppError(() =>
      service.commitGateDecision({
        sessionId: session.id,
        gateId: "thesis",
        artifactId: "art-missing",
        artifactHash: "sha256:x",
        confirmationHash: "sha256:y",
        decision: "approve",
      }),
    );
    expect(missing.message).toContain("产物不存在");

    service.saveTemporaryArtifact({ sessionId: session.id, kind: "outline", content: outlineContent() });
    const outline = service.getSession(session.id).artifacts[0];
    const mismatch = expectAppError(() =>
      service.commitGateDecision({
        sessionId: session.id,
        gateId: "thesis",
        artifactId: outline?.id ?? "",
        artifactHash: outline?.contentHash ?? "",
        confirmationHash: "sha256:y",
        decision: "approve",
      }),
    );
    expect(mismatch.message).toContain("产物类型与论点确认不匹配");
  });
});

describe("commitGateDecision 修改与拒绝", () => {
  it("要求修改必须提供反馈或修订指令", () => {
    const service = createService();
    const session = service.createSession({ workspace: WORKSPACE });
    service.saveTemporaryArtifact({ sessionId: session.id, kind: "thesis", content: thesisContent() });
    const pkg = service.requestGate(session.id, "thesis");
    const before = service.getSession(session.id);
    const error = expectAppError(() => service.commitGateDecision(decision(pkg, "modify")));
    expect(error.message).toBe("要求修改必须提供反馈或修订指令");
    expect(error.hint).toBe("请说明希望修改什么，或给出修订指令");
    expect(service.getSession(session.id)).toEqual(before);
  });

  it("修改回退到产出阶段并保存修订指令", () => {
    const service = createService();
    const session = service.createSession({ workspace: WORKSPACE });
    const artifact = service.saveTemporaryArtifact({
      sessionId: session.id,
      kind: "thesis",
      content: thesisContent(),
    });
    const pkg = service.requestGate(session.id, "thesis");
    const result = service.commitGateDecision(
      decision(pkg, "modify", { feedback: "论证太薄", directives: ["补一个真实案例"] }),
    );

    expect(result.status).toBe("applied");
    expect(result.stage).toBe("thesis");
    const stored = service.getSession(session.id);
    const rejected = stored.artifacts.find((item) => item.id === artifact.id);
    expect(rejected?.status).toBe("rejected");
    expect(rejected?.statusReason).toBe("modify_requested");
    expect(rejected?.decidedAt).not.toBeNull();
    expect(stored.gates[0]?.decision).toBe("modify");
    expect(stored.gates[0]?.revision).toEqual({
      rawFeedback: "论证太薄",
      directives: ["补一个真实案例"],
    });
    expect(stored.revisions).toHaveLength(1);
    expect(stored.revisions[0]).toMatchObject({
      gateId: "thesis",
      revision: { rawFeedback: "论证太薄", directives: ["补一个真实案例"] },
    });
    expect(stored.trace.map((event) => event.type)).toContain("confirmation_recorded");
    expect(stored.trace.map((event) => event.type)).toContain("stage_changed");
    expect(stored.trace.map((event) => event.type)).not.toContain("artifact_superseded");
  });

  it("拒绝按 PRD 回退：thesis/outline/fact_report→research/final→drafting", () => {
    const cases: {
      gateId: "thesis" | "outline" | "fact_report" | "final";
      kind: "thesis" | "outline" | "fact_report" | "final";
      content: ThesisContent | OutlineContent | FactReportContent | FinalContent;
      stage: string;
    }[] = [
      { gateId: "thesis", kind: "thesis", content: thesisContent(), stage: "thesis" },
      { gateId: "outline", kind: "outline", content: outlineContent(), stage: "outline" },
      { gateId: "fact_report", kind: "fact_report", content: factReportContent(), stage: "research" },
      { gateId: "final", kind: "final", content: finalContent(), stage: "drafting" },
    ];

    for (const item of cases) {
      const service = createService();
      const session = service.createSession({ workspace: WORKSPACE });
      const artifact = service.saveTemporaryArtifact({
        sessionId: session.id,
        kind: item.kind,
        content: item.content,
      });
      const pkg = service.requestGate(session.id, item.gateId);
      const result = service.commitGateDecision(
        decision(pkg, "reject", { feedback: "方向不对", directives: ["换角度"] }),
      );

      expect(result.stage, item.gateId).toBe(item.stage);
      const stored = service.getSession(session.id);
      expect(stored.stage, item.gateId).toBe(item.stage);
      const rejected = stored.artifacts.find((entry) => entry.id === artifact.id);
      expect(rejected?.status, item.gateId).toBe("rejected");
      expect(rejected?.statusReason, item.gateId).toBe("rejected");
      expect(stored.gates[0]?.decision, item.gateId).toBe("reject");
      expect(stored.revisions[0]?.revision.rawFeedback, item.gateId).toBe("方向不对");
    }
  });
});

describe("commitGateDecision 原子性", () => {
  it("四个故障注入点都保持调用前会话原样", () => {
    const points = ["artifact", "gate", "stage", "trace"] as const;
    for (const point of points) {
      const service = createService();
      const session = service.createSession({ workspace: WORKSPACE });
      service.saveTemporaryArtifact({
        sessionId: session.id,
        kind: "thesis",
        content: thesisContent(),
      });
      const pkg = service.requestGate(session.id, "thesis");
      const before = service.getSession(session.id);

      expect(() =>
        service.commitGateDecision(decision(pkg, "approve", { failAfter: point })),
      ).toThrow(`failAfter=${point}`);
      expect(service.getSession(session.id), point).toEqual(before);
    }
  });
});

describe("recordExport", () => {
  it("记录导出路径与指纹并更新 updatedAt", () => {
    const service = createService();
    const session = service.createSession({ workspace: WORKSPACE });
    const artifact = service.saveTemporaryArtifact({
      sessionId: session.id,
      kind: "final",
      content: finalContent(),
    });
    const before = service.getSession(session.id);
    const after = service.recordExport({
      sessionId: session.id,
      artifactId: artifact.id,
      filePath: "articles/kuaduan-tongbu.md",
      contentHash: artifact.contentHash,
    });

    expect(after.updatedAt).not.toBe(before.updatedAt);
    expect(after.stage).toBe(before.stage);
    const event = after.trace.at(-1);
    expect(event?.type).toBe("export_written");
    expect(event?.detail).toContain("articles/kuaduan-tongbu.md");
    expect(event?.detail).toContain(artifact.contentHash);
    expect(event?.artifactId).toBe(artifact.id);
  });

  it("导出不存在的产物时被拒", () => {
    const service = createService();
    const session = service.createSession({ workspace: WORKSPACE });
    const error = expectAppError(() =>
      service.recordExport({
        sessionId: session.id,
        artifactId: "art-missing",
        filePath: "articles/x.md",
        contentHash: "sha256:x",
      }),
    );
    expect(error.message).toContain("产物不存在");
    expect(service.getSession(session.id).trace).toEqual([]);
  });
});

describe("getSession", () => {
  it("返回深拷贝，调用方修改不影响内部状态", () => {
    const service = createService();
    const session = service.createSession({ workspace: WORKSPACE });
    service.saveTemporaryArtifact({ sessionId: session.id, kind: "thesis", content: thesisContent() });

    const snapshot = service.getSession(session.id);
    snapshot.stage = "exported";
    snapshot.artifacts[0]!.status = "draft";
    snapshot.workspace.root = "/tmp/other";
    snapshot.trace.push({ seq: 99, at: "now", type: "error", detail: "外部改动" });

    const fresh = service.getSession(session.id);
    expect(fresh.stage).toBe("intake");
    expect(fresh.workspace.root).toBe(WORKSPACE.root);
    expect(fresh.artifacts[0]?.status).toBe("temporary");
    expect(fresh.trace).toHaveLength(1);
  });

  it("会话不存在时给出可读错误", () => {
    const service = createService();
    const error = expectAppError(() => service.getSession("sess-missing"));
    expect(error.message).toBe("会话不存在：sess-missing");
  });
});
