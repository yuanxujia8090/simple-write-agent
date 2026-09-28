# tui-writing-agent-ts 实施计划

## 1. 计划摘要

构建一个全 TypeScript/JavaScript 单进程的本地写作 Agent。用户输入话题、`.txt`/`.md` 文字素材，或恢复中断会话后，进入交互式 TUI/CLI（终端界面），完成公众号长文的输入检查、研究、论点、大纲、草稿、审查和导出。

核心产品规则来自 `docs/wiki/01-prd-writing-agent.md`：

- 可执行命令是 `writing-agent`，启动后直接进入交互模式，不使用 `run` 子命令；
- LangGraph.js 负责流程状态、阶段路由、人工暂停、恢复、回退和 checkpoint；
- Vercel AI SDK 在 LangGraph 模型节点内部负责模型调用、工具接口和流式输出；
- Markdown 是主稿，HTML 根据同一份 Markdown 确定性生成；
- 普通模式 4 个确认点，快速模式 `--fast` 保留论点和终稿确认；
- `Checkpoint` 与 `ArtifactVersion` 分开建模，用户拒绝或重做不丢失成果。

## 2. 已确认决策

| ID | 决策 | 实施要求 |
|---|---|---|
| D1 | 全 TypeScript/JavaScript 单进程 | Node.js + TypeScript；TUI、编排、工具、存储在同一应用中 |
| D2 | LangGraph.js 编排 | 使用 `@langchain/langgraph` 的 `StateGraph` 和 `interrupt/resume`；不使用 Mastra 或另一套 Agent Loop |
| D3 | 交互式 TUI/CLI | `writing-agent` 直接启动；内部使用斜杠命令 |
| D4 | Vercel AI SDK 集成 | 模型节点通过 Vercel AI SDK 调用模型和工具，并向 TUI 输出流式事件 |
| D5 | SQLite 持久化 | 保存会话、checkpoint、trace、素材、证据和产出版本 |
| D6 | Markdown 主稿 + 确定性 HTML | HTML 按 Markdown 节点生成内联样式；不让模型单独生成 HTML |
| D7 | TDD（Test-Driven Development，测试驱动开发） | 非平凡逻辑先写失败测试，再实现；成功和失败路径都要有证据 |
| D8 | 确认门禁分为采纳/内容两类 | AdoptionGate 管输入采纳，ApprovalGate 管内容批准；见 `docs/adr/0003-confirmation-gate-types.md` |
| D9 | 规则层只验证可追溯性 | 事实核查规则层判定缺来源/来源不可验证/硬事实占比异常三类争议信号；见 `docs/adr/0004-fact-checking-boundary.md` |
| D10 | 拒绝最小回退到父阶段 | 被拒产物回退到其产生阶段，修订指令作为下一轮输入；见 `docs/adr/0005-rejection-rollback-parent-stage.md` |
| D11 | 工作目录 + 全局状态目录 | 工作目录默认当前目录、`--cwd` 覆盖；状态统一存 `~/.writing-agent/`（session.db/profile.db/materials）；文件产物落工作目录 `articles/`；见 `docs/adr/0006-workspace-artifacts-directory.md` |
| D12 | 版本化产物与确认原子提交 | 每个可流转阶段先生成 temporary 产物并通过结构契约；确认绑定 `artifactHash` 与 `confirmationHash`；版本、门禁、阶段、Trace、checkpoint 在一个事务内提交；见 `docs/adr/0009-versioned-artifact-gate-commit.md` |

## 3. 范围

### 3.1 MVP 包含

- 交互式启动和斜杠命令：`/new`、`/list`、`/resume`、`/search`、`/read`、`/export`、`/help`、`/exit`；
- 快捷参数：`--topic`、`--file`、`--theme`、`--cwd`、`--output-dir`、`--fast`；
- 输入 `.txt`、`.md`、话题和已有会话；
- `intake` 信息检查和固定问题访谈子流程；
- 创作简报、研究、论点候选、大纲、Markdown 草稿、事实核查和导出；
- 普通模式和快速模式确认门禁；
- 全局主题 JSON 读取、校验和默认值补全；
- Markdown 与公众号内联样式 HTML 导出；
- 会话恢复、成果版本、Trace（执行记录）回放；
- 一个可插拔 `SearchProvider`（搜索提供方）接口和一个 MVP 第三方实现。

### 3.2 MVP 不包含

热点筛选、小红书等其他平台、PDF 输入、主题可视化编辑器、主题导入/导出命令、向量数据库、自动发布、账号系统、多租户、会话删除、复杂搜索优化和直接复制外部 Agent 代码。

## 4. 目标目录与依赖边界

```text
src/
├── cli/             # 启动、斜杠命令、参数和退出处理
├── tui/             # Ink 界面、确认卡、会话列表、预览、/note /idea
├── agent/           # LangGraph 图、节点、GraphRunner、门禁 interrupt 封装
├── domain/          # 纯类型与规则：阶段、门禁、产出版本、事实规则、目录模型、研究预算
├── ports/           # 能力接口：ModelPort/SearchPort/StorePort/CheckpointPort/FilePort/EventPort
├── adapters/        # 模型(AI SDK)、搜索(Tavily)、SQLite(better-sqlite3)、checkpoint(SqliteSaver)、文件(fs+指纹)
├── observability/   # Trace 事件模型、EventPort 实现、指标聚合
└── config/          # 环境变量、JSON 配置和主题配置
```

> 目录结构以 `docs/design/2026-09-05-agent-technical-design.md` §2.3 为准。技术方案演进时，本计划同步更新，不另行自创结构。

依赖方向：

```text
config / domain
    ↓
ports（能力接口）
    ↓
adapters（模型、文件、搜索、SQLite）
    ↓
agent（LangGraph 图与节点）
    ↓
cli / tui
```

业务状态不写进 TUI；TUI 只展示状态、收集输入并提交用户决定。

## 5. 核心状态与业务规则

### 5.1 阶段

```text
idle → intake → research → thesis → outline → drafting → review → exported
```

`interview` 是 `intake` 内部的访谈子流程，不是固定阶段。

最低完成条件：

| 阶段 | 条件 |
|---|---|
| `intake` | 有主题，或有用户确认的创作简报 |
| `research` | 有本地素材或有效网页结果；没有外部素材时，用户明确确认继续 |
| `thesis` | 3–5 个候选，每个有核心主张和简要论证思路 |
| `outline` | 有标题、章节列表和每章写作目标 |
| `drafting` | 有非空 Markdown，生成目标为 2000–5000 字 |
| `review` | 完成事实核查；外部硬事实有来源或已删除/改写 |
| `exported` | Markdown 和 HTML 均完成写入 |

### 5.2 确认门禁

- 内容门禁（ApprovalGate）：普通模式论点、大纲、事实核查报告、终稿；快速模式论点、终稿；
- 素材采纳门禁（AdoptionGate）：研究阶段素材整批确认；用户显式 `/read` 直接入素材池不设卡；快速模式自动采纳并标记待验证；
- 快速模式仍执行事实核查；无法验证的外部硬事实自动改写为个人经验、观点或推测，并在终稿确认时展示改写清单；改写遵守"只降级、不新增"，每条带原因代码；
- 拒绝采用最小回退：论点→`thesis`、大纲→`outline`、事实报告→`research`、终稿→`drafting`；保存原始反馈和结构化修订指令，修订指令作为下一轮该阶段输入约束；
- 确认使用 Ink 键盘确认卡；中断使用 LangGraph `interrupt/resume`。

### 5.3 素材、证据与产出

- `Material` 保存用户明确确认纳入的原始 `.txt`/`.md`、访谈回答或网页内容；用户显式 `/read` 直接入池，Agent 主动读取与 `/search` 结果先入 Trace、整批确认后入池；确认后复制为快照存入全局素材目录；
- `Evidence` 支撑具体事实声明，LLM（Large Language Model，大语言模型）先分类，规则层只验证可追溯性：判定缺来源、来源不可验证、硬事实占比异常三类争议信号，争议项交用户；
- 外部硬事实必须有来源；个人经验、观点和推测按类型保留表达；
- `WriterProfile` 保存全局作者档案（语言风格、写作禁忌、身份背景、内容偏好），MVP 只支持手动维护，新会话 `intake` 时注入创作简报；自动识别作为后续 feature，不实现；
- `ArtifactVersion` 状态为 `draft`、`rejected`、`temporary`；拒绝保留历史成果，同阶段重做只替换最近的临时成果；
- `Checkpoint` 保存流程恢复状态，与 `ArtifactVersion` 分开，通过 session ID 和 artifact ID 关联。

### 5.4 工作目录与产物目录

- 工作目录（Workspace）默认 = 启动 `writing-agent` 的当前目录，`--cwd <path>` 可覆盖；会话记录创建时的 `workspace` 绝对路径；
- 工作目录解析：`--cwd` 优先；否则从当前目录向上查找最近的 `.writing-agent/` 标记认领工作目录（在子目录启动也能认领）；首次创建会话时写入 `.writing-agent/workspace.json`；
- 工作目录结构：`.writing-agent/`（标识）+ `outlines/`（大纲落盘 `<slug>.outline.md`）+ `articles/`（草稿主稿 + HTML）+ 可选 `inputs/` 软约定；
- 全局状态目录 `~/.writing-agent/`：`config.json`、`profile.db`（作者档案）、`session.db`（会话/checkpoint/Trace/素材/证据/版本/修订指令/门禁）、`materials/<sessionId>/`（素材快照）；
- 结构化对象全部进 `session.db`；大纲、草稿主稿、HTML 落盘；文件是内容权威，DB 存版本状态与确认记录；
- 外部编辑检测：Agent 在读取或重写落盘产物前对比文件 mtime/hash 与 DB；检测到外部编辑 → 停下询问用户（确认采用 / 重新生成 / 忽略改动），不静默采用、不静默覆盖；检测时机为进入 outline 确认前、进入 drafting 前、进入 review 前、导出前；
- 欢迎页按解析出的工作目录匹配全局库未完成会话并提示恢复；`/list` 面向全局单库。

### 5.5 效率、反馈与想法速记

- **研究预算**：研究以轮次为单位，普通模式默认 2 轮、快速模式默认 1 轮，每轮搜索调用 3 次（计数与结果无关，调一次算一次）；达到上限自动收敛到素材确认 → 论点，用户可要求“再研究一轮”；与 `maxRounds`（质量重试）分开；
- **快速到草稿**：草稿前阶段应控制在 2–3 次用户确认/输入以内（intake → 论点确认 1 次 → 大纲确认 1 次 → 见稿）；"到稿交互数"纳入 Trace 指标（T6）；
- **会话内自由反馈**：`/note <内容>` 任意阶段插入，写入会话上下文与 Trace，不阻塞流程、不触发回退；
- **想法速记**：`/idea add/search/use`，全局 `ideas` 表，跨会话独立；MVP 只做记录、查询、基于想法启动新会话；
- **内容诊断（review 内部子阶段）**：普通模式 review 执行文字洁癖、标题与表达效率、认知落差、普通读者理解和 AI 辅助边界诊断；确定性问题应用到新临时版本并记录，不新增独立用户门禁。

## 6. 实施任务

### 第 1 波：脚手架与配置

- [ ] **T1 项目脚手架**：创建 `package.json`、`tsconfig.json`、`vitest.config.ts`、`src/` 目录、`.gitignore` 和 `README.md`；配置 `dev`、`typecheck`、`test`；`writing-agent` 进入交互模式。
  - 验证：`npm run typecheck`；`npm test`；`npm run dev -- --help`。
- [ ] **T2 配置层**：读取环境变量和 `~/.writing-agent/config.json`；支持模型与搜索凭据；环境变量覆盖文件配置；缺少配置给出可读提示；解析工作目录（`--cwd` 优先、否则向上查找 `.writing-agent/` 标记、未找到用当前目录）并确保 `~/.writing-agent/` 全局目录结构存在；启动时检测 `session.db` 锁，被其他进程占用则提示"另一实例正在运行"并退出；无 `config.json` 首次启动引导填写 provider/baseURL/model。
  - 验证：默认配置、环境变量覆盖、非法 URL、凭据缺失、工作目录解析（含子目录认领）、锁检测、首次引导测试。
- [ ] **T3 主题配置**：读取固定主题路径或 `--theme <path>`；以 `archive/my-theme.json` 作为样例并作为默认主题字段结构（内置默认色值）；校验版本、字段类型和取值范围；版本 MVP 只接受 `version: 1`，其他值报错并保留旧主题；缺省字段从系统默认主题补齐；保留原始 JSON；非法配置保留旧主题。
  - 验证：合法配置、缺省字段补齐、非法字段、非法版本、非法颜色/数值和旧主题保留测试。

### 第 2 波：领域模型与持久化

- [ ] **T4 领域状态与阶段产物契约**：实现 `WritingSession`（含 `workspace` 字段）、阶段流转、`CreativeBrief`、内容门禁/采纳门禁、`ContentType`、`WriterProfile`（含来源类型：手动/审查反馈/风格提炼；档案版本号 + 动态读取注入）、`ArtifactVersion` 版本关系、`StageArtifactContract` 结构契约、`ConfirmationPackage` 决策包和拒绝/重做规则（最小回退到父阶段、修订指令作为下一轮输入约束）。模型只能生成候选和推荐，不能推进阶段。
  - 验证：合法/非法阶段转换、每阶段必需字段/章节、上游版本关系、普通/快速门禁、素材采纳门禁、推荐批准/修改/拒绝、简报重新确认、拒绝成果保留、临时成果替换、各门禁回退目标、档案版本号更新测试。
- [ ] **T5 SQLite 存储与原子确认提交**：全局单库 `~/.writing-agent/session.db`（会话、checkpoint、素材、证据（含来源验证状态与争议信号）、产出版本、修订指令、门禁记录、研究计划/候选和内容诊断）+ `profile.db`（作者档案）；`materials/<sessionId>/` 素材快照读写；大纲与主稿的**版本状态、确认状态、产物 hash、确认卡 hash 与文件 mtime**入库，内容以文件为权威；checkpoint 以阶段为原子单位；实现 `StorePort.commitGateDecision()`，在一个事务内提交产物、门禁、阶段、Trace 和 checkpoint，失败全部回滚。
  - 验证：保存/加载会话、阶段原子 checkpoint 恢复、版本生命周期、门禁指纹失效、原子批准/修改/拒绝、素材快照、mtime/hash 指纹记录、研究候选和内容诊断记录、ideas 读写、事务回滚测试。
- [ ] **T6 Trace**：记录模型决策、工具调用、工具结果、状态更新、确认请求/响应、事实核查、错误和导出事件；支持按会话回放；从确认与修订事件统计终稿验收率、平均修订轮次、拒绝反馈分类、到稿交互数四项质量指标。
  - 验证：事件顺序、事件关联、SQLite 写入失败、回放和质量指标统计测试。

### 第 3 波：模型、工具与搜索

- [ ] **T7 Vercel AI SDK 模型适配**：封装模型调用、结构化输出、工具调用和流式事件；模型节点不得直接创建第二套 Agent Loop。
  - 验证：mock provider 的文本、结构化输出、tool call、流式事件和错误测试。
- [ ] **T8 工具注册与权限**：实现 `readMaterials`、`searchWeb`、`readWeb`、`writeDraft`、`checkFacts`、`listInterviewQuestions`、`exportMarkdown`；使用 Zod（TypeScript 运行时数据校验库）校验输入输出。
  - 只读工具可由 Agent 在任意阶段调用，也可由 `/search`、`/read` 触发；写入工具受阶段限制。
  - 读取结果先入 Trace；Agent 主动读取与 `/search` 结果整批确认后入 Material，用户显式 `/read` 直接入 Material；确认后复制为 `materials/<sessionId>/` 快照，后续 `readMaterials` 从快照读取。
  - `checkFacts` 输出三类争议信号：缺来源、来源不可验证、硬事实占比异常。
  - 写入类工具（`writeDraft` 等）重写落盘产物前执行外部编辑检测；检测到文件已被外部修改时拒绝写入并返回提示。
  - 素材边界：`--file` 可重复指定；单个素材文件 ≤ 1MB；编码 UTF-8（容忍 BOM）；超限/编码错误给可读提示不崩溃。
  - 验证：文件格式限制、路径错误、工具权限、整批确认、`/read` 直入、争议信号、素材边界、外部编辑检测、搜索失败和参数错误测试。
- [ ] **T9 SearchProvider 与研究计划**：定义可插拔搜索接口并接入 Tavily（凭据从配置读取；mock 可验收，配置凭据后可用真实搜索）；研究开始前生成 `ResearchPlan`，记录研究问题、子问题、筛选/排除标准；每个候选记录来源类型、抓取时间、保留/淘汰决定和原因；基础设施失败（超时、凭据错误、非 2xx 响应）连续 2 次后暂停并让用户选择跳过，跳过结果标记为待验证；实现研究预算（普通 2 轮、快速 1 轮，每轮搜索 3 次，计数与结果无关；预算为硬约束，工具执行前检查，优先于 maxSteps）。
  - 验证：mock 搜索结果、研究计划更新、候选去重/保留/淘汰原因、来源时间、真实凭据路径、超时、连续失败、跳过、凭据错误和研究预算收敛测试。

### 第 4 波：LangGraph 流程

- [ ] **T10 LangGraph 图**：用 `StateGraph` 实现 `intake`、`research`、`thesis`、`outline`、`drafting`、`review`、`export` 节点；节点只生成候选/推荐和 temporary 产物，由 `StageArtifactValidator` 校验后交给门禁；质量判断 = 结构契约 + 规则层，内容质量交给人工确认门禁，不引入模型内容自评；`maxRounds` 默认 2，仅兜底流程错误（结构不达标重试）；质量失败与基础设施失败分开处理；research 节点按 ResearchPlan 和研究预算自动收敛。
  - 验证：话题入口、素材入口、信息不足访谈、研究计划、研究无外部素材确认、研究预算收敛、3–5 个论点及推荐、结构契约失败重试、完整 mock 闭环和错误终止。
- [ ] **T11 人工门禁与恢复**：使用 LangGraph `interrupt/resume`；确认卡默认展示 Agent 推荐、依据、风险和备选项，支持批准推荐/批准备选/修改/拒绝；每次决定绑定 `artifactId`、`artifactHash`、`confirmationHash`；通过 `WorkflowStateService` 原子提交版本、门禁、阶段、Trace 和 checkpoint；拒绝按最小回退到父阶段，保存成果、原始反馈与修订指令；中断节点重做；`Ctrl+C`（即 SIGINT）保存 checkpoint 回到主界面；所有外部编辑、生成新版本、标题或确认卡变化统一触发确认失效。
  - 验证：推荐批准、备选批准、修改、拒绝回退、过期指纹阻止流转、事务失败回滚、误操作恢复、重复执行临时成果替换、外部编辑检测与三选衔接、SIGINT（`Ctrl+C`）保存 checkpoint 退出。

### 第 5 波：渲染与交互

- [ ] **T12 Markdown/HTML 渲染**：Markdown 作为主稿；按 Markdown 节点类型（mdast 子集：标题/段落/引用/代码/列表/表格/图片/强调/链接/分隔线）使用主题变量生成内联样式 HTML；不属于该子集的内容保留原文并给出警告；默认不输出来源；大纲文件（`outlines/<slug>.outline.md`）与主稿可读解析。
  - 验证：标题、段落、引用、代码、列表、表格等节点渲染；主题缺省值；不可转换内容警告；大纲/主稿文件解析；公众号复制场景的浏览器验证。
- [ ] **T13 TUI 与斜杠命令**：实现 idle 欢迎页（新建/恢复/退出，并按解析出的工作目录匹配未完成会话提示恢复）、阶段展示、会话列表（默认名 = 主题前 8 字 + 日期，每项含最近事件 = 最近 Trace 类型+简述）、确认卡、摘要展开、Trace 查看器、进度提示和命令分发；`/list` 默认未完成，`/list --all` 查看全部；`/resume` 选择会话；`/note` 会话内自由反馈；`/idea add/search/use` 想法速记；`/profile` 查看和编辑作者档案；`/reload` 重载档案/主题/配置；`/style 提炼` 风格提炼与确认写入。
  - 验证：Ink 无头渲染、键盘操作、非法输入不崩溃、欢迎页导航、工作目录解析与会话匹配、列表信息（命名/最近事件）、`/note`、`/idea`、`/reload`、`/style`、命令路由测试。
- [ ] **T14 导出与外部编辑**：实现 Markdown/HTML 双文件导出到 `<工作目录>/articles/`（`--output-dir` 绝对路径或用则覆盖、否则相对工作目录）、slug（`--slug` 优先，默认从标题安全化、保留中文、空格转 `-`）、冲突时 `slug-2`/`slug-3`、部分成功和单独重试 HTML、`/export --copy` 复制 HTML 到剪贴板；外部编辑检测到主稿改动后，提示是否重新进入 review/export，确认后重新事实核查、终稿确认并导出。
  - 验证：双文件、相对/绝对输出目录、冲突保护、中文 slug、HTML 单独重试、`--copy`、外部编辑后重审导出、主题重新导出和编辑后复审测试。

### 第 6 波：集成与文档

- [ ] **T15 端到端 mock**：从话题或 `.md` 输入跑通 `intake → research → thesis → outline → drafting → review → exported`；覆盖普通和 `--fast`；从任意目录启动并在工作目录内匹配恢复未完成会话；覆盖阶段结构契约、推荐批准、确认指纹失效、原子确认提交、内容诊断修改链、大纲/主稿被外部编辑后的检测与衔接、研究计划与预算收敛、`/note` 与 `/idea`。
  - 验证：终稿、HTML、改写清单、evidence、Trace、checkpoint、产物版本和确认指纹均可读；工作目录会话匹配与恢复；确认失效后重新展示确认卡；外部编辑检测与衔接；研究计划/候选筛选记录；内容诊断应用修改；`/note`/`/idea` 生效。
- [ ] **T16 本地模型烟测**：使用本地 OpenAI-compatible（OpenAI 兼容）接口运行一篇短文；记录模型 tool calling 兼容性和失败行为。
  - 验证：本地模型成功或明确记录阻塞，不把未验证结果写成通过。
- [ ] **T17 文档同步**：更新 README、架构说明和运行说明，确保与 PRD、计划、ADR 和 `CONTEXT.md` 一致。

## 7. 验证门禁

- [ ] V1：所有任务包含成功和失败路径测试；
- [ ] V2：`npm run typecheck` 通过；
- [ ] V3：`npm test` 输出明确的通过数量；
- [ ] V4：mock 端到端覆盖启动、工作目录匹配、确认、素材采纳、研究预算收敛、拒绝回退、外部编辑检测、`/note`/`/idea`、恢复、重做、事实规则、内容诊断、质量指标统计、素材边界和双格式导出；
- [ ] V5：本地模型烟测已运行，或明确记录运行阻塞；
- [ ] V6：双轴代码审查（Standards/Spec，规范/需求）完成后再宣布阶段放行；
- [ ] V7：检查范围未包含热点、小红书、PDF、主题编辑器、自动发布、向量库和多智能体。

## 8. 交付标准

只有同时满足以下条件，才可标记计划完成：

1. `writing-agent` 直接进入交互模式，核心斜杠命令可用；
2. 话题、`.txt`、`.md` 和中断会话入口可用；任意目录启动、`--cwd` 覆盖、工作目录内匹配恢复可用；
3. 普通/快速确认门禁符合 PRD；
4. 中断、拒绝和重做不丢失成果；
5. Markdown 主稿和同源内联 HTML 均可导出；
6. 事实类型和证据规则可验证；
7. 自动化测试、端到端 mock 和必要的本地模型烟测有明确证据；
8. 计划、PRD、ADR、术语表和代码结构一致。
