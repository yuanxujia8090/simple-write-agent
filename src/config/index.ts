import { readFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { AppError } from "../shared/errors.js";

export type ModelConfig = { provider: string; baseURL: string; modelId: string; apiKey: string | null };
export type SearchConfig = { provider: string; apiKey: string | null };
export type AppConfig = {
  model: ModelConfig;
  search: SearchConfig;
  configPath: string;
  firstRun: boolean;
  warnings: string[];
};
export type LoadConfigOptions = { homeDir: string; env: Record<string, string | undefined> };

/**
 * 内置默认值只是首次启动的占位：provider/baseURL 指向本地 OpenAI 兼容服务，
 * modelId 故意留空，由首次启动引导（firstRun）填写，避免静默使用假配置。
 */
const DEFAULT_MODEL: ModelConfig = {
  provider: "openai-compatible",
  baseURL: "http://localhost:11434/v1",
  modelId: "",
  apiKey: null,
};
const DEFAULT_SEARCH: SearchConfig = { provider: "tavily", apiKey: null };

const ENV_KEYS = {
  modelProvider: "WRITING_AGENT_MODEL_PROVIDER",
  modelBaseURL: "WRITING_AGENT_MODEL_BASE_URL",
  modelId: "WRITING_AGENT_MODEL_ID",
  modelApiKey: "WRITING_AGENT_MODEL_API_KEY",
  searchProvider: "WRITING_AGENT_SEARCH_PROVIDER",
  searchApiKey: "WRITING_AGENT_SEARCH_API_KEY",
} as const;

const MODEL_API_KEY_WARNING =
  "未配置模型 API Key：设置 WRITING_AGENT_MODEL_API_KEY 或在 config.json 里填 model.apiKey";
const SEARCH_API_KEY_WARNING =
  "未配置搜索 API Key：设置 WRITING_AGENT_SEARCH_API_KEY 或在 config.json 里填 search.apiKey";
const BASE_URL_HINT = "示例：https://api.openai.com/v1";

/** 文件里允许只写部分字段；未知字段忽略，类型错误要报出字段名。 */
const fileSchema = z.object({
  model: z
    .object({
      provider: z.string().optional(),
      baseURL: z.string().optional(),
      modelId: z.string().optional(),
      apiKey: z.string().nullable().optional(),
    })
    .optional(),
  search: z
    .object({
      provider: z.string().optional(),
      apiKey: z.string().nullable().optional(),
    })
    .optional(),
});

type FileConfig = z.infer<typeof fileSchema>;

/** 空字符串（含纯空白）视作未设置，便于 shell 里用 VAR= 临时清空。 */
function firstSet(...values: (string | null | undefined)[]): string | null {
  for (const value of values) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed !== "") {
        return trimmed;
      }
    }
  }
  return null;
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "ENOENT"
  );
}

function readConfigFile(configPath: string): { config: FileConfig; exists: boolean } {
  let raw: string;
  try {
    raw = readFileSync(configPath, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return { config: {}, exists: false };
    }
    throw new AppError(
      "CONFIG",
      `无法读取配置文件：${configPath}`,
      "检查文件权限；确认它是可读的普通文件，或删除它让 writing-agent 使用默认配置",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch {
    throw new AppError(
      "CONFIG",
      `配置文件不是合法 JSON：${configPath}`,
      "检查引号、逗号与括号是否配对；程序不会自动覆盖该文件",
    );
  }

  const result = fileSchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    const fieldPath = issue && issue.path.length > 0 ? issue.path.map(String).join(".") : "(根对象)";
    const detail = issue ? issue.message : "结构不符合要求";
    throw new AppError(
      "CONFIG",
      `配置文件字段 ${fieldPath} 类型或结构不正确：${detail}（${configPath}）`,
      "修改该字段的取值或类型；不确定时删除该文件，让 writing-agent 用默认配置重新开始",
    );
  }
  return { config: result.data, exists: true };
}

function assertBaseURL(baseURL: string): void {
  let parsed: URL | undefined;
  try {
    parsed = new URL(baseURL);
  } catch {
    parsed = undefined;
  }
  if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
    throw new AppError(
      "CONFIG",
      `模型接口地址（baseURL）不是合法的 http/https URL：${baseURL}`,
      BASE_URL_HINT,
    );
  }
}

/**
 * 读取配置：环境变量 > ~/.writing-agent/config.json > 内置默认值。
 * 纯函数式：主目录与环境变量都由调用方传入，不读进程状态，不写文件。
 */
export function loadConfig(options: LoadConfigOptions): AppConfig {
  const { homeDir, env } = options;
  const configPath = join(homeDir, ".writing-agent", "config.json");
  const { config: file, exists: fileExists } = readConfigFile(configPath);
  const firstRun = !fileExists;
  const envValue = (key: string): string | undefined => env[key];

  const model: ModelConfig = {
    provider:
      firstSet(envValue(ENV_KEYS.modelProvider), file.model?.provider) ?? DEFAULT_MODEL.provider,
    baseURL:
      firstSet(envValue(ENV_KEYS.modelBaseURL), file.model?.baseURL) ?? DEFAULT_MODEL.baseURL,
    modelId: firstSet(envValue(ENV_KEYS.modelId), file.model?.modelId) ?? DEFAULT_MODEL.modelId,
    apiKey: firstSet(envValue(ENV_KEYS.modelApiKey), file.model?.apiKey ?? null),
  };
  const search: SearchConfig = {
    provider:
      firstSet(envValue(ENV_KEYS.searchProvider), file.search?.provider) ?? DEFAULT_SEARCH.provider,
    apiKey: firstSet(envValue(ENV_KEYS.searchApiKey), file.search?.apiKey ?? null),
  };

  assertBaseURL(model.baseURL);

  const warnings: string[] = [];
  if (model.apiKey === null) {
    warnings.push(MODEL_API_KEY_WARNING);
  }
  if (search.apiKey === null) {
    warnings.push(SEARCH_API_KEY_WARNING);
  }

  return { model, search, configPath, firstRun, warnings };
}
