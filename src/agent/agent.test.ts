import { describe, expect, it } from "vitest";

import { gateById, rollbackStageFor, stageAfterApprove } from "../domain/gates.js";
import type {
  ExportMarkdownInput,
  FileWriter,
  WriteDraftInput,
  WriteOutlineInput,
  WrittenFile,
} from "../domain/files.js";
import type {
  CommitDecisionInput,
  CommitDecisionResult,
  ConfirmationPackage,
  GraphRunner,
  RecordExportInput,
  RunState,
  SaveArtifactInput,
  WorkflowService,
} from "../domain/service.js";
import type {
  ArtifactVersion,
  FinalContent,
  GateId,
  SessionState,
} from "../domain/types.js";
import { hashContent } from "../shared/hash.js";
import { FIXED_DOWNGRADED_CLAIM, FIXED_UNSUPPORTED_CLAIM } from "./fixed-model.js";
import { createGraphRunner } from "./runner.js";

const TOPIC = "把知识库从收藏夹变成工作台";
const WORKSPACE = { root: "/workspace", workspaceId: null };

/** 极简内存服务：只记录调用、递增 id、commit 返回 applied，不实现真正的原子提交。 */
type FakeService = {
  service: WorkflowService;
  saved: SaveArtifactInput[];
  commits: CommitDecisionInput[];
  exports: RecordExportInput[];
  gateRequests: GateId[];
  stageWrites: string[];
  artifacts: ArtifactVersion[];
};

function createFakeService(options: { failGate?: GateId } = {}): FakeService {
  const sessions = new Map<string, SessionState>();
  const saved: SaveArtifactInput[] = [];
  const commits: CommitDecisionInput[] = [];
  const exports: RecordExportInput[] = [];
  const gateRequests: GateId[] = [];
  const stageWrites: string[] = [];
  const artifacts: ArtifactVersion[] = [];
  const versions = new Map<string, number>();
  let seq = 0;

  const nextSeq = (): number => {
    seq += 1;
    return seq;
  };
  const at = (): string => new Date(Date.UTC(2026, 9, 29, 0, 0, nextSeq())).toISOString();

  const getSession = (sessionId: string): SessionState => {
    const session = sessions.get(sessionId);
    if (session === undefined) {
      throw new Error(`会话不存在：${sessionId}`);
    }
    return session;
  };

  const service: WorkflowService = {
    createSession(input) {
      const session: SessionState = {
        id: `session-${nextSeq()}`,
        name: input.title ?? "未命名会话",
        mode: input.mode ?? "normal",
        stage: "idle",
        workspace: { root: input.workspace.root, workspaceId: input.workspace.workspaceId },
        createdAt: at(),
        updatedAt: at(),
        artifacts: [],
        gates: [],
        trace: [],
        revisions: [],
      };
      sessions.set(session.id, session);
      return session;
    },
    getSession,
    hasSession: (sessionId) => sessions.has(sessionId),
    listSessions: () => [...sessions.values()],
    saveTemporaryArtifact(input) {
      saved.push(input);
      const session = getSession(input.sessionId);
      const versionKey = `${input.sessionId}:${input.kind}`;
      const version = (versions.get(versionKey) ?? 0) + 1;
      versions.set(versionKey, version);
      const artifact: ArtifactVersion = {
        id: `artifact-${nextSeq()}`,
        sessionId: input.sessionId,
        kind: input.kind,
        status: "temporary",
        version,
        content: input.content,
        contentHash: hashContent(input.content),
        filePath: input.filePath ?? null,
        fileHash: input.fileHash ?? null,
        parentArtifactId: input.parentArtifactId ?? null,
        createdAt: at(),
        decidedAt: null,
        statusReason: null,
      };
      artifacts.push(artifact);
      session.artifacts.push(artifact);
      return artifact;
    },
    requestGate(sessionId, gateId) {
      gateRequests.push(gateId);
      if (options.failGate === gateId) {
        throw new Error(`固定故障：门禁 ${gateId} 无法生成确认卡`);
      }
      const session = getSession(sessionId);
      const definition = gateById(gateId);
      const artifact = session.artifacts.findLast(
        (item) => item.kind === definition.artifactKind && item.status === "temporary",
      );
      if (artifact === undefined) {
        throw new Error(`门禁 ${gateId} 缺少临时产物`);
      }
      const confirmation: ConfirmationPackage = {
        sessionId,
        gateId,
        gateType: definition.type,
        stage: session.stage,
        artifactId: artifact.id,
        artifactHash: artifact.contentHash,
        confirmationHash: `sha256:confirmation-${artifact.id}`,
        preview: `${definition.label}（${artifact.id}）`,
        recommendation: { label: "固定推荐", reason: "固定结果，仅用于编排验证" },
        risks: [],
        alternatives: [],
      };
      return confirmation;
    },
    commitGateDecision(input) {
      commits.push(input);
      const session = getSession(input.sessionId);
      const approved = input.decision === "approve" || input.decision === "approve_alternative";
      const stage = approved
        ? stageAfterApprove(input.gateId, session.mode)
        : rollbackStageFor(input.gateId);
      session.stage = stage;
      stageWrites.push(stage);
      const artifact = session.artifacts.find((item) => item.id === input.artifactId);
      if (artifact !== undefined) {
        artifact.status = approved ? "draft" : "rejected";
        artifact.decidedAt = at();
      }
      const result: CommitDecisionResult = { status: "applied", stage, session };
      return result;
    },
    recordExport(input) {
      exports.push(input);
      return getSession(input.sessionId);
    },
  };

  return { service, saved, commits, exports, gateRequests, stageWrites, artifacts };
}

type RecordedWrite<Input> = { input: Input; written: WrittenFile };

type FakeWriter = {
  files: FileWriter;
  outlines: RecordedWrite<WriteOutlineInput>[];
  drafts: RecordedWrite<WriteDraftInput>[];
  exports: RecordedWrite<ExportMarkdownInput>[];
};

function createFakeWriter(): FakeWriter {
  const outlines: RecordedWrite<WriteOutlineInput>[] = [];
  const drafts: RecordedWrite<WriteDraftInput>[] = [];
  const exports: RecordedWrite<ExportMarkdownInput>[] = [];
  let seq = 0;

  const write = (
    input: { workspaceRoot: string; markdown: string },
    directory: string,
    extension: string,
  ): WrittenFile => {
    seq += 1;
    const slug = `file-${seq}`;
    return {
      path: `${input.workspaceRoot}/${directory}/${slug}${extension}`,
      slug,
      hash: hashContent(input.markdown),
    };
  };

  return {
    files: {
      writeOutline(input) {
        const written = write(input, "outlines", ".outline.md");
        outlines.push({ input, written });
        return written;
      },
      writeDraft(input) {
        const written = write(input, "articles", ".md");
        drafts.push({ input, written });
        return written;
      },
      exportMarkdown(input) {
        const written = write(input, "exports", ".md");
        exports.push({ input, written });
        return written;
      },
      readHash(path) {
        const recorded = [...outlines, ...drafts, ...exports].find(
          (item) => item.written.path === path,
        );
        return recorded?.written.hash ?? null;
      },
    },
    outlines,
    drafts,
    exports,
  };
}

function requireGate(state: RunState): ConfirmationPackage {
  if (state.gate === null) {
    throw new Error(`状态 ${state.status} 没有门禁`);
  }
  return state.gate;
}

function approve(runner: GraphRunner, state: RunState): Promise<RunState> {
  const gate = requireGate(state);
  return runner.resume({
    decision: "approve",
    artifactId: gate.artifactId,
    artifactHash: gate.artifactHash,
    confirmationHash: gate.confirmationHash,
  });
}

/** 一路批准到流程结束，返回每个暂停点的门禁 id。 */
async function approveUntilFinished(runner: GraphRunner, first: RunState): Promise<{
  gateIds: GateId[];
  finalState: RunState;
}> {
  const gateIds: GateId[] = [];
  let state = first;
  while (state.status === "awaiting_confirmation") {
    gateIds.push(requireGate(state).gateId);
    state = await approve(runner, state);
  }
  return { gateIds, finalState: state };
}

function createRunner(): { fake: FakeService; writer: FakeWriter; runner: GraphRunner } {
  const fake = createFakeService();
  const writer = createFakeWriter();
  const runner = createGraphRunner({ service: fake.service, files: writer.files });
  return { fake, writer, runner };
}

describe("编排图 普通模式", () => {
  it("五道门禁按 materials→thesis→outline→fact_report→final 暂停，全部批准后导出", async () => {
    const { fake, writer, runner } = createRunner();

    const first = await runner.start({ topic: TOPIC, mode: "normal", workspace: WORKSPACE });
    expect(first.status).toBe("awaiting_confirmation");
    expect(requireGate(first).gateId).toBe("materials");

    const { gateIds, finalState } = await approveUntilFinished(runner, first);

    expect(gateIds).toEqual(["materials", "thesis", "outline", "fact_report", "final"]);
    expect(finalState.status).toBe("exported");
    expect(finalState.gate).toBeNull();
    expect(finalState.error).toBeNull();
    expect(finalState.session.stage).toBe("exported");

    expect(fake.saved.map((call) => call.kind)).toEqual([
      "creative_brief",
      "material_batch",
      "thesis",
      "outline",
      "draft",
      "fact_report",
      "final",
    ]);
    expect(fake.stageWrites).toEqual(["thesis", "outline", "drafting", "review", "exported"]);
    expect(fake.commits).toHaveLength(5);
    expect(fake.exports).toHaveLength(1);
  });

  it("大纲、主稿、导出都经注入的 FileWriter，路径进入 output 与产物记录", async () => {
    const { fake, writer, runner } = createRunner();

    const first = await runner.start({ topic: TOPIC, mode: "normal", workspace: WORKSPACE });
    const { finalState } = await approveUntilFinished(runner, first);

    const outlinePath = writer.outlines[0]?.written.path ?? null;
    const draftPath = writer.drafts[0]?.written.path ?? null;
    const exportedPath = writer.exports[0]?.written.path ?? null;
    expect(outlinePath).not.toBeNull();
    expect(draftPath).not.toBeNull();
    expect(exportedPath).not.toBeNull();

    expect(finalState.output).toEqual({ outlinePath, draftPath, exportedPath });
    expect(fake.saved.find((call) => call.kind === "outline")?.filePath).toBe(outlinePath);
    expect(fake.saved.find((call) => call.kind === "draft")?.filePath).toBe(draftPath);
    expect(writer.outlines[0]?.input.markdown).toContain("## ");

    const finalArtifact = fake.artifacts.find((artifact) => artifact.kind === "final");
    const factArtifact = fake.artifacts.find((artifact) => artifact.kind === "fact_report");
    expect(fake.exports[0]?.artifactId).toBe(finalArtifact?.id);
    // 记录的是落盘文件的内容指纹（用于后续外部编辑对账），不是结构化终稿的指纹
    expect(fake.exports[0]?.contentHash).toBe(writer.exports[0]?.written.hash);
    expect((finalArtifact?.content as FinalContent).factReportArtifactId).toBe(factArtifact?.id);

    expect(writer.exports[0]?.input.markdown).not.toContain(FIXED_UNSUPPORTED_CLAIM);
    expect(writer.exports[0]?.input.markdown).toContain(FIXED_DOWNGRADED_CLAIM);
  });

  it("生成节点只产生 temporary 产物，未提交确认前不推进阶段", async () => {
    const { fake, runner } = createRunner();

    const first = await runner.start({ topic: TOPIC, mode: "normal", workspace: WORKSPACE });
    const session = fake.service.getSession(first.session.id);

    expect(session.stage).toBe("idle");
    expect(session.gates).toHaveLength(0);
    expect(fake.commits).toHaveLength(0);
    expect(session.artifacts.map((artifact) => artifact.kind)).toEqual([
      "creative_brief",
      "material_batch",
    ]);
    expect(session.artifacts.map((artifact) => artifact.status)).toEqual([
      "temporary",
      "temporary",
    ]);
  });
});

describe("编排图 fast 模式", () => {
  it("跳过 materials 与 outline 门禁，只保留 thesis 与 final", async () => {
    const { fake, runner } = createRunner();

    const first = await runner.start({ topic: TOPIC, mode: "fast", workspace: WORKSPACE });
    expect(requireGate(first).gateId).toBe("thesis");

    const { gateIds, finalState } = await approveUntilFinished(runner, first);

    expect(gateIds).toEqual(["thesis", "final"]);
    expect(finalState.status).toBe("exported");
    expect(new Set(fake.gateRequests)).toEqual(new Set<GateId>(["thesis", "final"]));
    expect(fake.commits.map((commit) => commit.gateId)).toEqual(["thesis", "final"]);
    // 门禁被跳过，节点仍然执行：素材、大纲产物仍在，供后续阶段使用。
    expect(fake.saved.map((call) => call.kind)).toEqual([
      "creative_brief",
      "material_batch",
      "thesis",
      "outline",
      "draft",
      "fact_report",
      "final",
    ]);
  });
});

describe("编排图 确认校验", () => {
  it("resume 指纹与上次门禁不一致时返回 failed，不提交确认", async () => {
    const { fake, runner } = createRunner();

    const first = await runner.start({ topic: TOPIC, mode: "normal", workspace: WORKSPACE });
    const gate = requireGate(first);

    const expired = await runner.resume({
      decision: "approve",
      artifactId: gate.artifactId,
      artifactHash: "sha256:forged",
      confirmationHash: gate.confirmationHash,
    });
    expect(expired.status).toBe("failed");
    expect(expired.error).toContain("确认已过期");
    expect(fake.commits).toHaveLength(0);

    // 指纹正确的提交仍可继续，说明失败没有破坏暂停点。
    const recovered = await runner.resume({
      decision: "approve",
      artifactId: gate.artifactId,
      artifactHash: gate.artifactHash,
      confirmationHash: gate.confirmationHash,
    });
    expect(recovered.status).toBe("awaiting_confirmation");
    expect(requireGate(recovered).gateId).toBe("thesis");
  });

  it("导出后没有待确认门禁，resume 返回 failed", async () => {
    const { runner } = createRunner();

    const first = await runner.start({ topic: TOPIC, mode: "normal", workspace: WORKSPACE });
    const { finalState } = await approveUntilFinished(runner, first);
    expect(finalState.status).toBe("exported");

    const stale = await runner.resume({
      decision: "approve",
      artifactId: "artifact-stale",
      artifactHash: "sha256:stale",
      confirmationHash: "sha256:stale",
    });
    expect(stale.status).toBe("failed");
    expect(stale.error).toContain("没有等待确认的门禁");
  });
});

describe("编排图 回退", () => {
  it("thesis 门禁 modify 时重跑论点阶段并再次暂停在论点门禁", async () => {
    const { fake, runner } = createRunner();

    const first = await runner.start({ topic: TOPIC, mode: "normal", workspace: WORKSPACE });
    const thesisState = await approve(runner, first);
    expect(requireGate(thesisState).gateId).toBe("thesis");
    const thesisGate = requireGate(thesisState);

    const modified = await runner.resume({
      decision: "modify",
      artifactId: thesisGate.artifactId,
      artifactHash: thesisGate.artifactHash,
      confirmationHash: thesisGate.confirmationHash,
      feedback: "切口太大，收窄到一个动作",
      directives: ["只保留一个核心主张"],
    });

    expect(modified.status).toBe("awaiting_confirmation");
    expect(requireGate(modified).gateId).toBe("thesis");
    expect(fake.saved.filter((call) => call.kind === "thesis")).toHaveLength(2);
    expect(fake.commits.at(-1)?.decision).toBe("modify");
    expect(fake.commits.at(-1)?.feedback).toBe("切口太大，收窄到一个动作");
    expect(fake.commits.at(-1)?.directives).toEqual(["只保留一个核心主张"]);
    expect(fake.service.getSession(modified.session.id).stage).toBe("thesis");

    const next = await approve(runner, modified);
    expect(requireGate(next).gateId).toBe("outline");
  });

  it("final 门禁 reject 时回退到 drafting 重跑主稿", async () => {
    const { fake, runner } = createRunner();

    const first = await runner.start({ topic: TOPIC, mode: "normal", workspace: WORKSPACE });
    let state = first;
    while (requireGate(state).gateId !== "final") {
      state = await approve(runner, state);
    }
    const finalGate = requireGate(state);

    const rejected = await runner.resume({
      decision: "reject",
      artifactId: finalGate.artifactId,
      artifactHash: finalGate.artifactHash,
      confirmationHash: finalGate.confirmationHash,
      feedback: "论据不够，重写后半部分",
    });

    expect(rejected.status).toBe("awaiting_confirmation");
    expect(requireGate(rejected).gateId).toBe("fact_report");
    expect(fake.saved.filter((call) => call.kind === "draft")).toHaveLength(2);
    expect(fake.commits.at(-1)?.decision).toBe("reject");
    expect(fake.service.getSession(rejected.session.id).stage).toBe("drafting");
  });
});

describe("编排图 错误处理", () => {
  it("服务抛错时返回 failed 并保留可读错误", async () => {
    const fake = createFakeService({ failGate: "outline" });
    const writer = createFakeWriter();
    const runner = createGraphRunner({ service: fake.service, files: writer.files });

    const first = await runner.start({ topic: TOPIC, mode: "normal", workspace: WORKSPACE });
    const thesisState = await approve(runner, first);
    const failed = await approve(runner, thesisState);

    expect(failed.status).toBe("failed");
    expect(failed.error).toContain("固定故障");
    expect(failed.error).toContain("outline");
  });
});
