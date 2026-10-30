/**
 * 持久化运行时装配：一个库文件 → 业务存储 + LangGraph SQLite 保存器 + 工作流服务 + 运行入口。
 * 保存器 `setup()` 必须在任何事务之前执行（内部含 PRAGMA），因此集中在这里。
 */
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";

import { createGraphRunner } from "./agent/runner.js";
import { createSaverCheckpointPort } from "./agent/checkpoints.js";
import { createFileWriter } from "./artifacts/files.js";
import type { FileWriter } from "./domain/files.js";
import type { GraphRunner, WorkflowService } from "./domain/service.js";
import { assertCheckpointSchema } from "./store/schema.js";
import { createSqliteStore, openWorkflowDatabase } from "./store/sqlite-store.js";
import { createWorkflowService } from "./workflow/service.js";

/** `setup()` 是 protected：用子类在装配点显式触发建表与 PRAGMA，而不是等第一次读写。 */
class PreparedSqliteSaver extends SqliteSaver {
  ensureSchema(): void {
    this.setup();
  }
}

export type PersistentRuntime = {
  service: WorkflowService;
  runner: GraphRunner;
  /** 关闭数据库连接；同一进程再次打开同一库时可看到已提交数据。 */
  close(): void;
};

export type PersistentRuntimeOptions = {
  dbPath: string;
  files?: FileWriter;
  createId?: () => string;
  now?: () => string;
};

export function createPersistentRuntime(options: PersistentRuntimeOptions): PersistentRuntime {
  const db = openWorkflowDatabase(options.dbPath);
  try {
    const saver = new PreparedSqliteSaver(db);
    saver.ensureSchema();
    // 保存器的表结构随依赖版本变化；列名不符直接失败，不静默降级（ADR 0012）。
    assertCheckpointSchema(db);

    const service = createWorkflowService({
      store: createSqliteStore(db),
      ...(options.createId === undefined ? {} : { createId: options.createId }),
      ...(options.now === undefined ? {} : { now: options.now }),
    });
    const runner = createGraphRunner({
      service,
      files: options.files ?? createFileWriter(),
      checkpointer: saver,
      checkpoints: createSaverCheckpointPort(saver),
    });

    return { service, runner, close: () => db.close() };
  } catch (error) {
    db.close();
    throw error;
  }
}
