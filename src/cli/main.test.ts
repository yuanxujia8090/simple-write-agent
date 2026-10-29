import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runCli } from "./main.js";

let root: string;
let homeDir: string;
let cwd: string;

type Captured = { code: number; out: string; err: string };

/** 用临时目录和注入的环境变量运行 CLI，绝不触碰真实主目录。 */
function run(argv: string[], env: Record<string, string | undefined> = {}): Captured {
  const out: string[] = [];
  const err: string[] = [];
  const code = runCli(argv, {
    cwd,
    homeDir,
    env,
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    version: "9.9.9",
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
  it("--help 输出用法与参数并以 0 退出", () => {
    const result = run(["--help"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("用法");
    expect(result.out).toContain("--topic");
    expect(result.out).toContain("--cwd");
    expect(result.err).toBe("");
  });

  it("--version 输出版本号", () => {
    const result = run(["--version"]);
    expect(result.code).toBe(0);
    expect(result.out.trim()).toBe("9.9.9");
  });

  it("未知参数返回 1 并提示查看帮助", () => {
    const result = run(["--nope"]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("--nope");
    expect(result.err).toContain("--help");
    expect(result.out).toBe("");
  });

  it("无参数启动打印工作目录与配置概览", () => {
    const result = run([
      "--topic",
      "跨端同步",
      "--file",
      "notes.md",
      "--output-dir",
      "out",
      "--fast",
    ]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("工作目录");
    expect(result.out).toContain(cwd);
    expect(result.out).toContain("未找到标记");
    expect(result.out).toContain("首次创建会话时写入");
    expect(result.out).toContain(`配置文件：${join(homeDir, ".writing-agent", "config.json")}`);
    expect(result.out).toContain("话题：跨端同步");
    expect(result.out).toContain("素材文件：notes.md");
    expect(result.out).toContain("快速");
    expect(result.err).toBe("");
  });

  it("启动时不在真实主目录创建任何文件", async () => {
    const result = run([]);
    expect(result.code).toBe(0);
    const entries = await readdir(homeDir);
    expect(entries).toEqual([]);
  });

  it("--cwd 指向不存在的目录时报工作目录错误", () => {
    const result = run(["--cwd", join(root, "missing")]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("错误");
    expect(result.err).toContain("工作目录");
  });

  it("配置文件损坏时给出文件路径和字段提示", async () => {
    const configDir = join(homeDir, ".writing-agent");
    await mkdir(configDir, { recursive: true });
    await writeFile(join(configDir, "config.json"), "{ 坏掉的 JSON", "utf8");

    const result = run([]);
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
    const code = runCli([], {
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
});
