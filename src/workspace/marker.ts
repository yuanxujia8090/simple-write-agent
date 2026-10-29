import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { AppError } from "../shared/errors.js";

/** 工作目录身份：目录搬移后靠 workspaceId 关联原会话，不承载会话状态。 */
export type WorkspaceIdentity = {
  workspaceId: string;
  version: number;
  createdAt: string;
};

export const MARKER_DIR = ".writing-agent";
export const MARKER_FILE = "workspace.json";

const MARKER_VERSION = 1;
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/** 生成新的工作目录身份；version 固定为 1，createdAt 用 ISO 字符串。 */
export function createWorkspaceIdentity(
  options: { id?: string; now?: Date } = {},
): WorkspaceIdentity {
  return {
    workspaceId: options.id ?? randomUUID(),
    version: MARKER_VERSION,
    createdAt: (options.now ?? new Date()).toISOString(),
  };
}

/**
 * 读取工作目录标记。没有标记文件返回 null。
 * 标记损坏（非 JSON、缺字段、version 不是 1）抛 AppError，由调用方决定如何处理，不静默当作"无标记"。
 */
export function readMarker(workspaceRoot: string): WorkspaceIdentity | null {
  const markerPath = markerPathIn(workspaceRoot);
  let raw: string;
  try {
    raw = readFileSync(markerPath, "utf8");
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw new AppError(
      "WORKSPACE",
      `无法读取工作目录标记：${markerPath}（${describeError(error)}）`,
      "检查该文件是否存在读取权限后重试",
    );
  }
  return parseMarker(raw, markerPath);
}

/**
 * 写入工作目录标记：目录 0o700、文件 0o600，先写临时文件再 rename，返回绝对 marker 路径。
 * 已有标记损坏时拒绝写入，避免静默覆盖用户数据。
 */
export function writeMarker(workspaceRoot: string, identity: WorkspaceIdentity): string {
  const markerPath = markerPathIn(workspaceRoot);
  readMarker(workspaceRoot);

  const markerDir = join(resolve(workspaceRoot), MARKER_DIR);
  const tempPath = join(markerDir, `${MARKER_FILE}.${randomUUID()}.tmp`);
  try {
    mkdirSync(markerDir, { recursive: true, mode: DIR_MODE });
    chmodSync(markerDir, DIR_MODE);
    writeFileSync(tempPath, `${JSON.stringify(identity, null, 2)}\n`, { mode: FILE_MODE });
    chmodSync(tempPath, FILE_MODE);
    renameSync(tempPath, markerPath);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw new AppError(
      "WORKSPACE",
      `无法写入工作目录标记：${markerPath}（${describeError(error)}）`,
      "检查工作目录是否可写后重试",
    );
  }
  return markerPath;
}

function markerPathIn(workspaceRoot: string): string {
  return join(resolve(workspaceRoot), MARKER_DIR, MARKER_FILE);
}

function parseMarker(raw: string, markerPath: string): WorkspaceIdentity {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw corruptMarker(markerPath, `内容不是合法 JSON（${describeError(error)}）`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw corruptMarker(markerPath, "内容不是 JSON 对象");
  }

  const record = parsed as Record<string, unknown>;
  if (typeof record.workspaceId !== "string" || record.workspaceId.trim() === "") {
    throw corruptMarker(markerPath, "字段 workspaceId 缺失或不是非空字符串");
  }
  if (record.version !== MARKER_VERSION) {
    throw corruptMarker(
      markerPath,
      `字段 version 应为 ${MARKER_VERSION}，实际为 ${JSON.stringify(record.version)}`,
    );
  }
  if (
    typeof record.createdAt !== "string" ||
    Number.isNaN(Date.parse(record.createdAt))
  ) {
    throw corruptMarker(markerPath, "字段 createdAt 缺失或不是 ISO 时间字符串");
  }

  return {
    workspaceId: record.workspaceId,
    version: MARKER_VERSION,
    createdAt: record.createdAt,
  };
}

function corruptMarker(markerPath: string, reason: string): AppError {
  return new AppError(
    "WORKSPACE",
    `工作目录标记损坏：${markerPath}（${reason}）`,
    "修正或删除该标记文件后重试；损坏的标记不会被自动覆盖",
  );
}

function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
