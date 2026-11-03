import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadLocalEnvFile } from "../config/env-file.js";
import { loadConfig, type AppConfig } from "../config/index.js";
import { AppError, exitCodeFor } from "../shared/errors.js";
import { resolveWorkspace, type Workspace } from "../workspace/index.js";
import { type CliOptions, parseCliArgs } from "./args.js";
import { helpText } from "./help.js";
import { pickStyleRef, resolveStyleRef, type StyleProfile } from "../style/index.js";

export type CliDeps = {
  cwd: string;
  homeDir: string;
  env: Record<string, string | undefined>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  version: string;
};

/** 从包描述里读版本号；读不到就用占位值，不影响启动。 */
function readVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const raw = readFileSync(join(here, "..", "..", "package.json"), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && "version" in parsed) {
      const version = (parsed as { version?: unknown }).version;
      if (typeof version === "string" && version.length > 0) {
        return version;
      }
    }
  } catch {
    // 忽略：版本号不是启动必需项
  }
  return "0.0.0";
}

function defaultDeps(): CliDeps {
  const env: Record<string, string | undefined> = { ...process.env };
  try {
    // 真实模型配置放 .env.local；文件不存在时安静跳过，shell 里的值优先。
    loadLocalEnvFile({ cwd: process.cwd(), env });
  } catch {
    // 环境文件只是便利入口：读不了不阻塞启动，配置检查会给出对应提示。
  }
  return {
    cwd: process.cwd(),
    homeDir: homedir(),
    env,
    stdout: (text) => process.stdout.write(`${text}\n`),
    stderr: (text) => process.stderr.write(`${text}\n`),
    version: readVersion(),
  };
}

function describeWorkspace(workspace: Workspace): string[] {
  const sourceLabel: Record<Workspace["source"], string> = {
    flag: "来自 --cwd",
    marker: "向上找到 .writing-agent 标记",
    cwd: "未找到标记，使用当前目录",
  };
  const lines = [
    `工作目录：${workspace.root}`,
    `  识别方式：${sourceLabel[workspace.source]}`,
  ];
  if (workspace.identity) {
    lines.push(`  目录身份：${workspace.identity.workspaceId}`);
  } else {
    lines.push("  目录身份：首次创建会话时写入 .writing-agent/workspace.json");
  }
  return lines;
}

function describeConfig(config: AppConfig): string[] {
  const lines = [
    `配置文件：${config.configPath}${config.firstRun ? "（尚未创建）" : ""}`,
    `  模型：${config.model.provider} / ${config.model.modelId}`,
    `  模型地址：${config.model.baseURL}`,
    `  模型密钥：${config.model.apiKey ? "已配置" : "未配置"}`,
    `  搜索：${config.search.provider}（密钥${config.search.apiKey ? "已配置" : "未配置"}）`,
  ];
  for (const warning of config.warnings) {
    lines.push(`  提示：${warning}`);
  }
  return lines;
}

function describeInputs(options: CliOptions, style: StyleProfile | null): string[] {
  const lines: string[] = [];
  if (options.topic) {
    lines.push(`话题：${options.topic}`);
  }
  if (options.files.length > 0) {
    lines.push(`素材文件：${options.files.join("、")}`);
  }
  if (options.theme) {
    lines.push(`主题：${options.theme}`);
  }
  if (style) {
    lines.push(`风格包：${style.id}（${style.rootDir}）`);
    lines.push(`  入口：${style.entryPath}`);
  }
  if (options.outputDir) {
    lines.push(`导出目录：${options.outputDir}`);
  }
  if (options.fast) {
    lines.push("模式：快速（只保留论点和终稿确认）");
  }
  return lines;
}

/**
 * 命令行主流程。返回退出码，不直接结束进程（方便测试）。
 * 本阶段只做：参数 → 配置 → 工作目录 → 打印启动概览。
 * 不在这里创建目录、不获取锁、不写文件；这些在真正开始会话时才发生。
 */
export function runCli(argv: readonly string[], overrides: Partial<CliDeps> = {}): number {
  const deps = { ...defaultDeps(), ...overrides };

  let options: CliOptions;
  try {
    options = parseCliArgs(argv);
  } catch (error) {
    reportError(error, deps.stderr);
    return exitCodeFor(error);
  }

  if (options.help) {
    deps.stdout(helpText());
    return 0;
  }
  if (options.version) {
    deps.stdout(deps.version);
    return 0;
  }

  let workspace: Workspace;
  let config: AppConfig;
  let style: StyleProfile | null = null;
  try {
    workspace = resolveWorkspace({
      cwd: deps.cwd,
      ...(options.cwd === undefined ? {} : { explicitCwd: options.cwd }),
    });
    config = loadConfig({ homeDir: deps.homeDir, env: deps.env });
    const styleRef = pickStyleRef(options.style, deps.env.WRITING_AGENT_STYLE);
    if (styleRef !== undefined) {
      style = resolveStyleRef(styleRef, { homeDir: deps.homeDir, cwd: workspace.root });
    }
  } catch (error) {
    reportError(error, deps.stderr);
    return exitCodeFor(error);
  }

  const lines = ["写作 Agent 启动检查", "", ...describeWorkspace(workspace), "", ...describeConfig(config)];
  const inputs = describeInputs(options, style);
  if (inputs.length > 0) {
    lines.push("", ...inputs);
  }
  lines.push("", "交互界面尚未接入：本版本只验证启动、配置与工作目录解析。");
  deps.stdout(lines.join("\n"));
  return 0;
}

function reportError(error: unknown, write: (text: string) => void): void {
  if (error instanceof AppError) {
    write(`错误：${error.message}`);
    if (error.hint) {
      write(`提示：${error.hint}`);
    }
    return;
  }
  write(`错误：${error instanceof Error ? error.message : String(error)}`);
}
