import { readFileSync, statSync } from "node:fs";
import { basename, isAbsolute, join, normalize, resolve, sep } from "node:path";

import { AppError } from "../shared/errors.js";
import type { StyleProfile } from "./types.js";

export type StyleResolveContext = {
  homeDir: string;
  /** 相对路径风格包相对此目录解析；默认由调用方传 cwd */
  cwd: string;
};

const ENTRY_FILES = ["profile.md", "SKILL.md"] as const;

function isPathLike(ref: string): boolean {
  if (isAbsolute(ref)) {
    return true;
  }
  if (ref.startsWith(".") || ref.includes("/") || ref.includes("\\")) {
    return true;
  }
  return false;
}

function assertSafeStyleId(id: string): void {
  if (id.trim() === "") {
    throw new AppError("USAGE", "风格 id 不能为空", "使用 --style <id> 或 --style <目录路径>");
  }
  if (id.includes("..") || id.includes("/") || id.includes("\\") || id.includes(sep)) {
    throw new AppError(
      "USAGE",
      `风格 id 不能包含路径分隔或 ..：${id}`,
      "若要指定目录，请直接传路径，例如 --style ~/.writing-agent/styles/demo 或 --style ./my-style",
    );
  }
}

/** 把 id 或路径解析成风格包根目录（不读文件）。 */
export function resolveStyleRoot(ref: string, ctx: StyleResolveContext): { id: string; rootDir: string } {
  const trimmed = ref.trim();
  if (trimmed === "") {
    throw new AppError("USAGE", "风格引用不能为空", "使用 --style <id|path> 或设置 WRITING_AGENT_STYLE");
  }

  if (isPathLike(trimmed)) {
    const rootDir = normalize(isAbsolute(trimmed) ? trimmed : resolve(ctx.cwd, trimmed));
    return { id: basename(rootDir) || "style", rootDir };
  }

  assertSafeStyleId(trimmed);
  const rootDir = join(ctx.homeDir, ".writing-agent", "styles", trimmed);
  return { id: trimmed, rootDir };
}

function readEntry(rootDir: string): { entryPath: string; bodyText: string } {
  let rootStat;
  try {
    rootStat = statSync(rootDir);
  } catch {
    throw new AppError(
      "USAGE",
      `找不到风格包目录：${rootDir}`,
      "把包装到 ~/.writing-agent/styles/<id>/，并确保内有 profile.md 或 SKILL.md；也可用 --style <目录路径>",
    );
  }
  if (!rootStat.isDirectory()) {
    throw new AppError(
      "USAGE",
      `风格包路径不是目录：${rootDir}`,
      "请指向含 profile.md 或 SKILL.md 的目录",
    );
  }

  for (const name of ENTRY_FILES) {
    const entryPath = join(rootDir, name);
    try {
      const st = statSync(entryPath);
      if (!st.isFile()) {
        continue;
      }
      const bodyText = readFileSync(entryPath, "utf8");
      return { entryPath, bodyText };
    } catch {
      // 试下一个入口名
    }
  }

  throw new AppError(
    "USAGE",
    `风格包缺少入口文件：${rootDir}（需要 profile.md 或 SKILL.md）`,
    "可复制 styles/_example/ 到 ~/.writing-agent/styles/<id>/ 后编辑 profile.md",
  );
}

/** 解析并读入风格包；失败抛出可读 AppError，不静默回退。 */
export function resolveStyleRef(ref: string, ctx: StyleResolveContext): StyleProfile {
  const { id, rootDir } = resolveStyleRoot(ref, ctx);
  try {
    const { entryPath, bodyText } = readEntry(rootDir);
    return { id, rootDir, entryPath, bodyText };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new AppError("USAGE", `读取风格包失败：${rootDir}（${detail}）`, "检查文件权限与编码（需 UTF-8）");
  }
}

/**
 * CLI `--style` 优先于环境变量 `WRITING_AGENT_STYLE`。
 * 二者皆缺返回 undefined（不报错，不注入风格）。
 */
export function pickStyleRef(
  cliStyle: string | undefined,
  envStyle: string | undefined,
): string | undefined {
  const fromCli = cliStyle?.trim();
  if (fromCli) {
    return fromCli;
  }
  const fromEnv = envStyle?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  return undefined;
}

/** 把风格正文附到模型 system 提示（无风格则原样返回）。 */
export function appendStyleToSystem(system: string, profile: StyleProfile | null | undefined): string {
  if (!profile) {
    return system;
  }
  return `${system}\n\n# 写作风格包（${profile.id}）\n${profile.bodyText}`;
}
