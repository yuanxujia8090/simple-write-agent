# Changelog

项目文档与需求的变更记录。每次讨论结论、文档合并、结构调整都记录在此。

---

## 2026-10-29

### 首条写作闭环（固定模型结果）

- 新增领域层：阶段、7 种产物、两类门禁、版本状态、确认决策包、修订指令与阶段契约校验。
- 新增内存工作流服务与 LangGraph 编排图：5 道门禁（素材采纳 + 论点/大纲/事实报告/终稿），确认提交带指纹校验、幂等与失败全量回滚；修改和拒绝按 PRD 回退重做。
- 新增大纲/主稿/导出文件的原子写入与内容指纹；导出终稿替换本会话自己的主稿，不再另存副本。
- 新增 `npm run replay -- --scenario basic|revise|reject`：三条路径都到 `exported`；全量 169 个测试通过。阶段记录见 [首条写作闭环方案](../design/2026-10-29-first-writing-loop.md) 与 [变更记录](2026-10-29-first-writing-loop.md)。
- 主计划 T4/T6/T10/T11/T12/T14/T15 记录实际进度但不勾选（持久化、HTML、交互与快速模式未完成）。

### 启动阶段：脚手架、配置层与暂停恢复实验

- 新增可运行的最小程序：`writing-agent --help`、类型检查、测试、构建；依赖锁定 `@langchain/langgraph@1.5.3`、`@langchain/langgraph-checkpoint-sqlite@1.1.0`、`better-sqlite3@12.10.0`、`typescript@7.0.2`、`vitest@5.0.5`。
- 配置层支持环境变量覆盖 `~/.writing-agent/config.json`，损坏文件与非法 URL 给可读错误；工作目录支持 `--cwd` 优先、向上认领 `.writing-agent` 标记、无标记用当前目录；单实例锁支持存活进程判断、陈旧锁接管与幂等释放。
- T0 实验 E1–E5 全 PASS：确认生成与确认必须分开、重复确认可幂等、`SqliteSaver.put()` 无法参与同步事务、文件与数据库边界需对账。新增 [ADR 0012](../adr/0012-checkpoint-business-shared-transaction.md) 记录共同提交的适配方式；阶段方案与结果见 [2026-10-29 启动与关键机制验证](../design/2026-10-29-bootstrap-checkpoint-experiments.md)，实际改动见 [变更记录](2026-10-29-bootstrap-checkpoint.md)。
- 主计划勾选 T0；T1、T2 记录实际进度但保留未勾选，因为交互界面、首次配置引导、全局目录创建与锁接线尚未实现。

### 开发准备、资料入口与实现后学习

- 用户确认改为“先实现、阶段记录技术方案与决策、实现后回看学习”。新建决策 0011，原 0010 标记为已取代并保留历史。
- 同步 `agents.md`、需求 §1.5、主计划和复盘规则：取消课前讲解、本人复述、答题与学习进度的开发前置和阶段放行要求，保留工程验证及学习进度的独立记录边界。
- 新增 `docs/README.md` 文档导航、`docs/DECISIONS.md` 一般取舍记录、`docs/design/2026-10-29-development-readiness-review.md` 开发准备审查；根 README 链接当前入口，历史研究和原始资料保留。
- 主计划补实际执行阶段：启动与关键机制实验 → 首条写作闭环 → 持久化和文件保护 → 补齐产品能力 → 完整验收 → 实现后学习。保留原 17 项功能任务，新增 T0 暂停重放与提交一致性实验，原 11 项验证仍逐项保留。
- 统一已有目录解析和状态写入约定；修正总设计的素材目录、端口路径、代码围栏和当前需求覆盖说明；保存器接法、模型接口版本等标记为待实测，不把文档草图当实现证据。
- 文档检查与实际范围见 [本次变更详情](2026-10-29-development-readiness.md)。新增 [下一阶段实施交接](../plan/2026-10-29-implementation-handoff.md)，限定脚手架、最小配置与暂停恢复/事务一致性实验的范围和验收。代码、依赖安装、关键机制实验与功能测试待后续实施。

## 2026-10-24

### 开源写作 Agent Top 5 架构分析

- 新增 `docs/design/2026-10-24-open-source-writing-agent-architectures.md`：对 STORM、GPT Researcher、InkOS、Oh Story、Webnovel Writer 做只读源码分析，覆盖整体架构、系统设计、核心流程、亮点、不足、可优化点，并做技术/产品双维度横向对比。
- 判定口径：五项目分属四种编排范式（固定流水线、研究型动态 Agent、自建 Harness、Skill 编排），不按 star 混排。
- 关键结论：长篇项目独立收敛到「权威结构化状态 + Markdown 投影 + 可重建索引」；写作 Agent 的护城河在状态真源、上下文预算、门禁、恢复语义，而非生成文字。
- 对本项目给出 5 条直接吸收建议（上下文分级 fail-closed、产物 revision 校验作完成证据、授权按来源分叉、结构化错误、真源/投影分离），与 ADR 0009 方向一致，未新增或修改 ADR。
- 仅新增文档；未运行这 5 个项目，未修改代码与配置，未运行测试。

## 2026-10-20

### 学习复测与表达规则落地

- `agent-learning/AGENTS.md` 新增第 9–11 条：继续学习开场先复测一题、错题按分数滚动、答题不用自造比喻并用五句话重写。
- `agent-learning/progress/PROGRESS.md` 错题表「复习日期」改为「下次复测 / 稳定度」，补三条到期项和滚动规则。
- `docs/learning/2026-10-19-review-loop.md` 补充与学习侧复测规则的分工：项目侧只检查到期项，不复制答题记录。
- 仅修改文档；未运行代码测试。

## 2026-10-19

### PRD 与实施计划学习目标、生产验证收敛

- 审查 PRD、实施计划、技术设计、ADR 与外部 `agent-learning` 进度；确认产品需求基线仍有效，但学习目标、最小运行闭环和生产验收证据表达不足。
- PRD 增加项目负责人学习目标与设计原则，明确学习目标不是产品功能，不扩大 MVP 范围。
- 实施计划增加最小可验证闭环顺序、当前学习基线、每波学习产出；补齐与 PRD 一致的命令清单。
- 实施计划补充真实模型记录、安全/故障演练、写作样本评测、备份恢复及负责人掌握验证。
- 新增 `docs/design/2026-10-19-prd-plan-learning-review.md` 和 `docs/adr/0010-learning-first-incremental-validation.md`。
- 新增 `docs/learning/2026-10-19-review-loop.md`，定义阶段/每周触发、证据规则、原因分析、行动回看、学习记录边界和提醒能力限制；计划各波增加复盘与回看节点，ADR 0010 纳入长期流程约束。
- 建立项目与 `agent-learning` 双向联动：项目协作规范要求查看学习进度；学习工作区 README/AGENTS 与继续学习、进度记录、复习入口要求读取项目计划和相关复盘，并通过路径互相引用。
- 仅修改文档；代码测试未运行。

## 2026-09-28

### 版本化产物、确认决策与阶段推进协议

- 新增 `docs/adr/0009-versioned-artifact-gate-commit.md`：确认绑定具体产出版本、产物指纹和确认卡指纹；结构校验、门禁、阶段、Trace 与 checkpoint 通过统一入口原子提交。
- 更新技术设计：增加 `StageArtifactContract`、`ConfirmationPackage`、`WorkflowStateService`、研究计划/候选记录、review 内部内容诊断子阶段，以及统一确认失效规则。
- 更新 PRD：确认卡改为 Agent 推荐批准式交互；阶段产物先形成 temporary 版本并通过结构契约；研究候选保留筛选依据；新增版本指纹、事务回滚和 review 修改链验收条件。
- 更新实施计划：增加 D12，并将 T4、T5、T9、T10、T11、T15 的验证范围扩展到结构契约、确认失效、原子提交、研究计划和内容诊断。
- 更新 `CONTEXT.md`：补充 `StageArtifactContract`、`ConfirmationPackage`、`ResearchPlan` 术语。
- 本轮只修改方案文档，未修改代码；未运行代码测试，验证采用文档交叉检查。
- 提交记录：`34177b6`（`docs: 完善版本化产物与确认提交方案`），包含上述 6 个方案文档文件，共 175 行新增、49 行删除。
- 提交前验证：`git diff --check` 通过；提交后已确认 `HEAD` 为 `34177b6`，工作区无待提交改动。

## 2026-09-07

### 技术方案补齐：模型执行、上下文记忆与模块协作契约

- 用户评审反馈三个缺口：模块职责边界模糊（只有职责表、无协作契约）；agent loop / 记忆 / 工具调用的模型层设计缺失；LangGraph 与 AI SDK 协作只有 ADR 结论无落地机制。
- `docs/design/2026-09-05-agent-technical-design.md` 增补：§7.2 端口签名补全（ModelPort/SearchPort/FilePort）；新增 §7.4 状态所有权；新增 §15 模型节点执行模型（maxSteps 工具循环、不引入 ToolNode、预算两层分离、失败降级）；新增 §16 上下文组装与记忆（三层记忆模型、8 层 prompt 组装、截断策略）；新增 §17 LangGraph 与 AI SDK 协作机制（职责划分、协作时序、消息历史持久化）；§14 风险表 +2 行；原 §15 结论重编号为 §18。
- `docs/adr/0001-langgraph-ai-sdk-collaboration.md` 追加“机制细化”小节：工具循环归 AI SDK 驱动、maxSteps 默认 3、消息历史随 checkpoint、节点内不 interrupt、tool calling 失败降级纯文本。
- 变更详情：`docs/changes/2026-09-07-technical-design-completion.md`。

### 技术方案审查 7 项决策落地

- 搜索预算：每轮 ≤ 2 次改为 **3 次**（计数与结果无关），预算为硬约束优先于 maxSteps；同步 PRD / 计划 / ADR 0008 / 设计文档 §15.3、§12.1。
- research 节点降级：无工具可用时暂停 + 用户决策（跳过本轮 / 放弃研究阶段）；设计文档 §15.4。
- 新增节点执行配置表（设计文档 §15.6）：节点 × 模型模式 × 模型可自主调用工具；写盘工具不暴露给模型。
- 新增文件与消息一致性规则（设计文档 §16.4）：文件权威、外部编辑后消息失效、回退时下游消息失效、结构化产物确认后写入消息链。
- 素材超限报错列出未被证据引用的素材清单。

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

## 2026-09-05

### 新增技术设计方案

- 需求确认完成，进入技术设计阶段。
- 新增 `docs/design/2026-09-05-agent-technical-design.md`（专业技术方案：分层架构、GraphRunner + EventPort 运行模型、数据模型、时序、方案对比、扩展性/可观测性/可调试性/性能）。
- 新增 `docs/design/2026-09-05-agent-technical-design-guide.md`（分层解释版，供负责人理解）。
- 状态：评审中，未形成 ADR。

### 技术方案扩充与文档关系澄清

- 明确文档信息流：`PRD（需求）→ 技术方案（设计）→ 计划（执行）`，计划不得自创架构。
- 修正 `docs/plan/00-plan.md` 目标目录：`store/`+`persistence/` → `domain/`+`ports/`+`adapters/`（对齐技术方案 §2.3），并注明"以技术方案为准，不另行自创结构"。
- 扩充 `docs/design/2026-09-05-agent-technical-design.md`：
  - §6 技术选型对比扩至 11 项（新增运行时/编排/模型接入/TUI/校验/测试/构建对比 + 选型汇总表）；
  - 新增 §7 项目结构设计（模块职责、关键类型与接口签名、依赖注入）；
  - 新增 §8 异常与崩溃处理（错误分类体系、处理策略、崩溃恢复）；
  - 新增 §9 进程生命周期与配置安全（启动序列、优雅关闭、凭据安全、日志）；
  - 重排后续章节为 10–15（可观测/可调试/性能/扩展/风险/结论）。

### 补充异常日志与作者风格需求

- 异常/崩溃日志升级为显式需求：PRD 5.2 记录并持久化异常/崩溃日志；技术方案 §9.4 补崩溃前状态快照（`crash.json`）、异常栈+上下文、日志轮转。
- 个人风格需求补全：
  - **B2**：快速模式降级为"个人经验"时禁止虚构用户经历（PRD 3.6.2 规则 2）；
  - **C6**：作者档案不写入导出内容，防个人信息泄漏（PRD 4.6）；
  - **B3**：新增 `/reload` 重载档案/主题/配置，采用"档案版本号 + 动态读取"（实现难度中低，技术方案 §7.2/§9 关联）；
  - **C1**：新增风格文档与 `/style 提炼`（从文字/文档提炼风格候选，确认后写入档案）。
- 同步更新：PRD（2.2 命令表、3.6.1、3.6.2、4.6、5.2、验收 18–19）、计划（T4/T13）、`CONTEXT.md`（StyleDocument、Reload、ProfileSource 扩展）、技术方案 §9.4。

---

_后续变更追加在最新日期下方，不删除历史记录。_

## 2026-11-04

- 真实模型兼容：结构化调用从 `generateObject`（依赖 `response_format`，OpenAI 兼容网关常不支持）改为 `generateText` + JSON Schema 提示 + JSON 提取 + zod 校验，失败重试一次；新增脏输出解析与本地假服务集成测试。[变更记录](2026-11-04-cli-usability-fixes.md)｜[阶段方案](../design/2026-11-04-cli-usability-fixes.md)
- 门禁确认卡：终端下逐道门禁显示推荐/依据/风险/备选/预览，支持批准、修改、拒绝；非终端或 `--yes` 保持自动批准。
- 工作区卫生：`.gitignore` 增加 `.writing-agent/`；删除与 `evidence/` 逐字相同的 `_selftest_2026-11-03/evidence.tgz`。

## 2026-11-03

- CLI 素材→主稿最小路径：`--file` 素材进入既有写作主路径，固定模型可导出 Markdown/HTML。[变更记录](2026-11-03-cli-material-to-draft.md)｜[阶段方案](../design/2026-11-03-cli-material-to-draft.md)
- 多风格本地加载：`--style <id|路径>` 与 `WRITING_AGENT_STYLE` 读本地 `profile.md`/`SKILL.md`；`styles/*` 进 gitignore，风格真源仍只在 Obsidian。[变更记录](2026-11-03-multi-style-loader.md)｜[阶段方案](../design/2026-11-03-multi-style-loader.md)
- 风格指南 3.0 抽检：§5A.7/§5A.8 以人工清单 + example 钩子 + design 声明验收，明确不做自动条款检测。[抽检记录](2026-11-03-style-guide-spotcheck.md)

## 2026-10-30

- 持久化与文件保护闭环：会话/版本/门禁/Trace/修订五表落 SQLite，确认提交与 checkpoint 同事务（ADR 0012 落地），支持跨进程 `openSession` 恢复与快速模式重放；主稿被外部修改时拦下导出。[变更记录](2026-10-30-persistence-file-protection.md)｜[阶段方案](../design/2026-10-30-persistence-file-protection.md)
- 新增阶段方案统一入口：[`docs/design/README.md`](../design/README.md)，按时间倒序索引各阶段方案与变更记录。
- 已交付的阶段交接书移入 `archive/2026-10-29-implementation-handoff.md`，避免继续被当成下一次开工指令。
- 主题配置与确定性 HTML 导出：zod 主题校验与回退、mdast→内联样式渲染器、导出同时产出 `.md` + `.html`、HTML 失败部分成功。[变更记录](2026-10-30-theme-html-export.md)｜[阶段方案](../design/2026-10-30-theme-html-export.md)
- 真实模型适配：`ChatPort` 端口 + AI SDK 适配器 + 7 阶段结构化调用；`WritingModel` 异步化；`.env.local` 配置入口与 `replay --model env`。[变更记录](2026-10-30-model-adapter.md)｜[阶段方案](../design/2026-10-30-model-adapter.md)
