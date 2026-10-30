# 开发前阅读入口

- 更新：2026-10-30
- 当前阶段：持久化与文件保护闭环已完成；下一阶段为补齐已确认产品能力（真实模型、搜索、HTML、档案、TUI）。
- 协作顺序：先实现 → 分阶段记录方案、决策与验证 → 实现后回看学习。

## 先读这四处

1. [需求](wiki/01-prd-writing-agent.md)：用户要什么、包含和排除哪些功能、如何验收。开工先读 §1、当前任务涉及的流程节和 §6。
2. [当前决策](#有效决策索引)：已确定的约束，避免用研究建议替换已接受决策。
3. [总体技术方案](design/2026-09-05-agent-technical-design.md)：模块与数据如何协作；状态是“总体方向沿用，暂停恢复与共同提交已实测（见 ADR 0012）”，其余接口仍以实际版本核对。
4. [实施计划](plan/00-plan.md)：§1.3 是实际执行顺序；§6 是功能任务清单；§7–8 是验证与交付要求。

阶段方案统一入口：[阶段方案索引](design/README.md)（按时间倒序列出每个阶段的方案与变更记录）。已完成的三个阶段：[启动与关键机制验证](design/2026-10-29-bootstrap-checkpoint-experiments.md)、[首条写作闭环](design/2026-10-29-first-writing-loop.md)、[持久化与文件保护闭环](design/2026-10-30-persistence-file-protection.md)；对应变更：[启动阶段](changes/2026-10-29-bootstrap-checkpoint.md)、[首条闭环](changes/2026-10-29-first-writing-loop.md)、[持久化](changes/2026-10-30-persistence-file-protection.md)。

开发准备阶段的结论、矛盾及落地时点集中在 [开发准备审查](design/2026-10-29-development-readiness-review.md)。术语不清楚时查根目录 [CONTEXT.md](../CONTEXT.md)。

## 当前结论

- 产品：单人、本地运行的公众号长文写作程序；从话题或文字素材到同源 Markdown/HTML（可编辑主稿及由它生成的网页格式）。
- 技术方向：TypeScript（带类型检查的 JavaScript）、LangGraph.js（管理阶段、暂停和恢复）、Vercel AI SDK（统一模型调用工具库）、Ink（用 React 写终端界面）、SQLite（本地数据库）。具体依赖版本在开工时锁定并验证。
- 内容权威：落盘的大纲和主稿文件；数据库保存版本状态、确认与指纹，不能被历史“结构化状态唯一真源”的研究建议替换。
- 工程要求：普通/快速确认、素材采纳、版本保留、恢复、事实来源、权限与导出规则仍有效。解除学习前置条件不降低软件验证要求。
- 已实测（2026-10-29）：`interrupt()` 能把生成与确认拆成两次运行，恢复拿回同一候选；重复确认可幂等；`SqliteSaver.put()` 是异步的，无法嵌入同步 SQLite 事务，共同提交改为事务外预序列化 + 事务内直写（ADR 0012）。
- 已跑通（2026-10-29，固定结果）：素材 → 简报 → 研究整理 → 论点 → 大纲 → 草稿 → 事实核查 → Markdown 导出，5 道门禁含素材采纳；`npm run replay` 可重放全部批准、论点修改、终稿拒绝三条路径。
- 已持久化（2026-10-30）：会话、产出版本、门禁、Trace、修订落 SQLite；确认提交与稳定 checkpoint 同事务（ADR 0012）；新进程 `openSession` 能拿回未决确认卡并继续到导出；主稿被外部改动时导出被拦下且不覆盖。`npm test` 182 个通过，`npm run replay -- --db <路径>` 可验证落库。
- 下一步：补齐已确认产品能力（真实模型适配、搜索提供方、HTML 导出、作者档案与风格提炼、TUI 与斜杠命令）。详细范围看实施计划 §1.3 与 §6 任务清单。

## 有效决策索引

ADR（Architecture Decision Record，架构决策记录）像项目里的“选择及理由备忘录”；关键取舍单独保存，后续按它实施。

| 决策 | 当前作用 |
| --- | --- |
| [0001：编排与模型调用分工](adr/0001-langgraph-ai-sdk-collaboration.md) | LangGraph 管阶段，AI SDK 只管理节点内有界模型/工具执行；历史接口以实际版本核对 |
| [0002：产出与检查点分离](adr/0002-session-artifact-lifecycle.md) | 保留被拒与采用版本，恢复状态与正文生命周期分开 |
| [0003：两类确认](adr/0003-confirmation-gate-types.md) | 素材采纳与内容批准分开计数 |
| [0004：事实规则边界](adr/0004-fact-checking-boundary.md) | 只校验来源可追溯，不冒充语义真伪验证 |
| [0005：拒绝后的回退](adr/0005-rejection-rollback-parent-stage.md) | 确定回退阶段，保存反馈和成果 |
| [0006：目录与文件权威](adr/0006-workspace-artifacts-directory.md) | 全局状态与文章目录分离，外部修改先确认 |
| [0007：最小可用版本的行为边界](adr/0007-mvp-boundaries-and-quality-gate.md) | 素材、锁、阶段恢复与导出等边界 |
| [0008：预算与交互效率](adr/0008-efficiency-feedback-content-diagnosis.md) | 有界研究、自由反馈、想法速记；内容诊断细节按 0009 与当前需求 |
| [0009：版本化确认与原子提交](adr/0009-versioned-artifact-gate-commit.md) | 确认绑定内容指纹，业务状态与稳定检查点共同提交；具体保存器须实验验证 |
| [0011：先实现、实现后学习](adr/0011-implementation-first-learning-after.md) | 当前工作方式；阶段记录必须，学习证明后置 |
| [0012：checkpoint 与业务状态共同提交](adr/0012-checkpoint-business-shared-transaction.md) | 确认提交不用 `saver.put()`，改为事务外预序列化 + 同事务直写 checkpoint |

[0010：学习证明纳入阶段验收](adr/0010-learning-first-incremental-validation.md) 已被 0011 取代，保留历史，不再作为开发前置条件或软件阶段放行条件。

## 其余资料怎么用

| 资料 | 定位与阅读时机 |
| --- | --- |
| [技术方案通俗版](design/2026-09-05-agent-technical-design-guide.md) | 实现后帮助理解总体方案；不是另一套实现约束 |
| [2026-10-19 需求/计划审查](design/2026-10-19-prd-plan-learning-review.md) | 历史背景；其学习放行要求已由 0011 调整 |
| [2026-10-24 开源架构研究](design/2026-10-24-open-source-writing-agent-architectures.md) | 候选借鉴，不等于批准；文件内容权威仍按 0006/0009 |
| [2026-10-28 架构检查](learning/2026-10-28-agent-architecture-review.md) | 学习材料与风险来源；哪些进入当前计划看开发准备审查 |
| [交互架构学习手册](learning/2026-10-28-agent-architecture-guide.html) | 实现后回看架构与案例，不是写作程序已实现的证明 |
| [记录与复盘规则](learning/2026-10-19-review-loop.md) | 实施时留证，完成后学习；学习进度仍只记外部学习工作区 |
| [变更时间线](changes/02-changelog.md) / [整理取舍](DECISIONS.md) | 查何时改了什么、为什么这样整理；关键决策正文只在 ADR |
| `archive/` | 历史资料与主题样例；按需求引用，不自动升级为当前规范。含已交付的阶段交接书 [2026-10-29 执行交接](../archive/2026-10-29-implementation-handoff.md) |

## 每个实施阶段留下什么

- **开工前**：在已有 `docs/design/` 下写 `YYYY-MM-DD-<topic>.md`，记录目标、范围、输入输出、责任边界、失败处理和验收方法。
- **阶段内**：关键选择写 `docs/adr/NNNN-<topic>.md`，说明选择、原因、影响和替代方案；原决定被取代时保留历史并链接新决定。
- **结束时**：按 `agents.md` 在 `docs/changes/YYYY-MM-DD-<topic>.md` 记录实际改动、命令与结果、限制和方案偏差，再同步主计划。待学问题附实际代码或运行证据路径。
- **实现后**：负责人以这些材料反向学习；本人答题和掌握状态只记录在学习工作区，不用自动生成说明代替学习证据。

这次采用“统一入口、分清资料用途、保留历史”的整理方式。原始需求与方案不搬移、不删除，不额外维护一份会漂移的需求摘要。
