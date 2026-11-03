import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runCli } from "./main.js";

let root: string;
let homeDir: string;
let cwd: string;

type Captured = { code: number; out: string; err: string };

/** 用临时目录和注入的环境变量运行 CLI，绝不触碰真实主目录。 */
async function run(
  argv: string[],
  env: Record<string, string | undefined> = {},
  extra: Parameters<typeof runCli>[1] = {},
): Promise<Captured> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCli(argv, {
    cwd,
    homeDir,
    env,
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    version: "9.9.9",
    ...extra,
  });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "writing-agent-cli-"));
  homeDir = join(root, "home");
  cwd = join(root, "project");
  await mkdir(homeDir, { recursive: true });
  await mkdir(cwd, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("runCli", () => {
  it("--help 输出用法与素材→成稿示例并以 0 退出", async () => {
    const result = await run(["--help"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("用法");
    expect(result.out).toContain("--topic");
    expect(result.out).toContain("--file");
    expect(result.out).toContain("--style");
    expect(result.out).toContain("notes.md");
    expect(result.out).toContain("素材→成稿");
    expect(result.err).toBe("");
  });

  it("--version 输出版本号", async () => {
    const result = await run(["--version"]);
    expect(result.code).toBe(0);
    expect(result.out.trim()).toBe("9.9.9");
  });

  it("未知参数返回 1 并提示查看帮助", async () => {
    const result = await run(["--nope"]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("--nope");
    expect(result.err).toContain("--help");
    expect(result.out).toBe("");
  });

  it("无 --file/--topic 只打印启动检查，不开始创作", async () => {
    const result = await run([]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("工作目录");
    expect(result.out).toContain(cwd);
    expect(result.out).toContain("只做启动检查");
    expect(result.out).toContain("素材→成稿示例");
    expect(result.err).toBe("");
  });

  it("启动检查时不在主目录创建任何文件", async () => {
    const result = await run([]);
    expect(result.code).toBe(0);
    const entries = await readdir(homeDir);
    expect(entries).toEqual([]);
  });

  it("--cwd 指向不存在的目录时报工作目录错误", async () => {
    const result = await run(["--cwd", join(root, "missing")]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("错误");
    expect(result.err).toContain("工作目录");
  });

  it("配置文件损坏时给出文件路径和字段提示", async () => {
    const configDir = join(homeDir, ".writing-agent");
    await mkdir(configDir, { recursive: true });
    await writeFile(join(configDir, "config.json"), "{ 坏掉的 JSON", "utf8");

    const result = await run([]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("配置文件");
    expect(result.err).toContain("config.json");
  });

  it("子目录启动时向上认领工作目录标记", async () => {
    const { writeMarker, createWorkspaceIdentity } = await import("../workspace/marker.js");
    const identity = createWorkspaceIdentity({ id: "ws-test-1" });
    writeMarker(cwd, identity);
    const nested = join(cwd, "articles");
    await mkdir(nested, { recursive: true });

    const out: string[] = [];
    const code = await runCli([], {
      cwd: nested,
      homeDir,
      env: {},
      stdout: (text) => out.push(text),
      stderr: (text) => out.push(text),
      version: "9.9.9",
    });

    expect(code).toBe(0);
    const text = out.join("\n");
    expect(text).toContain(`工作目录：${cwd}`);
    expect(text).toContain("ws-test-1");
    expect(text).toContain("向上找到 .writing-agent 标记");
  });

  it("--style 读到本地包并打印风格摘要（无创作意图时不跑编排）", async () => {
    const pack = join(homeDir, ".writing-agent", "styles", "demo");
    await mkdir(pack, { recursive: true });
    await writeFile(join(pack, "profile.md"), "CLI_STYLE_MARKER", "utf8");
    const result = await run(["--style", "demo"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("风格包：demo");
    expect(result.out).toContain(pack);
    expect(result.out).toContain("只做启动检查");
    expect(result.err).toBe("");
  });

  it("--style 优先于 WRITING_AGENT_STYLE", async () => {
    const cliPack = join(homeDir, ".writing-agent", "styles", "cli-pack");
    const envPack = join(homeDir, ".writing-agent", "styles", "env-pack");
    await mkdir(cliPack, { recursive: true });
    await mkdir(envPack, { recursive: true });
    await writeFile(join(cliPack, "profile.md"), "FROM_CLI", "utf8");
    await writeFile(join(envPack, "profile.md"), "FROM_ENV", "utf8");
    const result = await run(["--style", "cli-pack"], { WRITING_AGENT_STYLE: "env-pack" });
    expect(result.code).toBe(0);
    expect(result.out).toContain("风格包：cli-pack");
    expect(result.out).not.toContain("风格包：env-pack");
  });

  it("仅环境变量也可加载风格包", async () => {
    const pack = join(homeDir, ".writing-agent", "styles", "env-only");
    await mkdir(pack, { recursive: true });
    await writeFile(join(pack, "profile.md"), "ENV_ONLY", "utf8");
    const result = await run([], { WRITING_AGENT_STYLE: "env-only" });
    expect(result.code).toBe(0);
    expect(result.out).toContain("风格包：env-only");
  });

  it("风格包缺失时返回用法错误", async () => {
    const result = await run(["--style", "no-such-style"]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("找不到风格包目录");
    expect(result.err).toContain("profile.md");
  });

  it("--file 缺失时非 0 且 stderr 含路径", async () => {
    const result = await run(["--file", "./nope.md", "--topic", "测"]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("找不到素材文件");
    expect(result.err).toContain("nope.md");
  });

  it("--file 素材→主稿 md（固定模型，不联网）", async () => {
    await writeFile(join(cwd, "notes.md"), "# 本地笔记\n\n知识库不该只是收藏夹。\n", "utf8");
    const result = await run(["--file", "notes.md", "--topic", "测", "--fast"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("开始创作");
    expect(result.out).toContain("创作结果：exported");
    expect(result.out).toContain("固定结果");
    expect(result.err).toBe("");

    const exportedLine = result.out
      .split("\n")
      .find((line) => line.startsWith("导出：") && !line.includes("（未生成）"));
    expect(exportedLine).toBeTruthy();
    const exportedPath = exportedLine!.slice("导出：".length).trim();
    expect(existsSync(exportedPath)).toBe(true);
    expect(exportedPath.includes(`${cwd}/`) || exportedPath.startsWith(cwd)).toBe(true);
    const body = await readFile(exportedPath, "utf8");
    expect(body.length).toBeGreaterThan(100);
  });

  it("可注入 runWriting 覆盖真实编排（单测隔离）", async () => {
    await writeFile(join(cwd, "a.md"), "素材", "utf8");
    const result = await run(
      ["--file", "a.md", "--topic", "隔离"],
      {},
      {
        runWriting: async () => ({
          status: "exported",
          stage: "exported",
          gateCount: 2,
          error: null,
          sessionId: "sess-test",
          output: {
            outlinePath: join(cwd, "outlines/x.outline.md"),
            draftPath: join(cwd, "articles/x.md"),
            exportedPath: join(cwd, "articles/x.md"),
            htmlPath: join(cwd, "articles/x.html"),
            htmlError: null,
          },
        }),
      },
    );
    expect(result.code).toBe(0);
    expect(result.out).toContain("sess-test");
    expect(result.out).toContain("articles/x.md");
  });
});
