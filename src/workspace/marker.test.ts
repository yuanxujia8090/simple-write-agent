import { afterEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AppError } from "../shared/errors.js";
import {
  MARKER_DIR,
  MARKER_FILE,
  createWorkspaceIdentity,
  readMarker,
  writeMarker,
} from "./marker.js";

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "writing-agent-marker-"));
  roots.push(root);
  return root;
}

function markerDirOf(root: string): string {
  return join(root, MARKER_DIR);
}

function markerPathOf(root: string): string {
  return join(root, MARKER_DIR, MARKER_FILE);
}

function writeRawMarker(root: string, content: string): string {
  mkdirSync(markerDirOf(root), { recursive: true });
  const path = markerPathOf(root);
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

describe("createWorkspaceIdentity", () => {
  it("生成 version 1、ISO createdAt 和随机 workspaceId", () => {
    const now = new Date("2026-10-29T08:00:00.000Z");
    const identity = createWorkspaceIdentity({ now });

    expect(identity.version).toBe(1);
    expect(identity.createdAt).toBe("2026-10-29T08:00:00.000Z");
    expect(identity.workspaceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(createWorkspaceIdentity().workspaceId).not.toBe(createWorkspaceIdentity().workspaceId);
  });

  it("传入 id 时使用传入值", () => {
    const identity = createWorkspaceIdentity({ id: "ws-fixed", now: new Date(0) });
    expect(identity.workspaceId).toBe("ws-fixed");
  });
});

describe("writeMarker / readMarker", () => {
  it("写入后能读回同一身份，返回绝对 marker 路径", () => {
    const root = makeRoot();
    const identity = createWorkspaceIdentity({ id: "ws-1", now: new Date("2026-10-29T08:00:00.000Z") });

    const markerPath = writeMarker(root, identity);

    expect(markerPath).toBe(markerPathOf(root));
    expect(readMarker(root)).toEqual(identity);
  });

  it("相对路径写入时返回绝对路径", () => {
    const root = makeRoot();
    const identity = createWorkspaceIdentity({ id: "ws-2" });
    const relativeRoot = join(root, ".");
    const markerPath = writeMarker(relativeRoot, identity);

    expect(markerPath).toBe(markerPathOf(root));
  });

  it("标记目录 0o700、文件 0o600，且不残留临时文件", () => {
    const root = makeRoot();
    writeMarker(root, createWorkspaceIdentity({ id: "ws-3" }));

    if (process.platform !== "win32") {
      expect(statSync(markerDirOf(root)).mode & 0o777).toBe(0o700);
      expect(statSync(markerPathOf(root)).mode & 0o777).toBe(0o600);
    }
    expect(readdirSync(markerDirOf(root))).toEqual([MARKER_FILE]);
  });

  it("重复写入会原子替换为最新身份", () => {
    const root = makeRoot();
    writeMarker(root, createWorkspaceIdentity({ id: "ws-old" }));
    const latest = createWorkspaceIdentity({ id: "ws-new" });

    writeMarker(root, latest);

    expect(readMarker(root)).toEqual(latest);
    expect(readdirSync(markerDirOf(root))).toEqual([MARKER_FILE]);
  });

  it("没有标记文件时返回 null", () => {
    const root = makeRoot();
    expect(readMarker(root)).toBeNull();

    mkdirSync(markerDirOf(root), { recursive: true });
    expect(readMarker(root)).toBeNull();
  });

  it("非 JSON 内容报 WORKSPACE 错误，提示包含路径", () => {
    const root = makeRoot();
    const path = writeRawMarker(root, "{ not json");

    const error = captureAppError(() => readMarker(root));

    expect(error.code).toBe("WORKSPACE");
    expect(error.message).toContain(path);
    expect(error.message).toContain("JSON");
    expect(error.hint).toBeTruthy();
  });

  it("空文件按损坏处理", () => {
    const root = makeRoot();
    writeRawMarker(root, "");

    expect(captureAppError(() => readMarker(root)).code).toBe("WORKSPACE");
  });

  it("缺少字段报 WORKSPACE 错误", () => {
    const root = makeRoot();
    const path = writeRawMarker(root, JSON.stringify({ workspaceId: "ws-x", version: 1 }));

    const error = captureAppError(() => readMarker(root));

    expect(error.code).toBe("WORKSPACE");
    expect(error.message).toContain(path);
    expect(error.message).toContain("createdAt");
  });

  it("version 不是 1 报 WORKSPACE 错误", () => {
    const root = makeRoot();
    const path = writeRawMarker(
      root,
      JSON.stringify({ workspaceId: "ws-x", version: 2, createdAt: "2026-10-29T08:00:00.000Z" }),
    );

    const error = captureAppError(() => readMarker(root));

    expect(error.code).toBe("WORKSPACE");
    expect(error.message).toContain(path);
    expect(error.message).toContain("version");
  });

  it("已有损坏标记时拒绝写入且不覆盖原文件", () => {
    const root = makeRoot();
    const path = writeRawMarker(root, "broken");
    const before = readFileSync(path, "utf8");

    const error = captureAppError(() => writeMarker(root, createWorkspaceIdentity()));

    expect(error.code).toBe("WORKSPACE");
    expect(readFileSync(path, "utf8")).toBe(before);
    expect(existsSync(path)).toBe(true);
  });
});
