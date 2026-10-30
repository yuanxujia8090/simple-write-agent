# 阶段方案：持久化与文件保护闭环

- 日期：2026-10-30
- 状态：进行中
- 关联需求：[需求](../wiki/01-prd-writing-agent.md) §3.6、§4.6、§4.7、§5.1–5.3
- 关联决策：[0006](../adr/0006-workspace-artifacts-directory.md)、[0009](../adr/0009-versioned-artifact-gate-commit.md)、[0011](../adr/0011-implementation-first-learning-after.md)、[0012](../adr/0012-checkpoint-business-shared-transaction.md)
- 主计划：[00-plan.md §1.3、§6 T5/T10/T11/T14](../plan/00-plan.md)
- 上一阶段：[首条写作闭环](2026-10-29-first-writing-loop.md)

## 1. 目标

把“只有一次进程生命周期”的内存版变成一个进程关掉还能接着用的版本：同一篇文章可以在新进程里接着确认、拒绝重做，历史版本不丢；导出覆盖主稿前先检查文件有没有被外部改过，被改过就停下来问，不静默覆盖。

## 2. 范围

### 包含

1. **会话持久化**：`sessions`、`artifact_versions`、`gates`、`trace_events`、`revisions` 五张表落 SQLite；一份会话的所有派生行由同一个事务替换写入。
2. **确认提交原子性**：`commitGateDecision` 一次事务内写版本、门禁、阶段、Trace；任一环节注入异常，业务行全部回滚。
3. **checkpoint 共用提交边界**：图用 `SqliteSaver` 复用同一 `better-sqlite3` 连接；门禁提交事务里同时 `INSERT OR REPLACE` 当前稳定 checkpoint 行（ADR 0012 的预序列化 + 事务内直写）。
4. **跨进程恢复**：新进程打开同一库文件，能从 LangGraph checkpoint 里取回未决确认卡（推荐、风险、备选、两个指纹），提交后接着跑到导出。
5. **外部编辑检测**：主稿落盘时记录文件内容指纹；导出覆盖主稿前比对磁盘当前指纹，不一致就报冲突并保留用户改过的文件。
6. **快速模式端到端**：重放支持 `--mode fast`，只保留论点和终稿两道门禁。
7. **存储层契约测试**：表名列名固定，缺列即失败，不静默降级（ADR 0012 要求）。

### 不包含

- 素材快照、证据、研究计划、作者档案库（`profile.db`）——仍属 T5 后续与 T9。
- 真实模型调用、真实搜索、HTML 导出、Ink 界面、内容诊断、`/note`、`/idea`。
- 文件与数据库之间的 adopt/discard 对账交互（T0 E4 已验证方案，交互属 T14）；本阶段只在导出覆盖点拦住冲突。
- 数据库迁移与备份；本阶段建库脚本只在库文件不存在时执行。

### 已知边界（本阶段用简化实现）

- **整份会话重写**：每次提交按 `sessionId` 删掉派生行再整批插入，不做增量 `UPDATE`。理由：一次确认改动跨五张表，整份重写让“要么全有、要么全无”由一条 SQL 事务直接保证；单篇文章的产物量级（数十行）不构成性能问题。代价是将来会话变长时需要改成差异写入。
- **文件是内容权威**：数据库只存版本状态、指纹和阶段，正文仍以磁盘文件为准（ADR 0006）。
- **checkpoint 行是“重申”而非“新造”**：事务内写的是提交前已存在的稳定 checkpoint 行，保证恢复点与业务状态同批可见；不伪造通道值，避免 LangGraph 读到不存在的图状态。

## 3. 数据流

```text
runner.start()
  └─ service.createSession()             → store.saveSession()
  └─ graph.invoke(thread_id=sessionId)   → 每个节点 saveTemporaryArtifact()
                                          → 门禁 interrupt：SqliteSaver 写 checkpoint 行
  └─ 返回 awaiting_confirmation（确认卡来自 interrupt 值）

runner.resume(decision)
  └─ 校验三个指纹
  └─ graph.invoke(Command(resume))        → 门禁节点重跑
       ├─ checkpoints.prepare(thread_id)  → 预序列化稳定 checkpoint（事务外）
       └─ service.commitGateDecision()    → 单事务：版本/门禁/阶段/Trace/修订 + checkpoint 行
  └─ 继续到下一门禁或导出

新进程 runner.openSession(sessionId)
  └─ store.loadSession(sessionId)         → 业务快照
  └─ graph.getState(thread_id)            → 从 checkpoint 取回未决 interrupt 值
```

## 4. 关键规则

- 业务状态只有一个写入者：`WorkflowService`。节点不能直接写 store。
- 事务边界 = 一次 `commitGateDecision`，不接受“写一半再补”。
- 主稿文件哈希单独记录（`fileHash`），与结构化内容指纹（`contentHash`）分开：前者跟磁盘比，后者跟确认卡比。
- 导出覆盖主稿前必须比对磁盘哈希；不一致时抛 `AppError`，消息说明“已被外部修改”，并保留原文件不动。
- 恢复后重新请求确认卡：确认卡内容由产物推导，因此同一产物必得同一 `confirmationHash`，旧卡在产物未变时仍然有效。
- 库文件路径由调用方给（测试用临时目录），不隐式创建 `~/.writing-agent/`。

## 5. 验证方法

- `npm run typecheck`
- `npm test`：新增 schema 契约、SQLite 存储往返、事务回滚注入、跨进程恢复、外部编辑冲突、快速模式重放。
- `npm run replay`、`npm run replay -- --scenario revise|reject`：内存版行为不回退。
- `npm run replay -- --db <临时路径>`：库文件落盘后重新打开能读到同一会话与门禁记录。
- 所有写文件、建库测试使用 `mkdtemp(os.tmpdir())`，不触碰真实用户目录。

## 6. 任务拆分

| 序 | 内容 | 产物 |
| --- | --- | --- |
| 1 | 存储端口与内存实现 | `src/domain/store.ts`、`src/workflow/memory-store.ts` |
| 2 | 业务逻辑与存储解耦 | `src/workflow/service.ts` 改为 `createWorkflowService({ store })` |
| 3 | 建表脚本与契约清单 | `src/store/schema.ts` |
| 4 | SQLite 存储适配器 | `src/store/sqlite-store.ts` |
| 5 | 文件指纹读取与冲突拦截 | `src/domain/files.ts`、`src/artifacts/files.ts`、`src/agent/graph.ts` |
| 6 | 跨进程恢复入口 | `src/agent/runner.ts` 的 `openSession`、`listSessions` |
| 7 | 重放与快速模式 | `src/cli/replay.ts`、`src/cli/replay-main.ts` + `--db`/`--mode` |

## 7. 实际结果

### 7.1 已交付

- 存储端口与两种实现：`src/domain/store.ts`、`src/workflow/memory-store.ts`、`src/store/sqlite-store.ts`。
- 业务逻辑与存储解耦：`createWorkflowService({ store })`；内存版 `createInMemoryWorkflowService` 保持原签名，169 个既有用例零改动通过。
- 五张业务表 + 表列契约：`src/store/schema.ts`；缺表缺列直接抛 `AppError`。
- 确认提交与稳定 checkpoint 同事务：`src/agent/checkpoints.ts` 用保存器 serde 预序列化，`SqliteStore.saveSession` 在同一事务内 `INSERT OR REPLACE`。
- 持久化装配：`src/runtime.ts`（子类暴露 `setup()`，先建表再装服务）。
- 跨进程恢复：`GraphRunner.openSession()` 从 checkpoint 取回未决确认卡；`listSessions()` 按更新时间排序。
- 外部编辑检测：`ArtifactVersion.fileHash` + `FileWriter.readHash()`，终稿门禁前与导出前各校验一次。
- 快速模式端到端：`npm run replay -- --mode fast`；持久化重放：`--db <库文件>`。

### 7.2 实测

- `npm run typecheck`：通过。
- `npm test`：`Test Files 14 passed (14)`、`Tests 182 passed (182)`（上一阶段 169，新增 13）。
- `npm run replay`：5 道门禁 → `exported`，Trace 28 条。
- `npm run replay -- --mode fast`：2 道门禁 → `exported`，Trace 16 条。
- `npm run replay -- --db /tmp/wa-db-check/session.db`：`sessions 1`、`artifact_versions 7`、`gates 5`、`trace_events 28`、`revisions 0`、`checkpoints 14`，`stage = exported`。
- 跨进程恢复与外部编辑拦截的详细断言见 `src/runtime.test.ts` 与变更记录。

### 7.3 与方案的偏差

- **`PreparedCheckpoint` 增加 `parentCheckpointId`**：ADR 0012 的插入语句含该列，方案漏写，实现补上并保持列顺序一致。
- **外部编辑检测前移到终稿门禁**：原方案只在导出前检查，实测发现「批准已提交、阶段变 `exported`、导出才失败」会留下状态与文件不一致。改为门禁前也校验，导出前保留为最后一道防线。
- **checkpoint 语句延迟 prepare**：`checkpoints` 表由保存器 `setup()` 创建，纯业务用例不要求它存在，因此只在真的要写 checkpoint 时才 prepare。

### 7.4 未验证与限制

- 真实杀进程/断电恢复：本阶段是「关连接再新开」。
- adopt/discard 对账交互、大纲外部编辑检测、锁接入启动流程。
- 素材快照、证据、研究计划、作者档案库未入库。
- 整份会话重写（删旧行再整批插入）在会话变长后需要改增量写入。
