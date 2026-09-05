# Changelog

项目文档与需求的变更记录。每次讨论结论、文档合并、结构调整都记录在此。

---

## 2026-09-02

### 新增作者档案（WriterProfile）需求

- 用户确认新增跨会话作者档案需求：记录语言风格、身份背景、内容偏好和写作禁忌，并在后续创作中影响作品。
- MVP 只做手动维护：`/profile` 命令查看/编辑，档案存应用内部 SQLite，不放在全局目录。
- 从审查反馈自动识别偏好（类似 Hermes agent memory）暂不实现，在 PRD 第 8 节标记为待评估 feature。
- 同步更新：PRD（核心对象/交互命令/验收/后续事项）、`CONTEXT.md`（作者档案术语组）、计划（T4/T5/T13）。

### 明确文档结果约束

- `agents.md` 明确根目录允许保留 `CONTEXT.md` 领域术语表。
- 区分 `docs/changes/02-changelog.md` 的项目级时间线摘要与日期命名的具体变更详情。
- 明确 `docs/changes/02-changelog.md` 固定文件名，以及 `docs/wiki/`、`docs/changes/`、`docs/adr/` 各自独立维护序号。
- 验证和交付说明优先描述当前目录、实际路径和有效文件，避免将负向检查作为主要结果。

### PRD 与实施计划结构化整理

- `docs/wiki/01-prd-writing-agent.md` 重构为 MVP 需求基线，按产品目标、入口、流程、数据规则、非功能需求和验收标准组织。
- 已确认的讨论答案转化为可执行产品规则，不再以多轮提问草稿形式呈现。
- `docs/plan/00-plan.md` 根据 PRD 重写实施任务，补齐交互入口、LangGraph 门禁与恢复、素材/证据、主题、渲染、导出和验证要求。
- 保留现有架构决策和领域术语文档，并修正计划、PRD、ADR 之间的路径引用。

### 文档合并：三份方案合为一份

- `PLAN.draft.md`（决策记录）→ 内容合并入 `PLAN.md`，文件删除
- `plans-writing-agent-architecture.md`（架构分析）→ 内容合并入 `PLAN.md`，文件删除
- `PLAN.md`（最终工作计划）→ 移入 `docs/plan/00-plan.md`
- 根目录只保留 `agents.md` + `docs/`

### D2 决策更新：手写 ReAct → LangGraph.js

- D2 从「手写最小 ReAct 循环」改为「LangGraph.js StateGraph」
- Must-NOT-Have 删除「不引入 LangGraph 等重型编排框架」
- Todo 8 重写为 LangGraph 编排实现
- 相关引用（Scope、Execution strategy、组件表、依赖方向）同步更新

### 创建 PRD 与整理已确认需求

- PRD 状态从“初稿，待讨论”更新为“已确认，MVP 需求基线”。
- 统一入口确定为 `writing-agent`，启动后直接进入 TUI/CLI；不要求 `run` 子命令。
- 输入确定为话题、`.txt`/`.md` 文字素材或中断会话；热点模块不进入 MVP。
- 输出确定为 Markdown 主稿和由 Markdown 确定性生成的内联样式 HTML，默认不输出来源。
- 确认门禁、素材/证据边界、产出版本生命周期、主题 JSON 和错误恢复规则完成收敛。

### 架构决策与领域术语

- 新建 `docs/adr/0001-langgraph-ai-sdk-collaboration.md`：LangGraph 编排，Vercel AI SDK 在模型节点内负责模型调用和流式输出。
- 新建 `docs/adr/0002-session-artifact-lifecycle.md`：Checkpoint 与 ArtifactVersion 分离，支持拒绝保留和临时成果替换。
- 新建根目录 `CONTEXT.md`：记录 WritingSession、CreativeBrief、Material、Evidence、ArtifactVersion 等领域术语。
- 将 ADR 目录统一为 `docs/adr/`，不再使用 `docs/decisions/`。

### 计划同步

- `docs/plan/00-plan.md` 同步更新为最终入口、阶段、工具权限和 LangGraph 编排要求。

### 目录约定

- `docs/wiki/` 仅存放需求文档。
- `docs/changes/02-changelog.md` 持续记录项目级文档、决策和结构变更。
- `docs/adr/` 存放架构决策记录。

### 验证表述约定

- 验证结果优先描述当前状态，例如“当前 Changelog 位于 `docs/changes/02-changelog.md`”，而不是“`docs/wiki/02-changelog.md` 已不存在”。
- 只有当“不存在/未发现”本身是明确验收条件时，才使用负向表述；否则列出实际目录和有效文件作为证据。

---

## 2026-09-04

### 需求审查后的 PRD 修订

基于对 `docs/wiki/01-prd-writing-agent.md` 的产品审查，落实 P0–P2 共 12 项建议，核心变更：

- **确认门禁分类**：拆分为采纳门禁（AdoptionGate）与内容门禁（ApprovalGate），解决"素材整批确认"与"4 个确认点"的语义冲突；用户显式 `/read` 直接入素材池。→ `docs/adr/0003-confirmation-gate-types.md`
- **事实核查边界**：规则层只验证可追溯性，判定缺来源/来源不可验证/硬事实占比异常三类争议信号；快速模式改写遵守"只降级、不新增"，降级清单带原因代码。→ `docs/adr/0004-fact-checking-boundary.md`
- **拒绝最小回退**：被拒产物回退到父阶段（论点→thesis、大纲→outline、事实报告→research、终稿→drafting），修订指令作为下一轮输入约束。→ `docs/adr/0005-rejection-rollback-parent-stage.md`
- **需求补全**：固定问题访谈最小问题集、idle 欢迎页与裸启动路径、`/export --copy`、进度提示与 `Ctrl+C` 保存退出、质量遥测三指标、主题 `version` 只接受 1、搜索失败类型区分。
- 同步更新 `docs/plan/00-plan.md` 任务 T3–T14 与验证门禁、`CONTEXT.md` 术语表。

### 新增工作目录与全局状态目录模型

- 明确"工作目录（Workspace）"概念：默认 = 启动当前目录，`--cwd <path>` 可覆盖，是文件产物（主稿 Markdown + HTML）的唯一落盘位置；
- 全局状态目录 `~/.writing-agent/`（config.json、profile.db、session.db、materials/<sessionId>/）与工作目录解耦；确认纳入的素材复制为快照；
- 工作目录通过 `.writing-agent/workspace.json` 轻量标记识别：首次创建会话时写入，启动时从当前目录向上回溯认领（在 `articles/` 或子目录启动也能认领回原工作目录）；
- 欢迎页按解析出的工作目录匹配未完成会话并提示恢复；`/list` 面向全局单库；
- 大纲与草稿主稿落盘为文件，文件是内容权威、DB 存版本状态与 mtime/hash 指纹；Agent 在读取/重写前执行外部编辑检测，检测到改动则停下询问用户（确认采用 / 重新生成 / 忽略改动），不静默采用、不静默覆盖。
- 同步更新：PRD（2.1 启动命令、3.3 素材归属、3.4 大纲落盘、3.5 草稿外部编辑、3.6 重新核查、4.6 导出、新增 4.7、5.1、验收 13/14）、计划（D11、5.4、T2/T4/T5/T8/T10/T11/T12/T13/T14/T15/V4/交付标准）、`CONTEXT.md`（新增"运行与存储"组）。
- 新增 `docs/adr/0006-workspace-artifacts-directory.md`，并入工作目录标识、向上回溯与外部编辑检测细化。

### 补充 MVP 行为边界（ADR 0007）

- Checkpoint 粒度 = 阶段原子；质量判断 = 结构门槛 + 交给人（`maxRounds` 默认 2）；素材边界 = `--file` 可重复、单文件 ≤ 1MB、UTF-8；slug 保留中文；SearchProvider 接入 Tavily（mock 可验收）；单进程 + `session.db` 锁检测；快速模式待验证素材自动进降级改写清单。
- 默认采纳：会话命名、默认主题、mdast 子集、首次配置引导、错误分级。
- 同步更新：PRD（2.3/3.3/3.6.2/4.4/4.5/4.6/5.1/5.2/5.3）、计划（T2/T3/T5/T8/T9/T10/T12/T13/T14/V4）、`CONTEXT.md`。
- 新增 `docs/adr/0007-mvp-boundaries-and-quality-gate.md`。

### 补充效率、反馈与内容诊断（ADR 0008）

- 研究预算：普通 2 轮、快速 1 轮，每轮搜索 ≤ 2 次，防过度研究；
- 到稿交互数指标（草稿前 2–3 次确认）纳入 Trace 质量指标；
- 内容诊断（软性）：review 阶段附加文字洁癖/表达效率/认知落差三维度，参考 dbs-content 但不绑定其价值观；
- 会话内自由反馈 `/note`、跨会话想法速记 `/idea`（记录/搜索/基于想法写作，全局 `ideas` 表）。
- 同步更新：PRD（2.2 命令表、新增 2.4、3.3 研究预算、新增 3.6.3、4.1 核心对象、5.4 指标、验收 15–17）、计划（5.5、T5/T6/T9/T10/T13/T15/V4）、`CONTEXT.md`。
- 新增 `docs/adr/0008-efficiency-feedback-content-diagnosis.md`。

---

_后续变更追加在最新日期下方，不删除历史记录。_
