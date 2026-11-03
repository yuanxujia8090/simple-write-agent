import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { AppError } from "../shared/errors.js";
import { pickStyleRef, resolveStyleRef, resolveStyleRoot } from "./resolve.js";

let root: string;

afterEach(() => {
  if (root) {
    rmSync(root, { recursive: true, force: true });
  }
});

function setup(): { homeDir: string; cwd: string } {
  root = mkdtempSync(join(tmpdir(), "writing-agent-style-"));
  const homeDir = join(root, "home");
  const cwd = join(root, "cwd");
  mkdirSync(homeDir, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  return { homeDir, cwd };
}

describe("resolveStyleRoot / resolveStyleRef", () => {
  it("id 解析到 ~/.writing-agent/styles/<id>", () => {
    const ctx = setup();
    const { rootDir, id } = resolveStyleRoot("demo", ctx);
    expect(id).toBe("demo");
    expect(rootDir).toBe(join(ctx.homeDir, ".writing-agent", "styles", "demo"));
  });

  it("读入 profile.md 得到 bodyText", () => {
    const ctx = setup();
    const pack = join(ctx.homeDir, ".writing-agent", "styles", "demo");
    mkdirSync(pack, { recursive: true });
    writeFileSync(join(pack, "profile.md"), "MARKER_STYLE_BODY\n短句优先", "utf8");
    const profile = resolveStyleRef("demo", ctx);
    expect(profile.id).toBe("demo");
    expect(profile.rootDir).toBe(pack);
    expect(profile.entryPath).toBe(join(pack, "profile.md"));
    expect(profile.bodyText).toContain("MARKER_STYLE_BODY");
  });

  it("无 profile.md 时回退 SKILL.md", () => {
    const ctx = setup();
    const pack = join(ctx.cwd, "external-style");
    mkdirSync(pack, { recursive: true });
    writeFileSync(join(pack, "SKILL.md"), "FROM_SKILL", "utf8");
    const profile = resolveStyleRef(pack, ctx);
    expect(profile.bodyText).toBe("FROM_SKILL");
    expect(profile.entryPath).toBe(join(pack, "SKILL.md"));
  });

  it("优先 profile.md 而非 SKILL.md", () => {
    const ctx = setup();
    const pack = join(ctx.cwd, "both");
    mkdirSync(pack, { recursive: true });
    writeFileSync(join(pack, "profile.md"), "PROFILE", "utf8");
    writeFileSync(join(pack, "SKILL.md"), "SKILL", "utf8");
    expect(resolveStyleRef(pack, ctx).bodyText).toBe("PROFILE");
  });

  it("缺包目录时报可读 USAGE 错误", () => {
    const ctx = setup();
    try {
      resolveStyleRef("missing", ctx);
      throw new Error("应当抛错");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("USAGE");
      expect((error as AppError).message).toContain("找不到风格包目录");
      expect((error as AppError).hint).toContain("profile.md");
    }
  });

  it("空目录缺入口时报可读错误", () => {
    const ctx = setup();
    const pack = join(ctx.homeDir, ".writing-agent", "styles", "empty");
    mkdirSync(pack, { recursive: true });
    try {
      resolveStyleRef("empty", ctx);
      throw new Error("应当抛错");
    } catch (error) {
      expect((error as AppError).message).toContain("缺少入口文件");
    }
  });

  it("id 含 .. 被拒绝；带斜杠的引用按路径解析", () => {
    const ctx = setup();
    expect(() => resolveStyleRoot("foo..bar", ctx)).toThrow(AppError);
    const asPath = resolveStyleRoot("./rel-style", ctx);
    expect(asPath.rootDir).toBe(join(ctx.cwd, "rel-style"));
  });
});

describe("pickStyleRef", () => {
  it("CLI 优先于环境变量", () => {
    expect(pickStyleRef("from-cli", "from-env")).toBe("from-cli");
  });

  it("无 CLI 时用环境变量", () => {
    expect(pickStyleRef(undefined, "from-env")).toBe("from-env");
  });

  it("皆缺则为 undefined", () => {
    expect(pickStyleRef(undefined, undefined)).toBeUndefined();
    expect(pickStyleRef("  ", "")).toBeUndefined();
  });
});

describe("创作链路绑定（runner + AI system）", () => {
  it("getRunnerStyleProfile 能读到装配时的风格包", async () => {
    const { createGraphRunner, getRunnerStyleProfile } = await import("../agent/runner.js");
    const { createFileWriter } = await import("../artifacts/files.js");
    const { createInMemoryWorkflowService } = await import("../workflow/service.js");

    const ctx = setup();
    const pack = join(ctx.homeDir, ".writing-agent", "styles", "bound");
    mkdirSync(pack, { recursive: true });
    writeFileSync(join(pack, "profile.md"), "BOUND_STYLE", "utf8");
    const profile = resolveStyleRef("bound", ctx);

    const service = createInMemoryWorkflowService();
    const runner = createGraphRunner({
      service,
      files: createFileWriter(),
      styleProfile: profile,
    });
    expect(getRunnerStyleProfile(runner)?.bodyText).toContain("BOUND_STYLE");
    expect(getRunnerStyleProfile(runner)?.id).toBe("bound");
  });
});
