import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { AppError } from "../shared/errors.js";
import { resolveWorkspace } from "./index.js";
import { MARKER_DIR, MARKER_FILE, createWorkspaceIdentity, writeMarker } from "./marker.js";

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "writing-agent-workspace-"));
  roots.push(root);
  return root;
}

function writeRawMarker(root: string, content: string): string {
  mkdirSync(join(root, MARKER_DIR), { recursive: true });
  const path = join(root, MARKER_DIR, MARKER_FILE);
  writeFileSync(path, content, "utf8");
  return path;
}

function captureAppError(fn: () => unknown): AppError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return error as AppError;
  }
  throw new Error("预期抛出 AppError，但函数正常返回");
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("resolveWorkspace：显式 --cwd", () => {
  it("绝对路径作为工作目录，source 为 flag", () => {
    const root = makeRoot();
    const target = join(root, "articles");
    mkdirSync(target);

    const workspace = resolveWorkspace({ cwd: root, explicitCwd: target });

    expect(workspace).toEqual({
      root: target,
      source: "flag",
      identity: null,
      markerPath: null,
    });
  });

  it("相对路径按 cwd 解析成绝对路径", () => {
    const root = makeRoot();
    const target = join(root, "articles");
    mkdirSync(target);

    const workspace = resolveWorkspace({ cwd: root, explicitCwd: "articles" });

    expect(workspace.root).toBe(target);
    expect(workspace.source).toBe("flag");
  });

  it("cwd 末尾带分隔符时仍解析成规范绝对路径", () => {
    const root = makeRoot();
    const target = join(root, "articles");
    mkdirSync(target);

    const workspace = resolveWorkspace({ cwd: target + "/" });

    expect(workspace.root).toBe(resolve(target));
  });

  it("读取显式目录自身的标记", () => {
    const root = makeRoot();
    const target = join(root, "project");
    mkdirSync(target);
    const identity = createWorkspaceIdentity({ id: "ws-flag" });
    writeMarker(target, identity);

    const workspace = resolveWorkspace({ cwd: root, explicitCwd: target });

    expect(workspace.source).toBe("flag");
    expect(workspace.identity).toEqual(identity);
    expect(workspace.markerPath).toBe(join(target, MARKER_DIR, MARKER_FILE));
  });

  it("有显式目录时不再向上查找父目录标记", () => {
    const root = makeRoot();
    writeMarker(root, createWorkspaceIdentity({ id: "ws-parent" }));
    const nested = join(root, "articles");
    mkdirSync(nested);

    const workspace = resolveWorkspace({ cwd: nested, explicitCwd: nested });

    expect(workspace.root).toBe(nested);
    expect(workspace.source).toBe("flag");
    expect(workspace.identity).toBeNull();
  });

  it("路径不存在时报 WORKSPACE 错误并给出提示", () => {
    const root = makeRoot();
    const missing = join(root, "missing");

    const error = captureAppError(() => resolveWorkspace({ cwd: root, explicitCwd: missing }));

    expect(error.code).toBe("WORKSPACE");
    expect(error.message).toContain(missing);
    expect(error.hint).toBeTruthy();
  });

  it("路径是文件而不是目录时报 WORKSPACE 错误", () => {
    const root = makeRoot();
    const file = join(root, "notes.md");
    writeFileSync(file, "x", "utf8");

    const error = captureAppError(() => resolveWorkspace({ cwd: root, explicitCwd: file }));

    expect(error.code).toBe("WORKSPACE");
    expect(error.message).toContain(file);
    expect(error.hint).toBeTruthy();
  });
});

describe("resolveWorkspace：向上查找标记", () => {
  it("在子目录启动时认领最近的标记目录", () => {
    const root = makeRoot();
    const identity = createWorkspaceIdentity({ id: "ws-claim" });
    writeMarker(root, identity);
    const nested = join(root, "articles", "deep");
    mkdirSync(nested, { recursive: true });

    const workspace = resolveWorkspace({ cwd: nested });

    expect(workspace.root).toBe(root);
    expect(workspace.source).toBe("marker");
    expect(workspace.identity).toEqual(identity);
    expect(workspace.markerPath).toBe(join(root, MARKER_DIR, MARKER_FILE));
  });

  it("就近认领，内层标记优先", () => {
    const root = makeRoot();
    writeMarker(root, createWorkspaceIdentity({ id: "ws-outer" }));
    const inner = join(root, "inner");
    mkdirSync(inner);
    const innerIdentity = createWorkspaceIdentity({ id: "ws-inner" });
    writeMarker(inner, innerIdentity);
    const nested = join(inner, "articles");
    mkdirSync(nested);

    const workspace = resolveWorkspace({ cwd: nested });

    expect(workspace.root).toBe(inner);
    expect(workspace.identity).toEqual(innerIdentity);
  });

  it("向上都没有标记时使用当前目录", () => {
    const root = makeRoot();
    const nested = join(root, "articles");
    mkdirSync(nested);

    const workspace = resolveWorkspace({ cwd: nested });

    expect(workspace).toEqual({
      root: nested,
      source: "cwd",
      identity: null,
      markerPath: null,
    });
  });

  it("损坏标记不静默忽略，报 WORKSPACE 错误", () => {
    const root = makeRoot();
    const path = writeRawMarker(root, JSON.stringify({ workspaceId: "ws-x" }));
    const nested = join(root, "articles");
    mkdirSync(nested);

    const error = captureAppError(() => resolveWorkspace({ cwd: nested }));

    expect(error.code).toBe("WORKSPACE");
    expect(error.message).toContain(path);
    expect(error.hint).toBeTruthy();
    expect(error.message).not.toContain("ws-x");
  });
});
