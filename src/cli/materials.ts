/** 把 --file 路径读成 start() 可用的素材正文；缺文件/全空则抛用法或 IO 错误。 */
import { readFileSync, statSync } from "node:fs";
import { basename, extname, isAbsolute, resolve } from "node:path";

import { AppError } from "../shared/errors.js";

export type LoadedMaterial = {
  /** 解析后的绝对路径，用于报错与展示。 */
  path: string;
  /** 用户传入的原始路径。 */
  raw: string;
  /** UTF-8 正文（已 trim 末尾空白，保留中间换行）。 */
  text: string;
};

/**
 * 读取素材文件列表。路径相对 cwd（通常是工作目录根）。
 * 任一路径不存在或不可读 → USAGE/IO；全部正文空白 → USAGE。
 */
export function loadMaterialsFromFiles(
  rawPaths: readonly string[],
  cwd: string,
): LoadedMaterial[] {
  if (rawPaths.length === 0) {
    return [];
  }

  const loaded: LoadedMaterial[] = [];
  for (const raw of rawPaths) {
    const path = isAbsolute(raw) ? raw : resolve(cwd, raw);
    try {
      const st = statSync(path);
      if (!st.isFile()) {
        throw new AppError(
          "USAGE",
          `素材路径不是文件：${raw}`,
          "请用 --file 指向 .txt 或 .md 文件",
        );
      }
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        "USAGE",
        `找不到素材文件：${raw}`,
        `确认路径存在且可读（解析为 ${path}）`,
      );
    }

    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch (error) {
      throw new AppError(
        "RUNTIME",
        `无法读取素材文件：${raw}（${error instanceof Error ? error.message : String(error)}）`,
        "检查文件权限后重试",
      );
    }
    loaded.push({ path, raw, text });
  }

  const nonEmpty = loaded.filter((item) => item.text.trim().length > 0);
  if (nonEmpty.length === 0) {
    throw new AppError(
      "USAGE",
      "素材文件内容为空，无法开始创作",
      "请在 --file 指向的文件中写入正文，或另选有内容的素材",
    );
  }
  return loaded;
}

/**
 * 话题缺省：显式 --topic > 首个素材文件名（去扩展名）> 素材首行标题（# 标题或首行非空）。
 */
export function deriveTopic(
  explicit: string | undefined,
  materials: readonly LoadedMaterial[],
): string {
  const trimmed = explicit?.trim();
  if (trimmed) {
    return trimmed;
  }
  const first = materials[0];
  if (first === undefined) {
    throw new AppError(
      "USAGE",
      "缺少话题与素材",
      "请用 --topic <主题>，或 --file <素材> 启动创作",
    );
  }
  const fromName = basename(first.path, extname(first.path)).trim();
  if (fromName.length > 0) {
    return fromName;
  }
  const firstLine = first.text
    .split(/\r?\n/u)
    .map((line) => line.replace(/^#+\s*/u, "").trim())
    .find((line) => line.length > 0);
  if (firstLine) {
    return firstLine.slice(0, 80);
  }
  throw new AppError(
    "USAGE",
    "无法从素材推断话题",
    "请显式传入 --topic <主题>",
  );
}

/** 交给 runner.start 的 materials：每项带路径说明 + 正文，便于固定/真实模型引用。 */
export function materialsForStart(materials: readonly LoadedMaterial[]): string[] {
  return materials.map((item) => `来源：${item.raw}\n\n${item.text.trimEnd()}`);
}
