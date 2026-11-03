import { parseArgs } from "node:util";

import { AppError } from "../shared/errors.js";

export type CliOptions = {
  topic: string | undefined;
  files: string[];
  theme: string | undefined;
  style: string | undefined;
  cwd: string | undefined;
  outputDir: string | undefined;
  fast: boolean;
  debug: boolean;
  help: boolean;
  version: boolean;
};

export const defaultCliOptions: CliOptions = {
  topic: undefined,
  files: [],
  theme: undefined,
  style: undefined,
  cwd: undefined,
  outputDir: undefined,
  fast: false,
  debug: false,
  help: false,
  version: false,
};

const PARSE_CONFIG = {
  topic: { type: "string" },
  file: { type: "string", multiple: true },
  theme: { type: "string" },
  style: { type: "string" },
  cwd: { type: "string" },
  "output-dir": { type: "string" },
  fast: { type: "boolean" },
  debug: { type: "boolean" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
} as const;

/**
 * 解析启动参数。未知参数、缺少参数值都转成可读的用法错误。
 * 纯函数：不读进程状态，方便测试。
 */
export function parseCliArgs(argv: readonly string[]): CliOptions {
  let parsed: {
    values: Record<string, string | boolean | (string | boolean)[] | undefined>;
    positionals: string[];
  };

  try {
    parsed = parseArgs({
      args: [...argv],
      options: PARSE_CONFIG,
      allowPositionals: true,
      strict: true,
    });
  } catch (error) {
    throw new AppError(
      "USAGE",
      `参数无法识别：${error instanceof Error ? error.message : String(error)}`,
      "运行 writing-agent --help 查看可用参数",
    );
  }

  if (parsed.positionals.length > 0) {
    throw new AppError(
      "USAGE",
      `不支持的位置参数：${parsed.positionals.join(" ")}`,
      "请用 --topic 传入话题；这样 writing-agent 之外不用再加 run 之类的子命令",
    );
  }

  const str = (key: string): string | undefined => {
    const value = parsed.values[key];
    if (typeof value === "string") {
      return value;
    }
    return undefined;
  };
  const bool = (key: string): boolean => parsed.values[key] === true;
  const filesValue = parsed.values["file"];
  let files: string[] = [];
  if (Array.isArray(filesValue)) {
    files = filesValue.filter((item): item is string => typeof item === "string");
  } else if (typeof filesValue === "string") {
    files = [filesValue];
  }

  return {
    topic: str("topic"),
    files,
    theme: str("theme"),
    style: str("style"),
    cwd: str("cwd"),
    outputDir: str("output-dir"),
    fast: bool("fast"),
    debug: bool("debug"),
    help: bool("help"),
    version: bool("version"),
  };
}
