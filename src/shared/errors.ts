/**
 * 统一的应用错误：给用户看的可读错误。
 * 不携带密钥；message 可以直接打印。
 */
export type AppErrorCode = "USAGE" | "CONFIG" | "WORKSPACE" | "LOCK" | "RUNTIME";

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly hint: string | undefined;

  constructor(code: AppErrorCode, message: string, hint?: string) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.hint = hint;
  }
}

/** 退出码约定：0 正常、1 配置/用法错误、2 运行时致命错误、130 用户中断。 */
export function exitCodeFor(error: unknown): number {
  if (error instanceof AppError) {
    return error.code === "RUNTIME" ? 2 : 1;
  }
  return 2;
}
