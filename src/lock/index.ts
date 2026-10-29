import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { hostname as osHostname } from "node:os";
import { dirname, resolve } from "node:path";

import { AppError } from "../shared/errors.js";

export type LockHandle = {
  path: string;
  token: string;
  release(): void;
};

type LockFile = {
  pid: number;
  hostname: string;
  startedAt: string;
  token: string;
};

const DIR_MODE = 0o700;

/**
 * 获取单实例锁。已有锁且持有进程仍存活时抛 LOCK 错误；
 * 持有进程已退出、锁文件损坏或缺字段都视为陈旧锁并接管。
 */
export function acquireLock(
  lockPath: string,
  options: { pid?: number; hostname?: string; token?: string; now?: Date } = {},
): LockHandle {
  const path = resolve(lockPath);
  const pid = options.pid ?? process.pid;
  const token = options.token ?? randomUUID();

  mkdirSync(dirname(path), { recursive: true, mode: DIR_MODE });

  const existing = readLockFile(path);
  if (existing !== null && isProcessAlive(existing.pid)) {
    throw new AppError(
      "LOCK",
      `另一实例正在运行（进程 ${existing.pid}）`,
      "先退出正在运行的 writing-agent，或确认该进程已结束后重试",
    );
  }

  const payload: LockFile = {
    pid,
    hostname: options.hostname ?? osHostname(),
    startedAt: (options.now ?? new Date()).toISOString(),
    token,
  };
  try {
    writeFileSync(path, JSON.stringify(payload), "utf8");
  } catch (error) {
    throw new AppError(
      "LOCK",
      `无法写入锁文件：${path}（${describeError(error)}）`,
      "检查全局状态目录是否可写后重试",
    );
  }

  let released = false;
  return {
    path,
    token,
    release(): void {
      if (released) {
        return;
      }
      released = true;
      const current = readLockFile(path);
      // token 不同说明锁已被别的实例接管，不能删别人的锁
      if (current === null || current.token !== token) {
        return;
      }
      try {
        unlinkSync(path);
      } catch (error) {
        if (!isNotFound(error)) {
          throw new AppError(
            "LOCK",
            `无法删除锁文件：${path}（${describeError(error)}）`,
            "手动确认并删除该锁文件后重试",
          );
        }
      }
    },
  };
}

/** 仅判断现有锁的持有进程是否存活；没有锁、锁文件损坏或进程已退出都返回 false。 */
export function isLockHeld(lockPath: string): boolean {
  const lockFile = readLockFile(resolve(lockPath));
  return lockFile !== null && isProcessAlive(lockFile.pid);
}

function readLockFile(path: string): LockFile | null {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw new AppError(
      "LOCK",
      `无法读取锁文件：${path}（${describeError(error)}）`,
      "检查该文件权限后重试",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return isLockFile(parsed) ? parsed : null;
}

function isLockFile(value: unknown): value is LockFile {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.pid === "number" &&
    Number.isInteger(record.pid) &&
    record.pid > 0 &&
    typeof record.hostname === "string" &&
    typeof record.startedAt === "string" &&
    typeof record.token === "string" &&
    record.token !== ""
  );
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM 说明进程存在但当前用户无权发信号，仍算存活
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
