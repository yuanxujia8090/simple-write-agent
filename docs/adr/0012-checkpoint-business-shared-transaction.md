# checkpoint 与业务状态共用一次提交的适配方式

- 状态：accepted
- 日期：2026-10-29

ADR 0009 要求产出版本、门禁、阶段、Trace 与稳定 checkpoint 在同一事务内提交。T0 实验（`experiments/t0`，依赖 `@langchain/langgraph-checkpoint-sqlite@1.1.0`、`better-sqlite3@12.10.0`）证明：`SqliteSaver` 可以复用外部 `better-sqlite3` 连接（`constructor(db: Database, serde?)`，且公开 `saver.db`），但它的唯一写入口 `put()` / `putWrites()` 是 `async`，无法嵌入 `better-sqlite3` 的同步 `db.transaction()`。实测在事务内调用 `put()` 后抛错，业务表回滚、checkpoint 行残留（E3 分支 A）。因此确认提交不能走 `saver.put()`。

## 决策

稳定 checkpoint 的写入由 `WorkflowStateService` 自己完成，不用 `saver.put()` 作为提交路径：

1. 事务外先完成 checkpoint 序列化（用保存器暴露的序列化器，或与之等价的 `Checkpoint` 对象构造）。
2. 在同一个 `better-sqlite3` 事务里，用同一连接写 `artifact_versions`、`gates`、`sessions.stage`、`trace`，并直接 `INSERT OR REPLACE INTO checkpoints (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata)`。
3. 门禁暂停点的 checkpoint 仍由框架 `interrupt()` 自动写入；恢复和读取继续用 `saver.getTuple()` / `list()`，不替换读路径。
4. `checkpoints` / `writes` 表结构由保存器 `setup()` 建立；业务侧只在事务内追加行，不自建同名表、不改列。

实测证据（E3 分支 B）：预序列化 + 同事务 `INSERT` 时，成功路径五者一致且 `saver.getTuple()` 能读回；在写阶段后注入异常时，业务行与 checkpoint 行同时为 0。

## 取舍

- 不把 checkpoint 单独放在另一个库文件：跨库无法同事务，恢复点会与业务状态漂移。
- 不用“先 `put()` 再补业务写入 + 失败补偿”：补偿本身可能失败，且会留下可被读取的中间态。
- 不替换 LangGraph 的 checkpoint 实现：仍用官方保存器的表和读接口，只在写入边界接管。

## 影响

- 依赖锁定 `@langchain/langgraph-checkpoint-sqlite@1.1.0`、`@langchain/langgraph@1.5.3`、`better-sqlite3@12.10.0`；升级任一依赖必须重跑 `npm run exp:t0`（E3/E5 会直接失败暴露表结构或序列化变化）。
- T5 需要加一个表结构契约测试：`checkpoints`/`writes` 的列名与本方案一致，缺列即失败，不静默降级。
- `WorkflowStateService` 需要一个 `serializeCheckpoint()` 适配层，序列化格式以保存器当前版本为准；这部分属于 T5 实现，不在本阶段铺开。
- 本决策只落实 0009 的原子提交方式，不改变“文件是内容权威”和“中断时重做整个阶段”的规则。
