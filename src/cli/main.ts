import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createAiSdkChat } from "../model/ai-sdk.js";
import { createAiWritingModel } from "../model/writing-model.js";
import { fixedModel, type WritingModel } from "../agent/fixed-model.js";
import { loadLocalEnvFile } from "../config/env-file.js";
import { loadConfig, type AppConfig } from "../config/index.js";
import { loadTheme } from "../config/theme.js";
import { AppError, exitCodeFor } from "../shared/errors.js";
import { pickStyleRef, resolveStyleRef, type StyleProfile } from "../style/index.js";
import {
  createWorkspaceIdentity,
  writeMarker,
} from "../workspace/marker.js";
import { resolveWorkspace, type Workspace } from "../workspace/index.js";
import { type CliOptions, parseCliArgs } from "./args.js";
import { runAutoApprovedWriting, type AutoRunResult } from "./auto-run.js";
import { helpText } from "./help.js";
import {
  deriveTopic,
  loadMaterialsFromFiles,
  materialsForStart,
  type LoadedMaterial,
} from "./materials.js";

export type CliDeps = {
  cwd: string;
  homeDir: string;
  env: Record<string, string | undefined>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  version: string;
  /** 测试可注入创作推进；默认走固定/真实模型 + 自动批准。 */
  runWriting?: (input: {
    topic: string;
    materials: string[];
    mode: "normal" | "fast";
    workspace: Workspace;
    style: StyleProfile | null;
    model: WritingModel;
  }) => Promise<AutoRunResult>;
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

function describeConfig(config: AppConfig, modelLabel: string): string[] {
  const lines = [
    `配置文件：${config.configPath}${config.firstRun ? "（尚未创建）" : ""}`,
    `  模型：${config.model.provider} / ${config.model.modelId}`,
    `  模型地址：${config.model.baseURL}`,
    `  模型密钥：${config.model.apiKey ? "已配置" : "未配置"}`,
    `  本次创作模型：${modelLabel}`,
    `  搜索：${config.search.provider}（密钥${config.search.apiKey ? "已配置" : "未配置"}）`,
  ];
  for (const warning of config.warnings) {
    lines.push(`  提示：${warning}`);
  }
  return lines;
}

function describeInputs(
  options: CliOptions,
  style: StyleProfile | null,
  materials: readonly LoadedMaterial[],
  topic: string | undefined,
): string[] {
  const lines: string[] = [];
  if (topic) {
    lines.push(`话题：${topic}`);
  }
  if (materials.length > 0) {
    lines.push(`素材文件：${materials.map((item) => item.raw).join("、")}`);
  } else if (options.files.length > 0) {
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
    lines.push("模式：快速（只保留论点和终稿确认点；非交互下将自动批准）");
  }
  return lines;
}

function shouldStartWriting(options: CliOptions): boolean {
  return options.files.length > 0 || Boolean(options.topic?.trim());
}

function resolveWritingModel(config: AppConfig, style: StyleProfile | null): {
  model: WritingModel;
  label: string;
} {
  if (config.model.apiKey) {
    return {
      model: createAiWritingModel({
        chat: createAiSdkChat({ model: config.model }),
        ...(style ? { styleProfile: style } : {}),
      }),
      label: `真实模型 ${config.model.modelId}`,
    };
  }
  return {
    model: fixedModel,
    label: "固定结果（未配置 API Key，不联网）",
  };
}

function ensureWorkspaceId(workspace: Workspace): { workspace: Workspace; created: boolean } {
  if (workspace.identity) {
    return { workspace, created: false };
  }
  const identity = createWorkspaceIdentity();
  writeMarker(workspace.root, identity);
  return {
    workspace: { ...workspace, identity, source: workspace.source },
    created: true,
  };
}

function formatRunResult(result: AutoRunResult): string[] {
  const lines = [
    "",
    `创作结果：${result.status}（阶段 ${result.stage}，门禁 ${result.gateCount} 次）`,
    `会话：${result.sessionId}`,
    `大纲：${result.output.outlinePath ?? "（未生成）"}`,
    `主稿：${result.output.draftPath ?? "（未生成）"}`,
    `导出：${result.output.exportedPath ?? "（未生成）"}`,
    `HTML：${result.output.htmlPath ?? "（未生成）"}${
      result.output.htmlError === null || result.output.htmlError === undefined
        ? ""
        : `（失败：${result.output.htmlError}）`
    }`,
  ];
  if (result.error) {
    lines.push(`错误：${result.error}`);
  }
  return lines;
}

/**
 * 命令行主流程。返回退出码，不直接结束进程（方便测试）。
 * - 无 --file / --topic：只打印启动概览（不创建会话、不写库）。
 * - 有素材或话题：读素材 → 解析风格 → 装配 runner → 非交互自动批准至导出。
 */
export async function runCli(
  argv: readonly string[],
  overrides: Partial<CliDeps> = {},
): Promise<number> {
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
  let materials: LoadedMaterial[] = [];
  let topic: string | undefined;
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
    if (shouldStartWriting(options)) {
      materials = loadMaterialsFromFiles(options.files, workspace.root);
      topic = deriveTopic(options.topic, materials);
    }
  } catch (error) {
    reportError(error, deps.stderr);
    return exitCodeFor(error);
  }

  const { model, label: modelLabel } = resolveWritingModel(config, style);
  const lines = [
    "写作 Agent 启动检查",
    "",
    ...describeWorkspace(workspace),
    "",
    ...describeConfig(config, modelLabel),
  ];
  const inputs = describeInputs(options, style, materials, topic);
  if (inputs.length > 0) {
    lines.push("", ...inputs);
  }

  if (!shouldStartWriting(options)) {
    lines.push(
      "",
      "未指定 --file / --topic：只做启动检查，不开始创作。",
      "素材→成稿示例：writing-agent --file ./notes.md --topic \"测\" --fast",
    );
    deps.stdout(lines.join("\n"));
    return 0;
  }

  // 有创作意图：确保工作目录身份，再跑自动批准闭环。
  let ensured: { workspace: Workspace; created: boolean };
  try {
    ensured = ensureWorkspaceId(workspace);
  } catch (error) {
    reportError(error, deps.stderr);
    return exitCodeFor(error);
  }
  workspace = ensured.workspace;
  if (ensured.created && workspace.identity) {
    lines.push(`  已写入目录身份：${workspace.identity.workspaceId}`);
  }

  lines.push("", "开始创作（非交互：门禁自动批准）…");
  deps.stdout(lines.join("\n"));

  const mode = options.fast ? "fast" : "normal";
  const materialPayload = materialsForStart(materials);

  try {
    const runWriting =
      deps.runWriting ??
      ((input) =>
        runAutoApprovedWriting({
          topic: input.topic,
          materials: input.materials,
          mode: input.mode,
          workspaceRoot: input.workspace.root,
          workspaceId: input.workspace.identity?.workspaceId ?? null,
          model: input.model,
          styleProfile: input.style,
          theme: loadTheme(
            options.theme === undefined ? {} : { path: options.theme },
          ).theme,
        }));

    const result = await runWriting({
      topic: topic!,
      materials: materialPayload,
      mode,
      workspace,
      style,
      model,
    });

    deps.stdout(formatRunResult(result).join("\n"));
    if (result.status !== "exported" || result.output.exportedPath === null) {
      deps.stderr(
        result.error
          ? `错误：创作未导出主稿（${result.error}）`
          : "错误：创作未导出主稿",
      );
      return 1;
    }
    return 0;
  } catch (error) {
    reportError(error, deps.stderr);
    return exitCodeFor(error);
  }
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
