import { afterEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AppError } from "../shared/errors.js";
import { acquireLock, isLockHeld } from "./index.js";

/** 一个几乎不可能被系统分配到的 pid，用来模拟持有进程已退出。 */
const DEAD_PID = 2_147_483_647;

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "writing-agent-lock-"));
  roots.push(root);
  return root;
}

function lockPathOf(root: string): string {
  return join(root, ".writing-agent", "session.db.lock");
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

describe("acquireLock", () => {
  it("写入 pid/hostname/startedAt/token，返回绝对路径", () => {
    const root = makeRoot();
    const lockPath = join(root, ".writing-agent", "session.db.lock");
    const now = new Date("2026-10-29T08:00:00.000Z");

    const handle = acquireLock(lockPath, { hostname: "test-host", token: "token-1", now });

    expect(handle.path).toBe(lockPath);
    expect(handle.token).toBe("token-1");
    expect(existsSync(lockPath)).toBe(true);
    expect(JSON.parse(readFileSync(lockPath, "utf8"))).toEqual({
      pid: process.pid,
      hostname: "test-host",
      startedAt: "2026-10-29T08:00:00.000Z",
      token: "token-1",
    });
    handle.release();
  });

  it("创建锁目录时权限为 0o700", () => {
    const root = makeRoot();
    const lockPath = lockPathOf(root);

    const handle = acquireLock(lockPath);

    if (process.platform !== "win32") {
      expect(statSync(join(root, ".writing-agent")).mode & 0o777).toBe(0o700);
    }
    handle.release();
  });

  it("另一实例持锁（进程存活）时报 LOCK 错误", () => {
    const root = makeRoot();
    const lockPath = lockPathOf(root);
    const first = acquireLock(lockPath, { token: "token-first" });

    const error = captureAppError(() => acquireLock(lockPath, { token: "token-second" }));

    expect(error.code).toBe("LOCK");
    expect(error.message).toBe(`另一实例正在运行（进程 ${process.pid}）`);
    expect(error.hint).toBe("先退出正在运行的 writing-agent，或确认该进程已结束后重试");
    expect(JSON.parse(readFileSync(lockPath, "utf8")).token).toBe("token-first");
    first.release();
  });

  it("持有进程已结束时接管陈旧锁", () => {
    const root = makeRoot();
    const lockPath = lockPathOf(root);
    mkdirSync(join(root, ".writing-agent"), { recursive: true });
    writeFileSync(
      lockPath,
      JSON.stringify({
        pid: DEAD_PID,
        hostname: "old-host",
        startedAt: "2026-10-28T00:00:00.000Z",
        token: "token-old",
      }),
      "utf8",
    );

    const handle = acquireLock(lockPath, { token: "token-new" });

    expect(handle.token).toBe("token-new");
    expect(JSON.parse(readFileSync(lockPath, "utf8"))).toEqual(
      expect.objectContaining({ pid: process.pid, token: "token-new" }),
    );
    handle.release();
  });

  it("锁文件内容损坏时视为陈旧锁并接管", () => {
    const root = makeRoot();
    const lockPath = lockPathOf(root);
    mkdirSync(join(root, ".writing-agent"), { recursive: true });
    writeFileSync(lockPath, "{ not json", "utf8");

    const handle = acquireLock(lockPath, { token: "token-recovered" });

    expect(JSON.parse(readFileSync(lockPath, "utf8")).token).toBe("token-recovered");
    handle.release();
  });

  it("锁文件缺字段时视为陈旧锁并接管", () => {
    const root = makeRoot();
    const lockPath = lockPathOf(root);
    mkdirSync(join(root, ".writing-agent"), { recursive: true });
    writeFileSync(lockPath, JSON.stringify({ pid: DEAD_PID }), "utf8");

    const handle = acquireLock(lockPath, { token: "token-partial" });

    expect(JSON.parse(readFileSync(lockPath, "utf8")).token).toBe("token-partial");
    handle.release();
  });
});

describe("LockHandle.release", () => {
  it("释放后锁文件删除，可重新获取", () => {
    const root = makeRoot();
    const lockPath = lockPathOf(root);
    const first = acquireLock(lockPath, { token: "token-1" });

    first.release();

    expect(existsSync(lockPath)).toBe(false);
    const second = acquireLock(lockPath, { token: "token-2" });
    expect(second.token).toBe("token-2");
    expect(JSON.parse(readFileSync(lockPath, "utf8")).token).toBe("token-2");
    second.release();
  });

  it("token 不匹配时不删除别人的锁", () => {
    const root = makeRoot();
    const lockPath = lockPathOf(root);
    const handle = acquireLock(lockPath, { token: "token-mine" });
    const otherPayload = {
      pid: DEAD_PID,
      hostname: "other-host",
      startedAt: "2026-10-28T00:00:00.000Z",
      token: "token-other",
    };
    writeFileSync(lockPath, JSON.stringify(otherPayload), "utf8");

    handle.release();

    expect(existsSync(lockPath)).toBe(true);
    expect(JSON.parse(readFileSync(lockPath, "utf8"))).toEqual(otherPayload);
  });

  it("释放幂等：重复调用不抛错", () => {
    const root = makeRoot();
    const lockPath = lockPathOf(root);
    const handle = acquireLock(lockPath);

    handle.release();
    expect(() => handle.release()).not.toThrow();
    expect(existsSync(lockPath)).toBe(false);
  });

  it("锁文件已被外部删除时释放不抛错", () => {
    const root = makeRoot();
    const lockPath = lockPathOf(root);
    const handle = acquireLock(lockPath);
    rmSync(lockPath);

    expect(() => handle.release()).not.toThrow();
  });
});

describe("isLockHeld", () => {
  it("没有锁文件时返回 false", () => {
    expect(isLockHeld(lockPathOf(makeRoot()))).toBe(false);
  });

  it("持有进程存活时返回 true", () => {
    const root = makeRoot();
    const lockPath = lockPathOf(root);
    const handle = acquireLock(lockPath);

    expect(isLockHeld(lockPath)).toBe(true);
    handle.release();
  });

  it("持有进程已退出时返回 false", () => {
    const root = makeRoot();
    const lockPath = lockPathOf(root);
    mkdirSync(join(root, ".writing-agent"), { recursive: true });
    writeFileSync(
      lockPath,
      JSON.stringify({
        pid: DEAD_PID,
        hostname: "old-host",
        startedAt: "2026-10-28T00:00:00.000Z",
        token: "token-old",
      }),
      "utf8",
    );

    expect(isLockHeld(lockPath)).toBe(false);
  });

  it("锁文件损坏时返回 false", () => {
    const root = makeRoot();
    const lockPath = lockPathOf(root);
    mkdirSync(join(root, ".writing-agent"), { recursive: true });
    writeFileSync(lockPath, "garbage", "utf8");

    expect(isLockHeld(lockPath)).toBe(false);
  });
});
