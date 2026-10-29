# T0 关键机制实验

用固定数据、临时目录和注入故障，验证写作 Agent 依赖的 5 个关键机制。实验不调用任何模型、搜索或网络，也不读取真实 `~/.writing-agent`。

## 运行

```bash
npm run exp:t0              # 打印每项实验的 预期 / 实际 / 结论 与最终 PASS/FAIL
npx vitest run experiments/t0   # 把 E1–E5 的核心断言固化为测试
npx tsc --noEmit            # 类型检查
```

- 每项实验失败或抛错时，`run.ts` 会把它记为 FAIL 并设置 `process.exitCode = 1`。
- 所有数据库与工作目录都建在 `mkdtemp(os.tmpdir())` 下，实验结束在 `finally` 里清理。

## 锁定版本

| 依赖 | 版本 |
| --- | --- |
| Node.js | 22（`engines` 要求） |
| `@langchain/langgraph` | 1.5.3 |
| `@langchain/langgraph-checkpoint-sqlite` | 1.1.0（E5 运行时读取，`evidence.saverVersion`） |
| `better-sqlite3` | 12.10.0 |

## 固定数据

| 名称 | 值 |
| --- | --- |
| 候选正文 | `固定候选：跨端状态同步的三个坑` |
| 候选内容指纹 | `sha256:5f43433091281a038e64f59846e1cd0da6b279724b6b1be37e7d2b6394bbd83a` |
| 会话 | `sess-t0` |
| LangGraph thread | `thread-t0` |

## 逐项结果

| 实验 | 预期 | 实测 | 结论 |
| --- | --- | --- | --- |
| E1 生成与确认分离（`e1-interrupt-resume.ts`） | 第一次 `invoke` 停在确认门禁；新开 `Database` 连接与 `SqliteSaver` 实例恢复后拿回同一候选，候选仍为 `temporary` | 停在 `next=["confirmGate"]`；恢复后 `artifactId`、`artifactHash` 与暂停前一致，`status=temporary`、`stage=awaiting_confirmation`、`userDecision=defer`；恢复只重跑门禁节点 | `interrupt()` 能把「生成」和「确认」拆成两次运行；候选不会因为被生成或被恢复而自动升级为已确认 |
| E2 重复确认（`e2-duplicate-confirm.ts`） | 同一决策提交两次，第二次被识别为已处理；阶段只推进一次；trace 只有一条确认事件 | 第一次 `applied`，第二次 `duplicate_confirmation`；`stage_version=1`；确认事件 1 条；`confirmations` 1 行 | 以 `(artifactId, artifactHash, confirmationHash, decision)` 为唯一键可在业务事务内识别重复确认，不二次推进阶段 |
| E3 事务共同提交（`e3-transaction.ts`） | 业务版本/门禁/阶段/trace 与 checkpoint 要么一起提交、要么一起回滚 | 共享同一连接并在 `db.transaction()` 内调用 `saver.put()`：成功时五者都在，但注入抛错后业务行 0、checkpoint 行 1（未回滚）；预序列化后事务内 `INSERT`：成功时五者一致且 `saver.getTuple()` 可读回，抛错后全为 0 | `SqliteSaver` 可复用外部连接，但 `put()`/`putWrites()` 是异步的，**不能**参与 `better-sqlite3` 的同步事务。要满足「同一事务」必须事务外预序列化、事务内用同一连接写 `checkpoints` |
| E4 文件与数据库边界（`e4-file-db-boundary.ts`） | 文件已写、DB 未提交时崩溃后，文件被判为「未登记版本」；重跑不静默采用；人工可选 adopt/discard；正常路径一致 | 崩溃后 `unregistered=1`、`artifact_versions=0`、`artifact_files=0`；重跑结论不变；adopt 后一致且版本仍为 `temporary`；discard 后原路径消失、`.discarded` 备份保留；正常路径 `consistent=2` | 文件写入不受 DB 事务保护，但可用「正式路径只放完整文件 + 对账报告未登记版本 + 人工决定」兜住，不静默采用也不静默覆盖 |
| E5 保存器能力（`e5-saver-capability.ts`） | 记录实际 API：构造参数、外部连接、事务方法、异步写入、`interrupt()` 写入时机 | 见下节 API 表 | 唯一写入口是异步的；`setup()` 内含 `PRAGMA`，必须在事务外先触发；同事务写 checkpoint 需业务侧预序列化 |

### E5 实测 API 表

| 问题 | 实测结果 | 证据 |
| --- | --- | --- |
| 构造参数签名 | `constructor(db: Database, serde?: SerializerProtocol)` | 运行时读取 `dist/index.d.ts` |
| 是否接受外部 `better-sqlite3` 实例 | 是，`new SqliteSaver(db).db === db` | `evidence.acceptsExternalDatabase` |
| 是否有 `fromConnString` | 有（内部自行 `new Database(path)`） | `evidence.fromConnStringExists` |
| 是否暴露底层连接 | 是，公开属性 `saver.db`，可用 `saver.db.transaction()` | `evidence.exposesConnection` |
| `saver` 自身是否有事务方法 | 没有 | `evidence.exposesTransactionMethod === false` |
| `put` / `putWrites` 是否同步 | 否，两者都是 `AsyncFunction` | `evidence.putIsAsync` / `putWritesIsAsync` |
| `interrupt()` 写入时机 | 暂停时已落盘：`checkpoints=3` 行、`writes=16` 行；恢复后 `checkpoints=4` 行 | `evidence.checkpointRowsAtPause` / `checkpointRowsAfterResume` |
| 恢复时的节点重跑 | 节点序列 `["generate","confirmGate","confirmGate"]`：生成节点不重跑，中断节点从头重跑 | `evidence.nodeExecutionLog` |

## 结论对后续实现的影响

1. **暂停/恢复可用**：`StateGraph` + `interrupt()` + `SqliteSaver` 足以支撑「生成候选 → 等待确认」的分段执行，恢复时拿回同一 `temporary` 候选。
2. **确认必须显式落地**：确认结果由恢复入参决定，落在业务事务里（E2 的幂等键），不要依赖图状态自动升级。
3. **checkpoint 不能靠 `put()` 进业务事务**：`put()` 的 INSERT 发生在事务提交/回滚之后的微任务里，崩溃时会残留孤儿 checkpoint。可行写法（候选，未在产品代码中采用）：
   - 事务外 `await saver.serde.dumpsTyped(checkpoint)` / `dumpsTyped(metadata)`；
   - 事务内用同一连接 `INSERT OR REPLACE INTO checkpoints (...)`；
   - 表结构来自 `SqliteSaver.setup()`，升级依赖后必须重跑 E3 复核。
4. **`setup()` 必须预触发**：它执行 `PRAGMA journal_mode=WAL` 和建表，放进事务会报错；共享连接时应先调用一次 `saver.getTuple(...)` 之类的读方法。
5. **文件与 DB 之间需要显式对账**：`.md.tmp → rename` 保证正式路径只有完整文件；崩溃留下的文件在对账时报告为未登记版本，由人工 adopt/discard。

## 未验证项与风险

- **预序列化写入是候选方案**，绕过了 `put()`，依赖 `SqliteSaver` 的 `checkpoints` 表列（`thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata`）；依赖升级后表结构变化会让它静默失效，必须重跑 E3。
- 未验证 `writes` 表（pending writes）如何与业务事务共同提交；E3 只覆盖 `checkpoints` 行。
- 未验证 WAL 模式下多进程/多连接并发提交、进程真崩溃（`SIGKILL`）后的恢复，只做了同进程抛错注入。
- 未验证外部编辑（文件内容指纹与 DB 登记不一致）的对账策略，E4 遇到该情况直接抛错。
- 未验证取消后的迟到结果、LangGraph 版本迁移、checkpoint 体积与清理策略。
- E1/E5 的 `checkpoints`/`writes` 行数是锁定版本的实现细节，不构成产品契约。

## 文件

| 文件 | 作用 |
| --- | --- |
| `run.ts` | 入口，顺序执行 E1–E5 并汇总 PASS/FAIL |
| `shared.ts` | 固定数据、指纹、临时目录、业务表最小 schema、结果与打印 |
| `e1-interrupt-resume.ts` | 暂停恢复实验，并导出可复用的 `buildDraftGraph` |
| `e2-duplicate-confirm.ts` | 重复确认幂等实验 |
| `e3-transaction.ts` | 业务事务与 checkpoint 共同提交实验 |
| `e4-file-db-boundary.ts` | 文件写入与 DB 提交对账实验 |
| `e5-saver-capability.ts` | 保存器能力报告 |
| `t0.test.ts` | 把上述核心断言固化为 Vitest 用例 |
