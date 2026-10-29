import { statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { AppError } from "../shared/errors.js";
import {
  MARKER_DIR,
  MARKER_FILE,
  readMarker,
  type WorkspaceIdentity,
} from "./marker.js";

export type WorkspaceSource = "flag" | "marker" | "cwd";

export type Workspace = {
  root: string;
  source: WorkspaceSource;
  identity: WorkspaceIdentity | null;
  markerPath: string | null;
};

/**
 * 解析工作目录，优先级：显式 --cwd → 向上找到的最近标记 → 当前目录。
 * explicitCwd 显式给出时不再向上查找；空字符串按"未指定"处理（与配置层空值语义一致）。
 */
export function resolveWorkspace(options: {
  cwd: string;
  explicitCwd?: string;
}): Workspace {
  const base = resolve(options.cwd);
  const explicitCwd = options.explicitCwd;

  if (explicitCwd !== undefined && explicitCwd !== "") {
    const root = resolve(base, explicitCwd);
    assertDirectory(root);
    const identity = readMarker(root);
    return {
      root,
      source: "flag",
      identity,
      markerPath: identity === null ? null : markerPathIn(root),
    };
  }

  const claimed = findMarkerRoot(base);
  if (claimed !== null) {
    return {
      root: claimed.root,
      source: "marker",
      identity: claimed.identity,
      markerPath: markerPathIn(claimed.root),
    };
  }

  return { root: base, source: "cwd", identity: null, markerPath: null };
}

/** 从 start 目录逐层向上读取标记；只认标记文件是否存在，不做跨文件系统特殊处理。 */
function findMarkerRoot(start: string): { root: string; identity: WorkspaceIdentity } | null {
  let current = start;
  for (;;) {
    const identity = readMarker(current);
    if (identity !== null) {
      return { root: current, identity };
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function assertDirectory(path: string): void {
  let isDirectory: boolean;
  try {
    isDirectory = statSync(path).isDirectory();
  } catch {
    throw new AppError(
      "WORKSPACE",
      `工作目录不存在：${path}`,
      "检查 --cwd 路径是否正确；也可以省略 --cwd，使用当前目录",
    );
  }
  if (!isDirectory) {
    throw new AppError(
      "WORKSPACE",
      `工作目录不是目录：${path}`,
      "--cwd 需要指向一个目录，不能是文件",
    );
  }
}

function markerPathIn(root: string): string {
  return join(root, MARKER_DIR, MARKER_FILE);
}
