# 阶段方案：首条写作闭环（固定模型结果）

- 日期：2026-10-29
- 状态：进行中
- 关联需求：[需求](../wiki/01-prd-writing-agent.md) §3.2–3.7、§4.1、§4.3、§4.6、§4.7
- 关联决策：[0003 两类确认](../adr/0003-confirmation-gate-types.md)、[0005 拒绝回退](../adr/0005-rejection-rollback-parent-stage.md)、[0006 目录与文件权威](../adr/0006-workspace-artifacts-directory.md)、[0009 版本化确认与原子提交](../adr/0009-versioned-artifact-gate-commit.md)、[0012 checkpoint 与业务共同提交](../adr/0012-checkpoint-business-shared-transaction.md)
- 上阶段：[启动与关键机制验证](2026-10-29-bootstrap-checkpoint-experiments.md)

## 1. 目标

用一个可重放命令跑通“本地素材 → 创作简报 → 研究整理 → 论点 → 大纲 → 草稿 → 事实核查 → Markdown 导出”的完整路径，确认阶段产出、两类门禁、版本状态、修订指令和文件落盘之间的衔接正确。模型输出用固定结果，不接真实模型。

## 2. 范围

### 包含

- 领域模型：阶段、产物种类与状态、两类门禁、确认决策包、修订指令、拒绝回退目标、阶段产物契约校验。
- 工作流状态服务：生成临时产物、同一产物的临时版本替换、确认提交（指纹校验 + 幂等 + 原子性）、阶段推进与回退、Trace 事件。
- 编排图：`intake → research → thesis → outline → drafting → review → exported`，门禁用 LangGraph `interrupt()` 暂停。本阶段用内存保存器（`MemorySaver`），不落 SQLite。
- 固定模型适配器：按阶段返回脚本化结果，不联网、不读真实凭据。
- 文件层：大纲 `outlines/<slug>.outline.md`、主稿 `articles/<slug>.md` 的原子写入（临时名 + rename）、sha256 指纹、重复导出不覆盖。
- 重放命令：`npm run replay`，用脚本化决策跑完整路径并打印每步结果。

### 不包含

- TUI 界面、真实模型/搜索、HTML 渲染、SQLite 持久化、进程中断恢复、外部编辑交互卡片、作者档案、想法速记。
- 修改已确认的产品行为；不宣称完整 MVP。

### 已知边界（本阶段用简化实现）

| 事项 | 本阶段做法 | 后续归属 |
| --- | --- | --- |
| 业务状态存储 | 内存实现 `SessionStore`，接口与未来 SQLite 一致 | T5 |
| checkpoint | `MemorySaver`，同一进程内暂停恢复 | T5/T11 |
| 原子性证明 | 内存实现用“深拷贝工作副本 + 失败丢弃”模拟事务，并提供故障注入钩子 | T5 用真实 SQLite 事务替换 |
| 事实核查 | 规则只判“外部事实有无来源”，固定报告 | T9/T10 |
| 确认交互 | 脚本决策（approve / modify / reject） | T13 Ink |

## 3. 数据流

```text
CLI/重放脚本
  → GraphRunner.start({ topic, materials })
  → 图节点逐阶段生成候选（service.saveTemporaryArtifact 校验契约）
  → 到门禁 interrupt 暂停，返回 ConfirmationPackage（含 artifactHash / confirmationHash）
  → 调用方提交 decision
  → WorkflowStateService.commitGateDecision：校验指纹与幂等 → 原子更新产物状态、门禁、阶段、Trace
  → 恢复图，继续下一阶段
  → exported：主稿与大纲文件已在工作目录，打印路径与指纹
```

## 4. 关键规则

1. 节点只能生成 `temporary` 候选，不能写“已确认”或推进阶段；推进只发生在 `commitGateDecision`。
2. 确认绑定 `artifactId + artifactHash + confirmationHash`；任一不匹配即拒绝提交，提示重新生成确认卡。
3. 同一决策重复提交返回 `duplicate_confirmation`，阶段不二次推进。
4. 批准：当前产物转 `draft`，同种类旧 `draft` 转 `rejected`（标记 superseded），阶段推进。
5. 修改：产物转 `rejected`，保存修订指令，阶段回到产出阶段；拒绝：按 PRD 3.7 表格回退。
6. 每次提交在同一个原子操作里更新产物、门禁、阶段和 Trace；失败时全部不生效。
7. 文件先写临时名再 rename；导出遇到同名文件不覆盖，改用 `slug-2`。

## 5. 验证方法

| 验证 | 命令 | 通过标准 |
| --- | --- | --- |
| 类型检查 | `npm run typecheck` | 无错误 |
| 单元测试 | `npm test` | 明确通过数量，0 失败 |
| 契约校验 | Vitest | 每阶段缺字段、候选不足 3 个、大纲空章节被拒 |
| 门禁原子性 | Vitest | 注入失败后产物/门禁/阶段/Trace 全不变；重复确认只推进一次；指纹不符被拒 |
| 回退 | Vitest | 论点/大纲/事实报告/终稿拒绝分别回到规定阶段，成果保留 |
| 文件 | Vitest | 原子写、指纹正确、重名不覆盖、临时文件不残留 |
| 端到端 | `npm run replay` | 正常路径到 `exported`；修改/拒绝路径回退且保留成果 |

## 6. 任务拆分

| 编号 | 任务 | 产出 |
| --- | --- | --- |
| M1 | 领域契约（本文件作者） | `src/domain/` + 测试 |
| M2 | 内存存储与工作流状态服务 | `src/store/`、`src/workflow/` + 测试 |
| M3 | 固定模型与编排图 | `src/agent/` + 测试 |
| M4 | 产物文件与 Markdown 导出 | `src/artifacts/` + 测试 |
| M5 | 重放命令、端到端与文档 | `src/cli/replay.ts`、`experiments/`、变更记录 |

M2、M3、M4 写不同目录，可并行；M5 依赖前三者。

## 7. 实际结果

（完成后回填。）
