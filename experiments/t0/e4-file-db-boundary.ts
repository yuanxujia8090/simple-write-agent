import { access, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join, posix } from "node:path";

import Database from "better-sqlite3";

import {
  FIXED_CANDIDATE_TEXT,
  FIXED_SESSION_ID,
  artifactHashOf,
  createBusinessSchema,
  makeExperimentResult,
  makeTempWorkspace,
  sha256,
  type Check,
  type Db,
  type ExperimentResult,
} from "./shared.js";

export const ARTICLES_DIR = "articles";
const CRASH_MESSAGE = "注入故障：文件已落盘，DB 版本记录前崩溃";

export type DraftCommitInput = {
  sessionId: string;
  sessionStage: string;
  slug: string;
  text: string;
};

export type DraftCommitResult = {
  relativePath: string;
  artifactId: string;
  contentHash: string;
};

type ReconcileStatus = "consistent" | "unregistered_version";

export type ReconcileEntry = {
  relativePath: string;
  contentHash: string;
  status: ReconcileStatus;
  prompt: string;
  allowedActions: readonly ("adopt" | "discard")[];
};

export type ReconcileResult = {
  entries: ReconcileEntry[];
  unregistered: number;
  consistent: number;
};

export type UnregisteredDecision = "adopt" | "discard";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function articlesPath(root: string): string {
  return join(root, ARTICLES_DIR);
}

function relativePathOf(slug: string): string {
  return posix.join(ARTICLES_DIR, `${slug}.md`);
}

/** 主稿先写 .tmp 再 rename，避免半截文件出现在正式路径。 */
async function writeDraftAtomically(root: string, slug: string, text: string): Promise<string> {
  const articlesDir = articlesPath(root);
  await mkdir(articlesDir, { recursive: true });
  const finalPath = join(articlesDir, `${slug}.md`);
  const tmpPath = `${finalPath}.tmp`;
  await writeFile(tmpPath, text, "utf8");
  await rename(tmpPath, finalPath);
  return finalPath;
}

/**
 * 正常提交：先落文件，再在同一事务里写版本记录与文件登记。
 * crashAfterFileWrite=true 时在写库前抛错，模拟「文件已存在、DB 无记录」。
 */
export async function commitDraft(
  db: Db,
  root: string,
  input: DraftCommitInput,
  options: { crashAfterFileWrite?: boolean } = {},
): Promise<DraftCommitResult> {
  const relativePath = relativePathOf(input.slug);
  await writeDraftAtomically(root, input.slug, input.text);

  if (options.crashAfterFileWrite === true) {
    throw new Error(CRASH_MESSAGE);
  }

  const artifactId = `art-${sha256(`${input.sessionId}:${input.slug}`).slice(0, 12)}`;
  const contentHash = artifactHashOf(input.text);
  const transaction = db.transaction(() => {
    db.prepare(
      "INSERT INTO artifact_versions (id, session_id, artifact_hash, status, body) VALUES (?, ?, ?, 'temporary', ?)",
    ).run(artifactId, input.sessionId, contentHash, input.text);
    db.prepare(
      "INSERT INTO artifact_files (path, session_id, artifact_id, content_hash, registered_at) VALUES (?, ?, ?, ?, ?)",
    ).run(relativePath, input.sessionId, artifactId, contentHash, "2026-10-29T00:00:00.000Z");
    db.prepare("INSERT INTO sessions (id, stage, stage_version) VALUES (?, ?, 1)").run(
      input.sessionId,
      input.sessionStage,
    );
  });
  transaction();

  return { relativePath, artifactId, contentHash };
}

/**
 * 对账：扫描工作目录已有 .md 文件，与 DB 登记比对。
 * 未登记文件只报告，不采用、不覆盖，交由人工决定。
 */
export async function reconcileWorkspace(db: Db, root: string): Promise<ReconcileResult> {
  const articlesDir = articlesPath(root);
  const files = (await readdir(articlesDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort();

  const entries: ReconcileEntry[] = [];
  for (const fileName of files) {
    const relativePath = posix.join(ARTICLES_DIR, fileName);
    const content = await readFile(join(articlesDir, fileName), "utf8");
    const contentHash = artifactHashOf(content);
    const registered = db
      .prepare("SELECT content_hash FROM artifact_files WHERE path = ?")
      .get(relativePath) as { content_hash: string } | undefined;

    if (registered === undefined) {
      entries.push({
        relativePath,
        contentHash,
        status: "unregistered_version",
        prompt: `发现未登记版本：${relativePath}（内容指纹 ${contentHash}）不在 DB 版本记录中，可能是上次提交前崩溃；请选择 adopt（登记为临时版本）或 discard（移出正式路径），不会自动采用或覆盖`,
        allowedActions: ["adopt", "discard"],
      });
      continue;
    }

    if (registered.content_hash !== contentHash) {
      throw new Error(
        `文件 ${relativePath} 内容指纹 ${contentHash} 与登记值 ${registered.content_hash} 不一致；本实验不对账外部编辑`,
      );
    }

    entries.push({
      relativePath,
      contentHash,
      status: "consistent",
      prompt: `${relativePath} 与 DB 版本记录一致`,
      allowedActions: [],
    });
  }

  return {
    entries,
    unregistered: entries.filter((entry) => entry.status === "unregistered_version").length,
    consistent: entries.filter((entry) => entry.status === "consistent").length,
  };
}

/** 人工决定：adopt 只登记为临时版本，不改写文件；discard 把文件移出正式路径，不删除。 */
export async function resolveUnregisteredFile(
  db: Db,
  root: string,
  reconcileEntry: ReconcileEntry,
  decision: UnregisteredDecision,
): Promise<{ decision: UnregisteredDecision; targetPath: string }> {
  if (reconcileEntry.status !== "unregistered_version") {
    throw new Error(`该文件无需人工决定：${reconcileEntry.relativePath}`);
  }
  const absolutePath = join(root, reconcileEntry.relativePath);

  if (decision === "discard") {
    const targetPath = `${absolutePath}.discarded`;
    await rename(absolutePath, targetPath);
    return { decision, targetPath };
  }

  const artifactId = `art-adopted-${sha256(reconcileEntry.relativePath).slice(0, 8)}`;
  const content = await readFile(absolutePath, "utf8");
  const transaction = db.transaction(() => {
    db.prepare(
      "INSERT INTO artifact_versions (id, session_id, artifact_hash, status, body) VALUES (?, ?, ?, 'temporary', ?)",
    ).run(artifactId, FIXED_SESSION_ID, reconcileEntry.contentHash, content);
    db.prepare(
      "INSERT INTO artifact_files (path, session_id, artifact_id, content_hash, registered_at) VALUES (?, ?, ?, ?, ?)",
    ).run(
      reconcileEntry.relativePath,
      FIXED_SESSION_ID,
      artifactId,
      reconcileEntry.contentHash,
      "2026-10-29T00:00:00.000Z",
    );
  });
  transaction();
  return { decision, targetPath: absolutePath };
}

export type E4Evidence = {
  unregisteredAfterCrash: number;
  unregisteredAfterRerun: number;
  crashPrompt: string;
  versionsAfterCrash: number;
  fileRowsAfterCrash: number;
  adoptedArtifactStatus: string;
  consistentAfterAdopt: number;
  dbHashMatchesFile: boolean;
  unregisteredAfterDiscard: number;
  discardedOriginalExists: boolean;
  discardedBackupExists: boolean;
  normalConsistent: number;
};

export type E4Result = ExperimentResult & { evidence: E4Evidence };

export async function runE4(): Promise<E4Result> {
  const workspace = await makeTempWorkspace("t0-e4-");
  const db = new Database(workspace.path("business.sqlite"));

  try {
    createBusinessSchema(db);

    // 1) 文件落下后崩溃，DB 无登记。
    await assertRejectsCrash(async () => {
      await commitDraft(
        db,
        workspace.dir,
        {
          sessionId: FIXED_SESSION_ID,
          sessionStage: "awaiting_confirmation",
          slug: "crash-adopt",
          text: FIXED_CANDIDATE_TEXT,
        },
        { crashAfterFileWrite: true },
      );
    });

    const afterCrash = await reconcileWorkspace(db, workspace.dir);
    const crashEntry = afterCrash.entries.find(
      (entry) => entry.relativePath === posix.join(ARTICLES_DIR, "crash-adopt.md"),
    );
    const crashPrompt = crashEntry?.prompt ?? "";
    const versionsAfterCrash = countVersions(db);
    const fileRowsAfterCrash = countFileRows(db);

    // 2) 重跑对账，不应静默采用。
    const afterRerun = await reconcileWorkspace(db, workspace.dir);
    const rerunEntry = afterRerun.entries.find(
      (entry) => entry.relativePath === posix.join(ARTICLES_DIR, "crash-adopt.md"),
    );

    // 3) 人工决定 adopt → 登记为临时版本，对账转为一致。
    await resolveUnregisteredFile(db, workspace.dir, crashEntry ?? fail("缺少未登记文件条目"), "adopt");
    const afterAdopt = await reconcileWorkspace(db, workspace.dir);
    const adoptedVersion = db
      .prepare("SELECT status FROM artifact_versions WHERE id LIKE 'art-adopted-%'")
      .get() as { status: string } | undefined;
    const adoptedRow = db
      .prepare("SELECT content_hash FROM artifact_files WHERE path = ?")
      .get(posix.join(ARTICLES_DIR, "crash-adopt.md")) as { content_hash: string } | undefined;
    const adoptedFileContent = await readFile(workspace.path(ARTICLES_DIR, "crash-adopt.md"), "utf8");

    // 4) 第二个文件崩溃后选择 discard → 移出正式路径，不删除。
    await assertRejectsCrash(async () => {
      await commitDraft(
        db,
        workspace.dir,
        {
          sessionId: "sess-t0-discard",
          sessionStage: "awaiting_confirmation",
          slug: "crash-discard",
          text: `${FIXED_CANDIDATE_TEXT}（丢弃分支）`,
        },
        { crashAfterFileWrite: true },
      );
    });
    const beforeDiscard = await reconcileWorkspace(db, workspace.dir);
    const discardEntry = beforeDiscard.entries.find(
      (entry) => entry.relativePath === posix.join(ARTICLES_DIR, "crash-discard.md"),
    );
    await resolveUnregisteredFile(db, workspace.dir, discardEntry ?? fail("缺少待丢弃条目"), "discard");
    const afterDiscard = await reconcileWorkspace(db, workspace.dir);
    const discardedOriginalExists = await exists(workspace.path(ARTICLES_DIR, "crash-discard.md"));
    const discardedBackupExists = await exists(
      workspace.path(ARTICLES_DIR, "crash-discard.md.discarded"),
    );

    // 5) 正常路径：写文件 + 同事务写 DB，对账一致。
    await commitDraft(db, workspace.dir, {
      sessionId: "sess-t0-normal",
      sessionStage: "awaiting_confirmation",
      slug: "normal",
      text: `${FIXED_CANDIDATE_TEXT}（正常路径）`,
    });
    const afterNormal = await reconcileWorkspace(db, workspace.dir);

    const unregisteredPaths = afterDiscard.entries
      .filter((entry) => entry.status === "unregistered_version")
      .map((entry) => entry.relativePath);

    const checks: Check[] = [
      {
        label: "崩溃后文件被判为未登记版本",
        pass:
          afterCrash.unregistered === 1 &&
          crashEntry?.status === "unregistered_version" &&
          versionsAfterCrash === 0 &&
          fileRowsAfterCrash === 0,
        detail: `unregistered=${afterCrash.unregistered} consistent=${afterCrash.consistent} artifact_versions=${versionsAfterCrash} artifact_files=${fileRowsAfterCrash}`,
      },
      {
        label: "显式提示且不静默采用/覆盖",
        pass:
          crashPrompt.includes("未登记版本") &&
          crashPrompt.includes("crash-adopt.md") &&
          crashPrompt.includes("adopt") &&
          crashPrompt.includes("discard") &&
          JSON.stringify(crashEntry?.allowedActions) === JSON.stringify(["adopt", "discard"]) &&
          JSON.stringify(rerunEntry?.allowedActions) === JSON.stringify(["adopt", "discard"]),
        detail: crashPrompt,
      },
      {
        label: "重跑对账结论不变（幂等）",
        pass: afterRerun.unregistered === 1 && rerunEntry?.status === "unregistered_version",
        detail: `重跑 unregistered=${afterRerun.unregistered}`,
      },
      {
        label: "人工 adopt 后对账一致，且版本仍是 temporary",
        pass:
          afterAdopt.unregistered === 0 &&
          adoptedRow?.content_hash === artifactHashOf(adoptedFileContent) &&
          adoptedVersion?.status === "temporary",
        detail: `unregistered=${afterAdopt.unregistered} dbHash=${String(adoptedRow?.content_hash)} status=${String(adoptedVersion?.status)}`,
      },
      {
        label: "人工 discard 后文件移出正式路径且不删除",
        pass: !discardedOriginalExists && discardedBackupExists && unregisteredPaths.length === 0,
        detail: `原路径存在=${discardedOriginalExists} .discarded 存在=${discardedBackupExists} 剩余未登记=${JSON.stringify(unregisteredPaths)}`,
      },
      {
        label: "正常路径对账一致",
        pass:
          afterNormal.consistent === 2 &&
          afterNormal.unregistered === 0 &&
          afterNormal.entries.some(
            (entry) =>
              entry.relativePath === posix.join(ARTICLES_DIR, "normal.md") &&
              entry.status === "consistent",
          ),
        detail: `consistent=${afterNormal.consistent} unregistered=${afterNormal.unregistered}`,
      },
    ];

    const evidence: E4Evidence = {
      unregisteredAfterCrash: afterCrash.unregistered,
      unregisteredAfterRerun: afterRerun.unregistered,
      crashPrompt,
      versionsAfterCrash,
      fileRowsAfterCrash,
      adoptedArtifactStatus: String(adoptedVersion?.status),
      consistentAfterAdopt: afterAdopt.consistent,
      dbHashMatchesFile: adoptedRow?.content_hash === artifactHashOf(adoptedFileContent),
      unregisteredAfterDiscard: afterDiscard.unregistered,
      discardedOriginalExists,
      discardedBackupExists,
      normalConsistent: afterNormal.consistent,
    };

    const result = makeExperimentResult({
      id: "E4",
      title: "文件写入与 DB 提交之间的恢复对账",
      expected:
        "文件已写、DB 未提交时崩溃后，对账把该文件判为未登记版本并显式提示；重跑不静默采用；人工可选择 adopt/discard；正常路径对账一致",
      actual: `崩溃后 unregistered=${afterCrash.unregistered}；重跑 unregistered=${afterRerun.unregistered}；adopt 后 unregistered=${afterAdopt.unregistered} consistent=${afterAdopt.consistent}；discard 后 原路径存在=${discardedOriginalExists} 备份存在=${discardedBackupExists}；正常路径 consistent=${afterNormal.consistent}`,
      conclusion: resultPass(checks)
        ? "文件写入不受 DB 事务保护，但可以用「正式路径只放完整文件 + 对账报告未登记版本 + 人工决定」兜住：系统不静默采用也不静默覆盖，正常路径仍是一致状态"
        : "文件与 DB 边界未被正确处理，见失败项",
      checks,
    });

    return { ...result, evidence };
  } finally {
    db.close();
    await workspace.cleanup();
  }
}

function countVersions(db: Db): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM artifact_versions").get() as
    | { n: number }
    | undefined;
  return row?.n ?? 0;
}

function countFileRows(db: Db): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM artifact_files").get() as { n: number } | undefined;
  return row?.n ?? 0;
}

async function assertRejectsCrash(action: () => Promise<unknown>): Promise<void> {
  try {
    await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message !== CRASH_MESSAGE) {
      throw error;
    }
    return;
  }
  throw new Error("预期崩溃注入未被触发");
}

function fail(message: string): never {
  throw new Error(message);
}

function resultPass(checks: readonly Check[]): boolean {
  return checks.every((check) => check.pass);
}
