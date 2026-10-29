# 变更：首条写作闭环（固定模型结果）

- 日期：2026-10-29
- 状态：已完成（限制见文末）
- 关联需求：[需求](../wiki/01-prd-writing-agent.md) §3.2–3.7、§4.3、§4.6、§4.7
- 关联决策：[0003](../adr/0003-confirmation-gate-types.md)、[0005](../adr/0005-rejection-rollback-parent-stage.md)、[0006](../adr/0006-workspace-artifacts-directory.md)、[0009](../adr/0009-versioned-artifact-gate-commit.md)、[0012](../adr/0012-checkpoint-business-shared-transaction.md)
- 阶段方案：[首条写作闭环（固定模型结果）](../design/2026-10-29-first-writing-loop.md)

## 变更目的

让程序第一次真正“写出一篇文章”：用一条命令从素材跑到 Markdown 导出，并证明阶段产物、两类门禁、版本状态和文件写入之间的衔接；模型输出用固定结果，避免把联网和模型质量混进流程验证。

## 实际改动

- `src/domain/types.ts`：阶段、7 种产物、3 种版本状态、两类门禁、确认记录、Trace 事件、修订指令、会话快照。
- `src/domain/gates.ts`：5 道门禁（素材采纳 + 论点/大纲/事实报告/终稿），普通与快速模式的裁剪和批准/回退目标。
- `src/domain/contracts.ts`：阶段产物契约校验（简报必需字段、论点 3–5 个、大纲章节非空、草稿非空、外部事实无来源必须降级、终稿必须关联事实报告）。
- `src/domain/service.ts`：`WorkflowService` 与 `GraphRunner` 接口、确认包与提交入参、`buildRevision`。
- `src/domain/files.ts`：文件写入端口与 `replacePath`（导出替换本会话主稿）。
- `src/workflow/service.ts`：内存工作流状态服务；确认包指纹、幂等键、失败全量回滚（深拷贝）、快照隔离。
- `src/agent/fixed-model.ts`：固定假数据（约 2200 字草稿、1 条未核实断言与降级改写）。
- `src/agent/graph.ts`：`StateGraph` 12 节点；门禁 `interrupt()`；恢复后 `commitGateDecision`；modify/reject 回退重跑。
- `src/agent/runner.ts`：`start`/`resume`；确认指纹不匹配返回 `failed`，不推进状态。
- `src/artifacts/files.ts`：slug 生成（保留中文）、原子写（临时名 + rename）、同名不覆盖、导出替换主稿。
- `src/cli/replay.ts`、`src/cli/replay-main.ts`：`npm run replay -- [--workspace <目录>] [--scenario basic|revise|reject]`。
- `src/shared/hash.ts`：稳定序列化与 `sha256:` 前缀指纹。
- `src/shared/errors.ts`：新增 `VALIDATION` 错误码。
- `package.json`：新增 `replay` 脚本。

## 验证

- 命令：`npm run typecheck`
  结果：通过，无输出。

- 命令：`npm test`
  结果：`Test Files 12 passed (12)`，`Tests 169 passed (169)`。分布：领域 25、工作流 27、文件 30、编排 9、CLI 参数/主流程 15、重放 4、T0 5、配置 17、工作目录 23、锁 14（其中若干文件合并计数，合计 169）。

- 命令：`npm run replay`
  结果：5 道门禁全部批准 → `exported`；输出大纲、主稿、导出三份路径，导出路径等于主稿路径；Trace 28 条。

- 命令：`npm run replay -- --scenario revise`
  结果：论点门禁「要求修改」→ 重跑后再批准 → 共 6 道门禁 → `exported`；修订指令 1 条；被拒论点保留为 `rejected`。

- 命令：`npm run replay -- --scenario reject`
  结果：终稿「拒绝」→ 回退 drafting → 重新事实核查与终稿确认 → 共 7 道门禁 → `exported`；新旧终稿并存。

- 命令：`npx vitest run src/cli`
  结果：`Tests 19 passed (19)`，含“旧确认卡指纹被拒绝、阶段不推进”用例。

- 命令：`npm run build`
  结果：构建成功。

- 命令：`git diff --check`
  结果：无输出（通过）。

- 临时目录与真实目录隔离：所有重放与文件测试使用 `mkdtemp(os.tmpdir())`，不写真实工作目录；`npm run replay` 默认也写到系统临时目录并打印路径。

## 未完成事项与风险

- **持久化仍是内存**：`createInMemoryWorkflowService` + `MemorySaver`，进程退出即丢。下一步必须按 ADR 0012 落 SQLite，并用 T5 的表结构契约测试锁住 `checkpoints` 列。
- **创作简报没有独立确认卡**：按 PRD 3.2 简报变化需重新确认，当前由固定输入直接生成，属未实现，不当作完成。
- **导出只做 Markdown**：HTML、`--copy`、部分成功重试均未做。
- **外部编辑检测未接入**：文件指纹已记录，但缺“检测到改动后三选一”的交互与门禁失效联动。
- **快速模式没有端到端测试**：只有门禁裁剪与路由的单测。
- **风险：导出替换主稿**依赖“导出目录就是主稿目录”这一条件；指定 `--output-dir` 时仍按不覆盖规则换名，两者语义已在文件中分开。
