# 变更：最小脚手架、配置层与暂停恢复实验

- 日期：2026-10-29
- 状态：已完成（T2 的首次配置引导、全局目录创建、锁接线未做，见未完成事项）
- 关联需求：[写作 Agent MVP 需求](../wiki/01-prd-writing-agent.md) §2.1、§4.4、§4.7、§5.1–5.3
- 关联决策：[0006](../adr/0006-workspace-artifacts-directory.md)、[0009](../adr/0009-versioned-artifact-gate-commit.md)、[0011](../adr/0011-implementation-first-learning-after.md)、新增 [0012 checkpoint 与业务状态共用一次提交](../adr/0012-checkpoint-business-shared-transaction.md)
- 阶段方案：[2026-10-29 启动与关键机制验证](../design/2026-10-29-bootstrap-checkpoint-experiments.md)

## 变更目的

让项目从“只有文档”变成“能装、能类型检查、能跑测试、能显示帮助”的最小命令行程序，同时用固定结果的小实验确定两件会影响后续所有持久化代码的事：暂停恢复的真实边界，以及业务状态和 checkpoint 能否共用一次提交。

## 实际改动

- `package.json`、`package-lock.json`：ESM 单包，脚本 `dev` / `build` / `typecheck` / `test` / `exp:t0`，`bin` 指向 `dist/cli.js`。锁定：`@langchain/langgraph@1.5.3`、`@langchain/langgraph-checkpoint-sqlite@1.1.0`、`better-sqlite3@12.10.0`、`zod@4.6.7`、`typescript@7.0.2`、`vitest@5.0.5`、`tsx@4.23.15`、`@types/node@22.18.11`、`@types/better-sqlite3@7.6.13`。
- `tsconfig.json`、`tsconfig.build.json`、`vitest.config.ts`：`strict` + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess` + `verbatimModuleSyntax`，NodeNext 模块解析；构建输出 `dist/`。
- `src/shared/errors.ts`：`AppError`（`USAGE`/`CONFIG`/`WORKSPACE`/`LOCK`/`RUNTIME`）与退出码约定（0/1/2/130）。
- `src/cli/args.ts`：`node:util` 解析参数；未知参数、位置参数、缺值都转成可读用法错误。
- `src/cli/help.ts`：中文帮助（用法、参数、示例、当前限制）。
- `src/cli/main.ts`、`src/cli.ts`：启动流程为“解析参数 → 配置 → 工作目录 → 打印概览”；不创建目录、不获取锁、不写文件。
- `src/config/index.ts`：环境变量 > `~/.writing-agent/config.json` > 默认值；zod 校验字段类型；非法 JSON / 非法 `baseURL` 抛可读错误；凭据缺失进 `warnings`，密钥值不出现在任何消息里。
- `src/workspace/marker.ts`、`src/workspace/index.ts`：`--cwd` 优先、向上逐层认领 `.writing-agent/workspace.json`、无标记用当前目录；标记原子写（临时文件 + rename），目录 700、文件 600；损坏标记报错不覆盖。
- `src/lock/index.ts`：`{pid, hostname, startedAt, token}` 锁；持有进程存活则提示“另一实例正在运行”；死进程/坏文件视为陈旧锁接管；`release()` 校验 token、幂等。
- `experiments/t0/`：E1–E5 实验 + `README.md`（预期/实际/结论表）+ `t0.test.ts`（5 个断言测试）。
- `docs/adr/0012-checkpoint-business-shared-transaction.md`：新增关键决策。
- `docs/design/2026-10-29-bootstrap-checkpoint-experiments.md`：阶段方案，回填实际结果。
- `.gitignore`：忽略 `.vitest/` 测试缓存。

## 验证

- 命令：`npm run typecheck`
  结果：通过，无输出。

- 命令：`npm test`
  结果：`Test Files 7 passed (7)`，`Tests 74 passed (74)`。
  分布：配置 17、工作目录 23、锁 14、CLI 参数 7、CLI 主流程 8、T0 断言 5（合计 74）。

- 命令：`npm run dev -- --help`
  结果：退出码 0，输出中文用法、`--topic`/`--file`/`--theme`/`--cwd`/`--output-dir`/`--fast`/`--debug`/`--help`/`--version` 与三个示例。

- 命令：`npm run build && node dist/cli.js --help`
  结果：构建成功，`dist/cli.js` 直接运行并返回同样的帮助。

- 命令：`npm run exp:t0`
  结果：`PASS E1`、`PASS E2`、`PASS E3`、`PASS E4`、`PASS E5`，汇总 `5/5 PASS`。关键事实：
  - 恢复后拿回同一 `artifactId` + `artifactHash`，状态仍 `temporary`，恢复只重跑门禁节点。
  - 重复确认第二次返回 `duplicate_confirmation`，阶段版本保持 1。
  - 事务内调用 `saver.put()` 注入异常后：业务行回滚、checkpoint 残留 1 行；预序列化 + 事务内直写：五者一致，异常后全为 0。
  - 文件先写、DB 未提交：对账判为“未登记版本”，需人工 adopt/discard；正常路径一致。

- 命令：`npx vitest run experiments/t0`
  结果：`Tests 5 passed (5)`。

- 命令：`git diff --check`
  结果：无输出（通过）。

- 负向检查（验收要求本身）：测试与 CLI 启动均注入临时 `homeDir`，`runCli` 用例断言临时 home 目录在启动后仍为空（不创建 `.writing-agent/`）。

## 未完成事项与风险

- **T2 未完成部分**：`config.json` 首次启动引导（写入 provider/baseURL/model）、真实创建 `~/.writing-agent/` 目录结构、把锁接入启动流程。这些需要用户主动启动会话才应发生，留到 T13/T5。
- **T1 交互模式未接**：当前无参数启动打印启动检查概览，真正欢迎页属 T13，不把帮助可用当作交互可用。
- **风险：直写 `checkpoints` 表依赖保存器内部结构**。已锁定 1.1.0 并要求升级时重跑 `npm run exp:t0`；T5 需补表结构契约测试。
- **风险：锁有 check-then-write 竞态**，同机两进程同时启动的极小窗口未消除；未做 `fsync`；跨主机共享文件系统可能误判“正在运行”（偏保守，不会误删）。
- 工作目录标记 `markerPath` 只在实际读到标记时非空；`source=flag` 但无标记时返回 `null`，写入路径需调用方重算。
- 未运行：真实模型、真实搜索、TUI 渲染、完整 MVP 闭环（均属后续阶段）。
