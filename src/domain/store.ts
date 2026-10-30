/**
 * 存储端口：会话状态的读写边界。业务服务只调这里，不直接接触数据库。
 * `saveSession` 必须是原子的：要么整份会话落库，要么完全不变。
 */
import type { SessionState } from "./types.js";

/**
 * 已序列化的稳定 checkpoint 行。由 checkpoint 保存器在事务外序列化，
 * 事务内直接插入 `checkpoints` 表（见 ADR 0012）。
 */
export type PreparedCheckpoint = {
  threadId: string;
  checkpointNs: string;
  checkpointId: string;
  parentCheckpointId: string | null;
  /** 序列化类型（如 `json`）；checkpoint 与 metadata 必须同类型。 */
  type: string;
  /** 序列化结果：json 为字符串，其他类型为字节数组。 */
  checkpoint: string | Uint8Array;
  metadata: string | Uint8Array;
};

export interface WorkflowStore {
  /** 整份会话落库；同一 `id` 已存在时替换。可附带同事务写入的 checkpoint 行。 */
  saveSession(session: SessionState, checkpoint?: PreparedCheckpoint | null): void;
  loadSession(sessionId: string): SessionState | null;
  /** 按更新时间倒序返回；空库返回空数组。 */
  listSessions(): SessionState[];
}

/** 稳定 checkpoint 的取用口：事务外序列化，事务内写入（ADR 0012）。 */
export interface CheckpointPort {
  prepare(threadId: string): Promise<PreparedCheckpoint | null>;
}
