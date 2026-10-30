# 变更：持久化与文件保护闭环

- 日期：2026-10-30
- 状态：已完成（限制见文末）
- 关联需求：[需求](../wiki/01-prd-writing-agent.md) §3.6、§4.6、§4.7
- 关联决策：[0006](../adr/0006-workspace-artifacts-directory.md)、[0009](../adr/0009-versioned-artifact-gate-commit.md)、[0012](../adr/0012-checkpoint-business-shared-transaction.md)
- 阶段方案：[持久化与文件保护闭环](../design/2026-10-30-persistence-file-protection.md)

## 变更目的

把只活在进程里的会话搬进 SQLite：关掉程序再打开，同一篇文章还能接着确认；确认提交要么全写、要么不写；导出覆盖主稿前先看磁盘有没有被外部改过，被改过就不动用户的文件。

## 实际改动

- `src/domain/store.ts`（新增）：存储端口 `WorkflowStore`（整份会话原子保存、按 id 读、按更新时间列）、`PreparedCheckpoint` 与 `CheckpointPort`。
- `src/workflow/service.ts`：业务逻辑与存储解耦，改为 `createWorkflowService({ store })`；新增 `hasSession`、`listSessions`；落盘产物记录 `fileHash`；门禁提交把 checkpoint 交给同一个保存调用。
- `src/workflow/memory-store.ts`（新增）：内存实现，默认给测试与重放用；`createInMemoryWorkflowService` 保留原签名。
- `src/store/schema.ts`（新增）：五张业务表建表语句、表列契约常量、`assertBusinessSchema` / `assertCheckpointSchema`，缺表缺列直接报错。
- `src/store/sqlite-store.ts`（新增）：`openWorkflowDatabase()`（WAL + 建表）与 `createSqliteStore(db)`；一次 `saveSession` 在一个事务里删旧派生行、写会话/版本/门禁/Trace/修订，并可在同事务内 `INSERT OR REPLACE` checkpoint 行。
- `src/domain/types.ts`：`ArtifactVersion` 新增 `fileHash`（磁盘文件指纹，与结构化 `contentHash` 分开）。
- `src/domain/service.ts`：`SaveArtifactInput` 支持 `fileHash`；`CommitDecisionInput` 支持 `checkpoint`；`GraphRunner` 增加 `openSession`、`listSessions`。
- `src/domain/files.ts`、`src/artifacts/files.ts`：`FileWriter.readHash()` 读磁盘当前指纹，文件不存在返回 `null`。
- `src/agent/graph.ts`：可注入 `checkpointer` 与 `checkpoints`；门禁节点改为异步，恢复后先序列化稳定 checkpoint 再提交；终稿门禁与导出节点都做外部编辑检测。
- `src/agent/checkpoints.ts`（新增）：用保存器 `getTuple()` + `serde.dumpsTyped()` 预序列化，写回用同一份格式（ADR 0012）。
- `src/agent/runner.ts`：`openSession(sessionId)` 从 checkpoint 取回未决确认卡；`listSessions()`；会话不存在时抛 `AppError`。
- `src/runtime.ts`（新增）：一个库文件装配业务存储、`SqliteSaver`、服务与运行入口；子类暴露 `setup()` 以便在建表时先执行 PRAGMA。
- `src/cli/replay.ts`、`src/cli/replay-main.ts`：新增 `--db <库文件>` 与 `--mode normal|fast`。
- 测试：`src/store/sqlite-store.test.ts`（8 个）、`src/runtime.test.ts`（3 个）、`src/cli/replay.test.ts` 新增 2 个。

## 验证

- 命令：`npm run typecheck`
  结果：通过，无输出。

- 命令：`npm test`
  结果：`Test Files 14 passed (14)`，`Tests 182 passed (182)`（上一阶段 169 个，新增 13 个）。

- 命令：`npm run replay`
  结果：5 道门禁全部批准 → `exported`；大纲、主稿、导出三份路径一致；Trace 28 条。

- 命令：`npm run replay -- --mode fast`
  结果：只剩「论点确认」「终稿确认」2 道门禁 → `exported`；Trace 16 条。

- 命令：`npm run replay -- --workspace /tmp/wa-db-check --db /tmp/wa-db-check/session.db`
  结果：`exported`。直接查库：`sessions 1`、`artifact_versions 7`、`gates 5`、`trace_events 28`、`revisions 0`、`checkpoints 14`，`sessions.stage = exported`。

- 跨进程恢复（`src/runtime.test.ts`）：第一个运行时 start 到门禁后关闭连接；新连接 `openSession` 取回的确认卡与关闭前 `toEqual` 相等（两个指纹一致），继续批准 5 次到 `exported`，`gates` 5 条，产物里有 `fileHash`，`checkpoints` 行数 > 0。

- 外部编辑（`src/runtime.test.ts`）：主稿被手工改写后提交终稿批准，返回 `failed` 且错误含「已被外部修改」，磁盘文件仍是用户改动后的内容；会话停在 `review`，没有新增终稿门禁记录。还原文件后重新 `openSession` 再批准 → `exported`，导出路径等于主稿路径。

- 原子性（`src/store/sqlite-store.test.ts`）：同一事务里主键冲突导致失败后，原有 `artifact_versions` 行数保持 1、`checkpoints` 行数 0（没有被写入），证明清旧+插新和 checkpoint 行同步回滚。

- 表结构契约（`src/store/sqlite-store.test.ts`）：业务表与 `checkpoints`/`writes` 列名按 `REQUIRED_BUSINESS_COLUMNS` / `REQUIRED_CHECKPOINT_COLUMNS` 断言；人为建一个只有 `id` 的 `sessions` 表时 `assertBusinessSchema` 抛错。

- 命令：`git diff --check`
  结果：无输出（通过）。

## 未完成事项与风险

- **素材快照、证据、研究计划、`profile.db`（作者档案）未入库**：本阶段只落会话主线五张表；`materials/` 快照与档案库仍属 T5 后续和 T9。
- **adopt/discard 对账交互未做**：文件与数据库不一致时目前只有导出前的拦截；T0 E4 验证过的「未登记版本 → 人工 adopt/discard」还需要交互入口（T14）。
- **整份会话重写**：每次提交按 `sessionId` 删旧行再整批插入，单篇文章量级够用；会话变长后需要改增量写入。
- **外部编辑检测只覆盖主稿**：大纲被外部改动、以及重新生成草稿时的检测仍属 T8/T14。
- **未做真实杀进程演练**：跨进程恢复是「关闭连接再新开」；操作系统层面的强杀/断电仍留到 T15。
- **锁未接入启动流程**：真实 `~/.writing-agent/` 建库与单实例锁仍等 T13 交互入口。
- **风险：`SqliteSaver` 表结构耦合**：升级 `@langchain/langgraph-checkpoint-sqlite` 会触发契约测试；若列名变化需按 ADR 0012 重新验证，不能只改测试。
