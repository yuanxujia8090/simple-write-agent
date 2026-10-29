# 阶段方案：最小脚手架、配置层与暂停恢复实验

- 日期：2026-10-29
- 状态：已完成（2026-10-29）
- 关联需求：[写作 Agent MVP 需求](../wiki/01-prd-writing-agent.md) §2.1、§4.4、§4.7、§5.1–5.3、§6
- 关联决策：[0006 工作目录与全局状态目录](../adr/0006-workspace-artifacts-directory.md)、[0007 MVP 边界](../adr/0007-mvp-boundaries-and-quality-gate.md)、[0009 版本化产物与确认原子提交](../adr/0009-versioned-artifact-gate-commit.md)、[0011 先实现、阶段留证、完成后学习](../adr/0011-implementation-first-learning-after.md)
- 执行交接：[实施交接](../plan/2026-10-29-implementation-handoff.md)

## 1. 本阶段目标

1. 交付可安装、可类型检查、可跑测试、能显示帮助的最小 TypeScript 命令行程序（T1）。
2. 实现配置读取与校验、工作目录解析的可测试接口（T2 的可安全验证部分）。
3. 用锁定版本的实际依赖和故障注入，实测“生成与确认分离、重复确认、事务共同提交、文件与数据库边界中断”，据此决定下一阶段持久化怎么写（T0）。
4. 留下阶段方案、必要 ADR、实际改动与验证记录，并同步主计划状态。

## 2. 范围

### 包含

- Node.js + TypeScript 单包脚手架：`package.json`、`tsconfig.json`、Vitest 配置、`src/` 目录、npm 脚本、`--help`。
- 配置层：环境变量 + `~/.writing-agent/config.json` 读取与校验；环境变量覆盖文件；凭据缺失给可读提示。
- 工作目录解析：`--cwd` 优先 → 向上找最近 `.writing-agent/workspace.json` → 当前目录；解析结果含 `workspaceId` 位置；标记文件读写只在临时目录测试。
- 单实例锁策略：接口 + 临时目录行为测试；真实用户目录只在用户真正启动程序时才创建。
- T0 实验：固定结果，不调模型、不联网。

### 不包含

- 首条写作闭环、TUI 界面、模型/搜索调用、完整数据库 schema、备份迁移。
- 在真实 `~/{.writing-agent}` 下创建持久化数据（除用户主动启动程序外）。
- 改写既有产品行为或扩大 MVP 范围。

## 3. 技术方案

### 3.1 工具链（本阶段锁定）

| 用途 | 选择 | 实际锁定版本 | 理由 |
| --- | --- | --- | --- |
| 运行时 | Node.js ESM | 22.22.2（`engines: >=22`） | 单进程，原生 ESM，无打包层 |
| 语言/类型 | TypeScript（`tsc --noEmit` 类型检查） | 7.0.2 | 与决策 D1 一致 |
| 开发运行 | `tsx` | 4.23.15 | 直接跑 `.ts`，开发期不产生产物 |
| 测试 | Vitest | 5.0.5 | 快、内置 TS 支持、无额外断言库 |
| 参数解析 | `node:util` 的 `parseArgs` | 随 Node | 需求参数少，标准库够用，少一个依赖 |
| 配置校验 | `zod` | 4.6.7 | 运行时可读错误信息，后续工具输入校验同款 |
| 编排 | `@langchain/langgraph` | 1.5.3 | 决策 D2 |
| checkpoint 保存器 | `@langchain/langgraph-checkpoint-sqlite` | 1.1.0 | 决策 D5 |
| SQLite 驱动 | `better-sqlite3` | 12.10.0 | 同步事务语义明确，便于验证共同提交 |
| 类型声明 | `@types/node`、`@types/better-sqlite3` | 22.18.11、7.6.13 | 仅开发期 |

### 3.2 目录与模块边界

```text
src/
├── cli/            # 参数解析、--help、启动编排（本阶段只到帮助与环境检查）
├── config/         # 配置读取、环境变量覆盖、校验、可读错误
├── workspace/      # 工作目录解析、标记读写、目录身份
├── lock/           # 单实例锁（接口 + 文件实现，测试只用临时目录）
└── shared/         # 小工具（可读错误类型、路径安全）
experiments/t0/     # 固定结果实验，独立于产品代码，可单独运行
```

解析与校验写成纯函数，把“主目录”“当前目录”“环境变量快照”当参数传入；单元测试不读真实主目录。

### 3.3 配置模型（本阶段最小）

- 文件：`<home>/.writing-agent/config.json`；不存在时用默认值，并标记“首次启动需要引导”。
- 环境变量：`WRITING_AGENT_MODEL_PROVIDER`、`WRITING_AGENT_MODEL_BASE_URL`、`WRITING_AGENT_MODEL_ID`、`WRITING_AGENT_MODEL_API_KEY`、`WRITING_AGENT_SEARCH_PROVIDER`、`WRITING_AGENT_SEARCH_API_KEY`。
- 优先级：环境变量 > 文件 > 默认值；空字符串视为未设置。
- 校验：`baseURL` 必须是合法 http/https；模型标识为空时给“缺少模型配置”的可读提示，不打印密钥。
- 错误信息只说“缺哪个字段、怎么设置”，不回显密钥值。

### 3.4 工作目录解析

```text
--cwd 存在 → 解析为绝对路径（必须存在且是目录）
否则 从 cwd 向上逐层找 .writing-agent/workspace.json
  → 找到 → 以该目录为工作目录，读 workspaceId
  → 找不到 → 当前目录为工作目录，workspaceId 为空（首次建会话时写入）
```

- 标记内容：`{ workspaceId, version, createdAt }`；`workspaceId` 用随机 UUID。
- 标记文件权限 600，目录 700；损坏的标记不静默覆盖，返回可读错误由调用方决定。
- 读取与写入分两个函数；本阶段只提供能力，不在测试里写入真实用户目录。

### 3.5 单实例锁

- 位置：`<home>/.writing-agent/session.db.lock`（全局状态目录，与数据库同目录）。
- 内容：`{ pid, hostname, startedAt, token }`，写入后立刻落盘。
- 获取：文件已存在且持有进程仍活（`process.kill(pid, 0)`）→ 报“另一实例正在运行”；进程已死 → 判定陈旧锁，改写为自己的内容（记录一次日志事件）。
- 释放：正常退出和 `SIGINT` 都走同一 `release()`；释放前校验 `token`，避免误删别人的锁。
- 本阶段只实现并测试临时目录行为，不接入真实启动流程的写盘（启动流程只在用户主动运行时调用）。

### 3.6 T0 实验设计

所有实验用固定结果（写死的候选文本、写死的确认决策），不调用模型和搜索。

| 实验 | 操作 | 预期 |
| --- | --- | --- |
| E1 生成与确认分离 | 阶段节点产出 `temporary` 候选 → `interrupt()` 暂停 → 新进程/新实例读取状态 → 恢复 | 恢复后拿到同一 `artifactId` + 内容指纹；候选未被标记为已确认 |
| E2 重复确认 | 对同一确认决策提交两次 | 第 1 次推进阶段；第 2 次被拒绝（同指纹幂等返回“已处理”），阶段不二次推进 |
| E3 事务共同提交 | `WorkflowStateService` 在**同一个** SQLite 连接/事务里写版本、门禁、阶段、Trace、稳定检查点 | 成功时五者一致；在写门禁后、写阶段前注入异常 → 全回滚，五者仍为提交前状态 |
| E4 文件与数据库边界 | 文件先写临时名再 rename，DB 提交后记录 hash；在 rename 后、DB 提交前注入中断 | 恢复时 DB 无该版本记录 → 文件被识别为“未登记版本”，显式提示对账，不静默采用、不静默覆盖 |
| E5 保存器事务能力 | 检查锁定版本的 `SqliteSaver` 是否接受外部 `better-sqlite3` 连接，或只能自建连接 | 记录实际 API 结论：能共享连接 → 可同一事务；不能 → 记录候选适配方案（自有事务表 + 保存器显式落点） |

每项实验输出：运行命令、预期状态、实际查询结果（SQL 或文件列表）、结论。结论写回本文档第 6 节与变更记录。

### 3.7 失败处理

- 配置损坏：返回可读错误，指出文件路径与字段，不静默重置用户文件。
- 工作目录 `--cwd` 不存在/不是目录：可读错误、退出码 1。
- 锁被占用：提示“另一实例正在运行”，退出码 1。
- 实验注入失败：只使用临时数据库与临时目录，失败后可重复运行。
- 任何会写真实 `~/.writing-agent/` 的行为不在测试里执行。

## 4. 验证方法

| 验证项 | 命令 | 通过标准 |
| --- | --- | --- |
| 类型检查 | `npm run typecheck` | 无错误输出 |
| 单元测试 | `npm test` | 输出明确通过数量，0 失败 |
| 帮助 | `npm run dev -- --help`、构建后 `node dist/cli.js --help` | 退出码 0，包含用法、参数、示例 |
| 配置优先级 | Vitest | 环境变量覆盖文件、缺省、损坏各有用例 |
| 工作目录 | Vitest（临时目录） | 显式路径、向上认领、无标记三种结果 |
| 锁 | Vitest（临时目录） | 占用提示、陈旧锁接管、token 不误删 |
| T0 | `npm run exp:t0` | 每项实验打印预期/实际与结论 |

## 5. 任务拆分与并行安排

| 编号 | 任务 | 产出 | 依赖 |
| --- | --- | --- | --- |
| S1 | 脚手架与命令行帮助 | `package.json`、`tsconfig.json`、`vitest.config.ts`、`src/cli/` | 无 |
| S2 | 配置层 | `src/config/` + 测试 | S1 的工程配置 |
| S3 | 工作目录与锁 | `src/workspace/`、`src/lock/` + 测试 | S1 的工程配置 |
| S4 | T0 实验 | `experiments/t0/` + 结果记录 | S1 依赖安装 |
| S5 | 集成与文档 | 启动接线、阶段结论、变更记录、计划同步 | S1–S4 |

S2、S3、S4 写不同目录，可在 S1 之后并行；共享的 `package.json` 与依赖安装由主执行者一次完成，避免并发写锁文件。

## 6. 实际结果

### 6.1 已交付

| 任务 | 结果 | 证据 |
| --- | --- | --- |
| S1 脚手架 | `npm run typecheck`、`npm test`、`npm run dev -- --help`、`npm run build` + `node dist/cli.js --help` 均可用 | 见变更记录命令输出 |
| S2 配置层 | 文件 + 环境变量 + 默认值三级合并，损坏文件与非法 URL 抛可读错误，凭据缺失给警告且不回显密钥 | 17 个用例 |
| S3 工作目录与锁 | 显式 `--cwd`、向上认领标记、无标记三种解析；标记原子写、权限 600/700；锁含存活进程判断、陈旧锁接管、token 校验释放 | 37 个用例 |
| S4 T0 实验 | E1–E5 全部 PASS，`npm run exp:t0` 可重复运行 | `experiments/t0/README.md` |
| 启动接线 | CLI 打印工作目录、配置与快捷参数概览；不创建目录、不获取锁、不写文件 | `src/cli/main.ts` + 8 个用例 |

### 6.2 T0 实验结论

| 实验 | 实际结果 | 对下一阶段的影响 |
| --- | --- | --- |
| E1 生成与确认分离 | 第一次 `invoke` 停在 `confirmGate`；新连接 + 新 saver 实例恢复后 `artifactId` 与内容指纹完全一致，状态仍为 `temporary`；恢复只重跑门禁节点（节点序列 `generate, confirmGate, confirmGate`） | 生成节点与确认节点必须分开；候选不能因为“被生成”或“被恢复”自动变成已确认 |
| E2 重复确认 | 同一决策提交两次：第一次 `applied`、第二次 `duplicate_confirmation`，阶段版本保持 1，确认事件与确认表各 1 条 | 以 `(artifactId, artifactHash, confirmationHash, decision)` 为唯一键做幂等，重复提交不二次推进 |
| E3 事务共同提交 | 共享同一连接、事务内调用 `saver.put()`：成功时五者都在，但注入异常后业务行回滚、checkpoint 行残留 1 条；改为事务外预序列化 + 事务内直接 `INSERT checkpoints`：成功时五者一致且 `getTuple()` 可读回，异常后全为 0 | 确认提交不能走 `saver.put()`；采用预序列化 + 同事务直写，见 [ADR 0012](../adr/0012-checkpoint-business-shared-transaction.md) |
| E4 文件与数据库边界 | 文件已写、DB 未提交时中断：对账把文件判为“未登记版本”并给出 adopt/discard 提示；重跑结论不变；adopt 后一致且版本仍为 `temporary`；discard 把文件移到 `.discarded` 而不删除；正常路径对账一致 | 主稿先写临时名再 `rename`；正式路径只放完整文件；恢复时对账并要求人工决定，不静默采用或覆盖 |
| E5 保存器能力 | `1.1.0`：`constructor(db: Database, serde?: SerializerProtocol)`，接受外部连接，公开 `saver.db`，但 `put()`/`putWrites()` 均为 `async`，无 `transaction` 方法；`interrupt()` 在任务边界落 checkpoint（暂停时 3 行 checkpoints、16 行 writes） | 依赖版本锁定；T5 需加表结构契约测试，升级保存器必须先重跑 `npm run exp:t0` |

### 6.3 未验证项与限制

- 首次配置引导（写 `config.json`）未实现；当前只读取和校验，`firstRun` 标记留给 T13。
- 全局目录创建（`~/.writing-agent/` 及其权限）只写了策略、未接线；按交接要求，只有用户真正启动会话时才创建。
- 锁未接入启动流程，也未处理跨主机共享文件系统与 `O_EXCL` 竞态；`release()` 的 `SIGINT` 路径属 T11。
- E3 的“预序列化”在实验里直接复用了 `SqliteSaver` 的列结构；生产适配层与表结构契约测试属 T5。
- 根因之一：`better-sqlite3` 事务是同步的，而保存器写接口是异步的。这是库边界事实，不是配置问题，故不做“加大事务范围”之类的绕法。
