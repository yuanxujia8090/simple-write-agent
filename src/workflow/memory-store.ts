/** 内存存储：测试与重放默认使用；语义与 SQLite 实现一致（读回深拷贝，写入也存深拷贝）。 */
import type { WorkflowStore } from "../domain/store.js";
import type { SessionState } from "../domain/types.js";

export function createMemoryStore(): WorkflowStore {
  const sessions = new Map<string, SessionState>();

  return {
    // 内存实现没有 checkpoint 表；参数只为满足端口，不落库。
    saveSession(session: SessionState): void {
      sessions.set(session.id, structuredClone(session));
    },
    loadSession(sessionId: string): SessionState | null {
      const session = sessions.get(sessionId);
      return session === undefined ? null : structuredClone(session);
    },
    listSessions(): SessionState[] {
      return [...sessions.values()]
        .map((session) => structuredClone(session))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    },
  };
}
