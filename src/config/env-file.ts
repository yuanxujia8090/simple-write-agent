/**
 * `.env.local` 读取：给真实模型配置留一个不提交的入口。
 * 规则与常见 dotenv 一致：注释与空行忽略，KEY=VALUE，可带引号；
 * 已存在的环境变量优先（shell 里显式设置的值不会被文件覆盖）。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type LoadEnvFileResult = {
  path: string;
  /** 本次从文件里新增的变量名。 */
  applied: string[];
  /** 文件不存在时为 false；其他读取错误直接抛出。 */
  exists: boolean;
};

export function parseEnvText(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    const withoutExport = line.startsWith("export ") ? line.slice("export ".length) : line;
    const separator = withoutExport.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const key = withoutExport.slice(0, separator).trim();
    if (key === "") {
      continue;
    }
    let value = withoutExport.slice(separator + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
    if (quoted && value.length >= 2) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

/** 读取 `<cwd>/.env.local`；不存在时安静返回，不创建文件。 */
export function loadLocalEnvFile(options: {
  cwd: string;
  env: Record<string, string | undefined>;
  fileName?: string;
}): LoadEnvFileResult {
  const path = join(options.cwd, options.fileName ?? ".env.local");
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code: unknown }).code === "ENOENT"
    ) {
      return { path, applied: [], exists: false };
    }
    throw error;
  }

  const parsed = parseEnvText(text.replace(/^\uFEFF/, ""));
  const applied: string[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    const current = options.env[key];
    if (current !== undefined && current.trim() !== "") {
      continue;
    }
    options.env[key] = value;
    applied.push(key);
  }
  return { path, applied, exists: true };
}
