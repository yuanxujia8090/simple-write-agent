import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AppError } from "../shared/errors.js";
import { loadConfig } from "./index.js";

const SECRET_MODEL_KEY = "sk-test-fake-model-key-0000";
const SECRET_SEARCH_KEY = "tvly-test-fake-search-key-0000";

let homeDir: string;

beforeEach(async () => {
  homeDir = await mkdtemp(join(tmpdir(), "writing-agent-config-"));
});

afterEach(async () => {
  await rm(homeDir, { recursive: true, force: true });
});

/** 在临时 home 里写 config.json；对象序列化，字符串原样写入（用于损坏 JSON）。 */
async function writeConfigFile(content: unknown): Promise<string> {
  const dir = join(homeDir, ".writing-agent");
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, "config.json");
  const text = typeof content === "string" ? content : JSON.stringify(content);
  await writeFile(filePath, text, "utf8");
  return filePath;
}

function captureConfigError(run: () => unknown): AppError {
  try {
    run();
  } catch (error) {
    if (error instanceof AppError) {
      return error;
    }
    throw error;
  }
  throw new Error("预期 loadConfig 抛出 AppError，实际没有抛错");
}

function expectNoSecrets(text: string): void {
  expect(text).not.toContain(SECRET_MODEL_KEY);
  expect(text).not.toContain(SECRET_SEARCH_KEY);
}

describe("loadConfig 缺省配置", () => {
  it("文件不存在时用默认值，标记 firstRun 且不创建文件", async () => {
    const config = loadConfig({ homeDir, env: {} });

    expect(config.firstRun).toBe(true);
    expect(config.configPath).toBe(join(homeDir, ".writing-agent", "config.json"));
    expect(config.model.provider).not.toBe("");
    expect(config.model.baseURL).toMatch(/^https?:\/\//);
    expect(config.model.apiKey).toBeNull();
    expect(config.search.provider).not.toBe("");
    expect(config.search.apiKey).toBeNull();
    await expect(readFile(config.configPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("缺省时给出两条凭据缺失提示，文本指向环境变量和 config.json", async () => {
    const config = loadConfig({ homeDir, env: {} });

    expect(config.warnings).toHaveLength(2);
    expect(config.warnings.join("\n")).toContain("WRITING_AGENT_MODEL_API_KEY");
    expect(config.warnings.join("\n")).toContain("WRITING_AGENT_SEARCH_API_KEY");
    expect(config.warnings.join("\n")).toContain("model.apiKey");
    expect(config.warnings.join("\n")).toContain("search.apiKey");
  });
});

describe("loadConfig 读取文件", () => {
  it("合法文件覆盖默认值，firstRun=false 且凭据齐全时无警告", async () => {
    const configPath = await writeConfigFile({
      model: {
        provider: "openai-compatible",
        baseURL: "http://localhost:1234/v1",
        modelId: "test-chat-model",
        apiKey: SECRET_MODEL_KEY,
      },
      search: { provider: "tavily", apiKey: SECRET_SEARCH_KEY },
    });

    const config = loadConfig({ homeDir, env: {} });

    expect(config.firstRun).toBe(false);
    expect(config.configPath).toBe(configPath);
    expect(config.model).toEqual({
      provider: "openai-compatible",
      baseURL: "http://localhost:1234/v1",
      modelId: "test-chat-model",
      apiKey: SECRET_MODEL_KEY,
    });
    expect(config.search).toEqual({ provider: "tavily", apiKey: SECRET_SEARCH_KEY });
    expect(config.warnings).toEqual([]);
  });

  it("文件只写部分字段时其余字段回落默认值", async () => {
    await writeConfigFile({ model: { modelId: "partial-model" } });

    const config = loadConfig({ homeDir, env: {} });

    expect(config.firstRun).toBe(false);
    expect(config.model.modelId).toBe("partial-model");
    expect(config.model.provider).not.toBe("");
    expect(config.model.baseURL).toMatch(/^https?:\/\//);
  });
});

describe("loadConfig 环境变量优先级", () => {
  it("环境变量覆盖文件配置", async () => {
    await writeConfigFile({
      model: {
        provider: "file-provider",
        baseURL: "http://localhost:1234/v1",
        modelId: "file-model",
        apiKey: SECRET_MODEL_KEY,
      },
      search: { provider: "file-search", apiKey: SECRET_SEARCH_KEY },
    });

    const config = loadConfig({
      homeDir,
      env: {
        WRITING_AGENT_MODEL_PROVIDER: "env-provider",
        WRITING_AGENT_MODEL_BASE_URL: "https://env.example.com/v1",
        WRITING_AGENT_MODEL_ID: "env-model",
        WRITING_AGENT_MODEL_API_KEY: "sk-env-model-key",
        WRITING_AGENT_SEARCH_PROVIDER: "env-search",
        WRITING_AGENT_SEARCH_API_KEY: "tvly-env-search-key",
      },
    });

    expect(config.model).toEqual({
      provider: "env-provider",
      baseURL: "https://env.example.com/v1",
      modelId: "env-model",
      apiKey: "sk-env-model-key",
    });
    expect(config.search).toEqual({ provider: "env-search", apiKey: "tvly-env-search-key" });
    expect(config.warnings).toEqual([]);
  });

  it("只覆盖部分字段时其它字段仍用文件值", async () => {
    await writeConfigFile({
      model: { provider: "file-provider", modelId: "file-model", apiKey: SECRET_MODEL_KEY },
      search: { provider: "tavily", apiKey: SECRET_SEARCH_KEY },
    });

    const config = loadConfig({
      homeDir,
      env: { WRITING_AGENT_MODEL_ID: "env-model", WRITING_AGENT_MODEL_PROVIDER: "" },
    });

    expect(config.model.provider).toBe("file-provider");
    expect(config.model.modelId).toBe("env-model");
    expect(config.model.apiKey).toBe(SECRET_MODEL_KEY);
  });

  it("空字符串环境变量按未设置处理", async () => {
    await writeConfigFile({
      model: { modelId: "file-model", apiKey: SECRET_MODEL_KEY },
      search: { apiKey: SECRET_SEARCH_KEY },
    });

    const config = loadConfig({
      homeDir,
      env: {
        WRITING_AGENT_MODEL_ID: "",
        WRITING_AGENT_MODEL_API_KEY: "   ",
        WRITING_AGENT_SEARCH_API_KEY: undefined,
      },
    });

    expect(config.model.modelId).toBe("file-model");
    expect(config.model.apiKey).toBe(SECRET_MODEL_KEY);
    expect(config.search.apiKey).toBe(SECRET_SEARCH_KEY);
    expect(config.warnings).toEqual([]);
  });

  it("环境变量可覆盖缺失的文件配置而无需文件存在", async () => {
    const config = loadConfig({
      homeDir,
      env: {
        WRITING_AGENT_MODEL_BASE_URL: "https://env.example.com/v1",
        WRITING_AGENT_MODEL_ID: "env-only-model",
        WRITING_AGENT_MODEL_API_KEY: "sk-env-only",
        WRITING_AGENT_SEARCH_API_KEY: "tvly-env-only",
      },
    });

    expect(config.firstRun).toBe(true);
    expect(config.model.baseURL).toBe("https://env.example.com/v1");
    expect(config.model.modelId).toBe("env-only-model");
    expect(config.model.apiKey).toBe("sk-env-only");
    expect(config.search.apiKey).toBe("tvly-env-only");
    expect(config.warnings).toEqual([]);
  });
});

describe("loadConfig 配置损坏", () => {
  it("JSON 无法解析时抛 CONFIG 错误，消息含文件路径且不改写文件", async () => {
    const configPath = await writeConfigFile('{ "model": { "modelId": "broken", } ');
    const before = await readFile(configPath, "utf8");

    const error = captureConfigError(() => loadConfig({ homeDir, env: {} }));

    expect(error.code).toBe("CONFIG");
    expect(error.message).toContain(configPath);
    expect(error.message).toContain("JSON");
    expect(error.hint).toBeTruthy();
    expect(await readFile(configPath, "utf8")).toBe(before);
  });

  it("字段类型错误时抛 CONFIG 错误，消息含文件路径和字段名", async () => {
    const configPath = await writeConfigFile({ model: { modelId: 123, apiKey: SECRET_MODEL_KEY } });

    const error = captureConfigError(() => loadConfig({ homeDir, env: {} }));

    expect(error.code).toBe("CONFIG");
    expect(error.message).toContain(configPath);
    expect(error.message).toContain("model.modelId");
    expectNoSecrets(error.message);
    expectNoSecrets(error.hint ?? "");
  });

  it("search 字段类型错误时消息指出 search 字段", async () => {
    const configPath = await writeConfigFile({ search: { apiKey: 42 } });

    const error = captureConfigError(() => loadConfig({ homeDir, env: {} }));

    expect(error.code).toBe("CONFIG");
    expect(error.message).toContain(configPath);
    expect(error.message).toContain("search.apiKey");
  });

  it("配置根节点不是对象时抛 CONFIG 错误", async () => {
    const configPath = await writeConfigFile(["not", "an", "object"]);

    const error = captureConfigError(() => loadConfig({ homeDir, env: {} }));

    expect(error.code).toBe("CONFIG");
    expect(error.message).toContain(configPath);
  });
});

describe("loadConfig baseURL 校验", () => {
  it("文件里的 baseURL 不是合法 http/https URL 时抛 CONFIG 错误并给示例提示", async () => {
    await writeConfigFile({ model: { baseURL: "ftp://example.com/v1", apiKey: SECRET_MODEL_KEY } });

    const error = captureConfigError(() => loadConfig({ homeDir, env: {} }));

    expect(error.code).toBe("CONFIG");
    expect(error.message).toContain("baseURL");
    expect(error.hint).toBe("示例：https://api.openai.com/v1");
    expectNoSecrets(error.message);
    expectNoSecrets(error.hint ?? "");
  });

  it("环境变量里的 baseURL 非法时同样抛 CONFIG 错误", async () => {
    await writeConfigFile({ model: { baseURL: "http://localhost:1234/v1" } });

    const error = captureConfigError(() =>
      loadConfig({
        homeDir,
        env: { WRITING_AGENT_MODEL_BASE_URL: "not-a-url", WRITING_AGENT_MODEL_API_KEY: SECRET_MODEL_KEY },
      }),
    );

    expect(error.code).toBe("CONFIG");
    expect(error.hint).toBe("示例：https://api.openai.com/v1");
  });
});

describe("loadConfig 凭据缺失提示", () => {
  it("只缺模型密钥时给一条提示，且提示不含密钥值", async () => {
    await writeConfigFile({
      model: { modelId: "m", apiKey: SECRET_MODEL_KEY },
      search: { apiKey: null },
    });

    const config = loadConfig({ homeDir, env: {} });

    expect(config.warnings).toHaveLength(1);
    expect(config.warnings[0]).toContain("WRITING_AGENT_SEARCH_API_KEY");
    expectNoSecrets(config.warnings.join("\n"));
  });

  it("只缺搜索密钥时给一条提示，且提示不含其它密钥值", async () => {
    await writeConfigFile({
      model: { modelId: "m", apiKey: null },
      search: { apiKey: SECRET_SEARCH_KEY },
    });

    const config = loadConfig({ homeDir, env: { WRITING_AGENT_MODEL_API_KEY: SECRET_MODEL_KEY } });

    expect(config.warnings).toHaveLength(0);
    expectNoSecrets(config.warnings.join("\n"));
  });

  it("文件里的密钥不会出现在缺省警告和配置路径里", async () => {
    await writeConfigFile({ model: { apiKey: SECRET_MODEL_KEY } });

    const config = loadConfig({ homeDir, env: {} });

    expect(config.warnings).toHaveLength(1);
    expect(config.warnings[0]).toContain("WRITING_AGENT_SEARCH_API_KEY");
    expectNoSecrets(config.warnings.join("\n"));
    expectNoSecrets(config.configPath);
  });
});
