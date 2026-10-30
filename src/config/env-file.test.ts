/** `.env.local` 解析：注释、引号、export 前缀与「不覆盖已设置变量」。 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadLocalEnvFile, parseEnvText } from "./env-file.js";

const dirs: string[] = [];

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "writing-agent-env-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("环境文件解析", () => {
  it("忽略注释与空行，去掉引号和 export 前缀", () => {
    const parsed = parseEnvText(
      [
        "# 注释",
        "",
        "A=1",
        'B="two words"',
        "C='single'",
        "export D=4",
        "没有等号的行",
        "=5",
      ].join("\n"),
    );
    expect(parsed).toEqual({ A: "1", B: "two words", C: "single", D: "4" });
  });

  it("文件不存在时安静返回，不创建文件", () => {
    const dir = makeDir();
    const env: Record<string, string | undefined> = {};
    const result = loadLocalEnvFile({ cwd: dir, env });
    expect(result.exists).toBe(false);
    expect(result.applied).toEqual([]);
    expect(env).toEqual({});
  });

  it("把文件里的变量写入环境，但不覆盖已有值", () => {
    const dir = makeDir();
    writeFileSync(
      join(dir, ".env.local"),
      "WRITING_AGENT_MODEL_ID=qwen3:8b\nWRITING_AGENT_MODEL_BASE_URL=http://localhost:9999/v1\n",
      "utf8",
    );
    const env: Record<string, string | undefined> = {
      WRITING_AGENT_MODEL_ID: "from-shell",
    };
    const result = loadLocalEnvFile({ cwd: dir, env });

    expect(result.exists).toBe(true);
    expect(result.applied).toEqual(["WRITING_AGENT_MODEL_BASE_URL"]);
    expect(env.WRITING_AGENT_MODEL_ID).toBe("from-shell");
    expect(env.WRITING_AGENT_MODEL_BASE_URL).toBe("http://localhost:9999/v1");
  });

  it("空字符串的已有变量会被文件值填入", () => {
    const dir = makeDir();
    writeFileSync(join(dir, ".env.local"), "KEY=from-file\n", "utf8");
    const env: Record<string, string | undefined> = { KEY: "  " };
    loadLocalEnvFile({ cwd: dir, env });
    expect(env.KEY).toBe("from-file");
  });
});
