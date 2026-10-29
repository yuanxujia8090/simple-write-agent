# 开源写作 Agent Top 5 架构分析

- 日期：2026-10-24
- 状态：已完成（只读分析，未运行这 5 个项目）
- 对象：STORM、GPT Researcher、InkOS、Oh Story、Webnovel Writer
- 用途：为本项目（my-write-agent）的架构取舍提供外部证据，不构成选型决策

## 0. 分析方法与证据口径

**做了什么**：把 5 个仓库浅克隆到本地，读源码结构、架构文档、核心模块实现与测试目录；通过 GitHub API 核对 star、许可、提交时间。

| 项目 | 仓库 | Commit | 最后提交 | 语言 | 许可 | Star |
| --- | --- | --- | --- | --- | --- | --- |
| STORM | stanford-oval/storm | `fb951af` | 2025-09-30 | Python | MIT | 31.7k |
| GPT Researcher | assafelovic/gpt-researcher | `3582a68` | 2026-10-10 | Python | Apache-2.0 | 30.3k |
| InkOS | Narcooo/inkos | `53adac4` | 2026-10-24 | TypeScript | AGPL-3.0 | 10.6k |
| Oh Story | zenstory-ai/oh-story-claudecode | `c3fbbbe` | 2026-10-23 | Python | MIT | 8.0k |
| Webnovel Writer | lingfengQAQ/webnovel-writer | `b38056e` | 2026-10-22 | Python | GPL-3.0 | 7.6k |

**边界**：只读了源码与仓库自述文档，**没有安装、没有跑流水线、没有复现评测**。所以"质量好/差"这类结论一律标注为项目自述或推断，不当作实测。

**术语约定**（首次出现给大白话）：

- **真源（source of truth）**：唯一说了算的那份数据；其它副本都是它的投影，坏了可以重建。
- **投影（projection）**：从真源派生出来的只读视图，比如给人看的状态卡、给检索用的索引。
- **门禁（gate）**：不满足条件就不许进入下一步的检查点。
- **幂等**：同样的操作重复执行，结果不变。

---

## 1. 一页结论

### 1.1 五个项目不是同一类东西

按"谁在控制流程"分四档：

| 档位 | 项目 | 流程控制者 | 典型代价 |
| --- | --- | --- | --- |
| 流水线 | STORM | 代码里的固定 DAG | 不灵活，但不跑偏 |
| 研究型 Agent | GPT Researcher | 代码 + 模型动态规划（深度/广度/子主题） | 分支多、代码膨胀 |
| 自建 Harness | InkOS | 宿主运行时 + 模型选能力 | 复杂，但可审计 |
| Skill 编排 | Oh Story、Webnovel Writer | 宿主 Agent + SKILL.md 契约 + 脚本 | 上限受宿主，靠提示词与 hook 约束 |

### 1.2 五条最重要的判断

1. **写作 Agent 的护城河不在"生成文字"，在四件事：状态真源、上下文预算、校验门禁、恢复语义。** 高分项目都在这四件事上做了重投入；只做 prompt 的项目 star 也高（如去 AI 味 skill），但那是文案工具，不是系统。
2. **三个中文长篇项目独立收敛到同一个架构模式**：权威 JSON 当唯一真源 + Markdown 当人读投影 + 索引当可重建检索层（InkOS、Oh Story、Webnovel Writer）。这不是巧合，是长篇写作的必然——上下文装不下全书，只能靠外部状态。
3. **"模型说的完成"不可信，必须用产物和回执判定完成。** InkOS 把这条写成硬规则（`Episode completed` 不代表交付通过），Webnovel 用 commit + projection status，Oh Story 用交易式 `tracking_commit.py`。STORM / GPT Researcher 缺这一层。
4. **上下文治理正在从"检索 top-k"升级为"预算 + 分级 + 按时刻加载"。** Oh Story 用去空白字数预算 + 单次调用 35K 硬上限；InkOS 用 protected/compressible 分级 + token 预算 + 溢出即失败；Webnovel 用打分排序 + 阶段化权重。
5. **许可决定能否被产品复用**：MIT（STORM、Oh Story）最松；Apache-2.0（GPT Researcher）可商用；GPL-3.0（Webnovel）与 AGPL-3.0（InkOS）对闭源产品基本关闭。抄架构可以，抄代码要算账。

### 1.3 一句话选型建议（若只借一个）

- 借**上下文预算与门禁**：InkOS（设计最完整）。
- 借**流程纪律与文件结构**：Oh Story（最容易照抄落地）。
- 借**状态提交与投影**：Webnovel（最像数据库事务）。
- 借**研究与取材**：GPT Researcher（provider 矩阵最全）。
- 借**多视角提问**：STORM（唯一的真差异点）。

---

## 2. STORM：把"多视角提问"做成可复现流水线

### 2.1 定位与形态

学术项目（NAACL 2024），输入一个话题，输出一篇 Wikipedia 风格、带引用的长文。仓库含论文复现脚本、FreshWiki 数据集说明、Streamlit demo。定位是"知识整理系统"，不是创作工具。

### 2.2 整体架构

```
examples/*.py（各模型入口脚本）
        │
   STORMWikiRunner（storm_wiki/engine.py）
        │  5 个 LM 槽 + 1 个 RM + 1 个 Encoder
        ├── KnowledgeCurationModule  ── persona → 多轮对话 → 信息表
        ├── OutlineGenerationModule  ── 全对话 → 大纲
        ├── ArticleGenerationModule  ── 逐节检索 + 逐节写作
        └── ArticlePolishingModule   ── 摘要 + 去重
        │
knowledge_storm/interface.py（4 个模块抽象基类）
knowledge_storm/rm.py（检索后端，1238 行）
knowledge_storm/lm.py（模型封装，1286 行）
        │
产物目录：conversation_log.json / storm_gen_outline.txt /
         storm_gen_article.txt / url_to_info.json
```

分层很清楚：**接口层（interface.py）定义四个阶段的输入输出，实现层（storm_wiki/）只实现接口，基础设施层（lm/rm/encoder）可替换**。这是它能被 Co-STORM 复用、能换 8 种模型的原因。

### 2.3 系统设计

**多模型分工是显式设计**，不是顺手写的：

`STORMWikiLMConfigs` 提供 5 个槽位——对话模拟器、提问者、大纲生成、正文生成、润色。README 直接建议：对话模拟用便宜快的模型，成文用强模型。这是"成本-质量"分离的最早实践之一，比现在很多 Agent 框架的"一个模型打天下"更清醒。

**信息表是核心数据结构**：`StormInformationTable` 把「persona → 对话轮次 → 问答 → 引用 URL」压成两张表：
- `url_to_info`：URL 去重后的信息集合；
- `conversations`：按 persona 分组，供大纲阶段整体读取。

`prepare_table_for_retrieval()` 之后，每个小节的 query 可以按相似度取 top-k 片段。也就是说，STORM 的"记忆"是**检索式**的：不维护全局状态，只维护证据池。

**阶段可独立重跑**：四个 `do_*` 开关，关掉某阶段就从磁盘读同一份产物。这是"穷人版断点续跑"——没有事务、没有版本，但研究复现够用。

### 2.4 核心流程（按代码顺序）

1. **生成视角**：`max_perspective=3`，让模型给出 3 个不同身份（如经济学家、历史学家、政策制定者）。
2. **多视角对话**：每个 persona 一个线程，`max_workers=min(10, personas)`；每轮最多 3 个问题、每个问题最多 3 条检索 query、每条取 top-3 结果；`max_conv_turn=3` 轮后停止。写手模型提问，专家模型基于检索结果回答。
3. **建表**：清洗引用、去重 URL、拼装信息表。
4. **出大纲**：把**所有对话拼成一个超长上下文**，一次调用让模型写大纲（`WriteOutline`），可返回 draft + final 两份。
5. **写正文**：按一级小节并发（线程池），每节先检索 top-3 片段，再让模型写带引用编号的小节；写完逐节插入文章树，合并引用、重排编号。
6. **润色**：补摘要、可选去重。

### 2.5 设计亮点

1. **多视角提问（perspective-guided question asking）**：不是"让模型多想几个角度"，而是把视角变成 persona 对象，各自独立检索、独立对话，最后汇总。这是 STORM 相对普通 RAG 写作的真差异，也是论文的主要贡献。
2. **阶段产物落盘 + 接口抽象**：任何一段都能单独替换（换检索、换模型、换大纲器），对研究型项目是必要设计。
3. **Co-STORM 的回合策略对象化**：`TurnPolicySpec` 把"这一轮要不要重组知识库、要不要更新专家列表、要不要润色发言、由哪个 agent 发言"打包成一个策略对象，`DiscourseManager` 只负责推进。把"多人圆桌"从硬编码对话变成可插拔策略，这个抽象比 STORM 本身更值得学。
4. **成本分层的显式 API**：5 个 LM 槽位让读者自己权衡，而不是藏一个默认值。

### 2.6 不足（有证据）

| 问题 | 证据 | 影响 |
| --- | --- | --- |
| 没有自动化测试 | 仓库内 `test_*.py` 数量为 0；CI 只有格式检查与打包 | 改一处不知道坏没坏；社区 PR 难合并 |
| 已停更约 13 个月 | 最后提交 2025-09-30 | 不跟新模型/新工具生态；dspy 老 API（`dspy.dsp.LM`）升级风险 |
| 无修订回路 | 流水线是单向的，润色只加摘要和去重 | 写歪了只能整篇重跑，不能定点改 |
| 上下文策略粗暴 | 大纲阶段把全部对话拼接 | 长话题必然超窗/截断，且无预算概念 |
| 无质量门禁 | 引用只做编号重排，不校验来源是否支持论断 | 幻觉不可拦截 |
| 只面向单轮 Wiki 长文 | 产物是 `storm_gen_article.txt` | 不支持连载、角色、伏笔等长篇需求 |

补充：112 个 open issue、无发布版本节奏，说明维护强度低。这是学术仓库的常态，不是缺陷指控，但选它当底座要自己接维护。

### 2.7 可优化点

1. **信息表升级为证据图**：`claim → source → section` 三元组，支持增量更新与引用覆盖率统计。
2. **大纲分治**：先出二级目录，再按目录逐块细化，替代"全对话一次拼接"。
3. **小节级校验**：每节生成后检查"引用覆盖了本节每个论断吗"，不达标重写本节。
4. **加 token 预算与语义压缩**（可直接借 InkOS 的 protected/compressible 思路）。
5. **最小 e2e 回归**：固定话题 + 固定检索快照 + 断言大纲结构与引用数量，成本可控。

---

## 3. GPT Researcher：provider 矩阵撑起来的"研究型写作"

### 3.1 定位与形态

输入 query，输出带引用的研究报告。三种报告类型：基础（一段式）、详细（子主题派生）、深度研究（广度×深度递归）。提供 Python 库、FastAPI 服务、WebSocket 流式、MCP 接入。定位是"自主研究 Agent"，写作是它的产出形式。

### 3.2 整体架构

```
FastAPI / WebSocket / Report Store
        │
GPTResearcher（agent.py，门面 + 状态）
        │
   ┌────┴─────────────────────────────────────┐
   │ Skills 层（8 个能力对象，组合式）          │
   │ ResearchConductor  计划/检索/抓取/汇总     │
   │ ReportGenerator    分节写作/引言/结论      │
   │ ContextManager     向量化与相似检索        │
   │ SourceCurator      来源排序                │
   │ BrowserManager     浏览器抓取              │
   │ DeepResearchSkill  广度×深度递归           │
   │ ImageGenerator     配图                    │
   └────┬─────────────────────────────────────┘
        │
   Actions 层（无状态函数：报告生成、query 拆解、抓取、检索器选择…）
        │
   Providers 层：20+ retriever、7 scraper、多 LLM、向量库、MCP
        │
   Config 层：环境变量 > JSON 配置 > 默认值
```

值得注意的是它**没有"Graph"或"StateMachine"抽象**：流程写在 `ResearchConductor.conduct_research()` 里，靠 `if report_source == ...` 分派。这是优点也是债。

### 3.3 系统设计

**门面 + 状态集中**：`GPTResearcher` 持有 `context / visited_urls / research_sources / costs / available_images`，技能对象反向引用它（`self.researcher`）。好处是所有技能共享同一份会话状态；代价是隐式耦合，单个技能无法独立测试。

**三种报告类型对应三种编排**：
- basic：一次检索 → 一次写作；
- detailed：`get_subtopics()` → 每个子主题新建一个 `GPTResearcher` 递归 → 合并成章节（子 researcher 共享 `visited_urls`，避免重复抓页）；
- deep research：`generate_research_plan()` 生成广度问题 → 逐层递归（breadth/depth）→ `ResearchProgress` 跟踪。

**配置三层优先级**（env > json > default）是它可被大量产品集成的关键：不写代码就能换检索器、模型、报告风格。

**成本是一等公民**：`add_costs()` / `get_step_costs()` 按步骤累计，WebSocket 能把成本和日志一起推给前端。

### 3.4 核心流程（detailed 报告）

1. `choose_agent()`：模型判断 query 需要什么角色（如"金融分析师"），产出 agent + role，注入后续 prompt。
2. `plan_research()`：拆子 query。
3. 每个子 query 并发：选检索器 → 检索 → 抓页（自动选择 scraper）→ 抽取正文 → 摘要成 context。
4. `SourceCurator`：对来源排序/裁剪。
5. 子主题派生：每个子主题一个子 researcher，共享已访问 URL 集合。
6. `ReportGenerator`：逐节写（可带已有标题与已写内容，支持续写与查重）→ 引言 → 结论 → 合并引用。

### 3.5 设计亮点

1. **Provider 矩阵是真正的资产**：20+ 检索器、7 种抓取器、多 LLM、本地/混合/云文档源。换供应商只改配置，这对"研究型写作"的取材广度是硬能力。
2. **Skills 层把门面变薄**：`agent.py` 只做编排与状态，具体能力在 8 个对象里；新增能力不用改主循环。这是它比同代"一个大函数"项目更耐改的原因。
3. **跨子主题 URL 去重**：详细报告最容易重复抓同一批页面，它显式共享 `visited_urls` 并注释说明原因——这是成本工程细节，不是功能。
4. **成本可观测 + 流式事件**：产品化必需的两件事它都有。
5. **有评测目录**：幻觉、质量、上下文过滤、SimpleQA 四类 eval，虽然不一定进 CI，但方向正确。

### 3.6 不足（有证据）

| 问题 | 证据 | 影响 |
| --- | --- | --- |
| 无持久化执行状态 | `context` 在内存；未见 checkpoint/episode 机制 | 中途失败只能整段重跑，长报告成本高 |
| 编排逻辑集中在巨型类 | `skills/researcher.py` 1148 行、`prompts.py` 903 行 | 分支组合爆炸，新报告类型要改多处 |
| 分支条件过多 | `conduct_research` 里 source_urls / web / local / hybrid / azure 并列 | 组合路径缺少矩阵化测试，回归风险高 |
| 成本只记账不设限 | 有 `add_costs`，未见预算熔断 | 一次深度研究可能烧穿预算 |
| 质量门禁弱 | 引用靠 prompt 约束 + 事后 eval | 不能阻止"有引用但引用不支持论断" |
| 写作能力偏"报告体" | 模板与 prompt 面向研究报告 | 小说/文案类创作不适用 |

### 3.7 可优化点

1. **把 conductor 拆成显式 DAG**（计划→检索→抓取→汇总→写作→校验），每步落盘，支持按子主题恢复。
2. **引用校验步骤**：claim 与 source 对齐 + 覆盖率门槛，不达标回退重写该节。
3. **预算控制**：token/费用上限 + 降级链（深度→广度→基础报告）。
4. **prompt 外置 + 版本化**：`prompts.py` 拆成模板目录，便于 A/B 与本地化。
5. **统一限流层**：现在各 retriever 自己处理速率，放在 provider 层统一更稳。

---

## 4. InkOS：把"模型不可信"写进运行时

### 4.1 定位与形态

本地优先的创作工作台：CLI + TUI + Studio（Web）+ Agent 模式。覆盖长篇、短篇、剧本、分镜、互动影游、翻译、封面等 13 类创作。核心卖点是"专业创作内核 + 通用 Agent Harness"，不是单一写作流程。

### 4.2 整体架构

```
packages/studio（Web/桌面 UI）
packages/cli（命令、TUI、守护进程）
packages/core
  ├── harness/     运行时：能力注册、授权、Episode 事件、产物版本、
  │                上下文编译、原子提交、执行证据、Work 锁
  ├── agents/      角色：radar/planner/composer/architect/writer/
  │                settler/reviewer/reviser/continuity/detector…
  ├── pipeline/    生产编排：章节管线、短篇、剧本、分镜、状态恢复
  ├── state/       状态投影、reducer、校验、工作区
  ├── llm/         多模型路由（59 文件）
  ├── skills/      创作方法（可被项目内同名 SKILL.md 覆盖）
  ├── play/ interactive-film/ translation/ forecast/ retrieval/
  └── models/      类型与 schema（Zod）
```

关键：**harness 是唯一入口，所有创作类型复用同一套 Work / Artifact / Revision / Episode 抽象**。不同产品形态只换 Work Profile（能力白名单）和 Skill，不换运行时。

### 4.3 系统设计

**(1) 作品身份与版本**

`works/<id>/work.json` 记录 profile 与已登记产物；`Artifact` 有 `currentRevisionId`；`ArtifactRevision` 带 `parentRevisionId / checksum / byteLength / status(candidate|current|superseded) / snapshotPath`。读取、审稿、导出都走"解析已登记版本 + 校验和"，而不是读任意路径。这一条直接消灭了"模型猜路径""读到未采纳草稿"两类故障。

**(2) Episode 事件流**

一次会话 = 一个 Episode。动作开始/完成/失败/取消、确认请求、产物同步、输出保留，全部 append 成事件。事件流是**执行事实**，不是日志：UI、恢复、审计都读它。注意它的自我限定——`Episode completed` 只表示这轮循环结束，不表示作品交付通过。

**(3) 授权矩阵**

`executeAction` 先解析 `(capability, action)`，再检查：
- profile 的 `capabilityIds` 是否包含该能力（越权直接抛）；
- `isActionAuthorized(profile, action, source, confirmed)`：`read` 永远放行；`confirmed` 放行；`requiresConfirmation` 未确认拒绝；`destructive-write` 未确认拒绝；其余按 source 决定——`explicit`（用户明说）走 `explicitRecoverableMutation`，`agent`（模型推断）走 `inferredMutation`。

这把"模型自己想改"和"用户要求改"分成两套策略，是产品安全的关键区分。

**(4) 并发与锁**

非只读动作且有 Work 时：进程内 `runInWorkMutationQueue(projectRoot + workId)` → 跨进程 `acquireBookLock` → 再执行。图像生成明确放在 Work 锁之外，提交时按捕获的时刻校验。锁的作用域写进了 capability 的 `managesWorkLock` 标记，而不是散在各处。

**(5) 上下文编译**

`ContextRecipe(sourceIds)` → 各 provider 加载 → 去重排序 → 分 `protected` / `compressible`：
- `protected` 超预算直接抛 `ProtectedContextOverflowError`（宁可失败，不裁硬约束）；
- 总预算超了但没有压缩器，抛 `ContextCompilationRequiredError`（不允许静默截断）；
- 压缩后仍超预算，报错。
输出带 `compiledSourceIds` 与 `compressionTriggered`，写进 trace 文件。

**(6) 章节管线**

`plan → compose → write → settler → review → 原子提交`：
- Composer 按任务从结构化状态、控制文档、材料里挑上下文，记录保护层级与压缩 trace；
- Writer 产出正文 + 字数统计；
- Settler 用 typed tool 提交"有证据的 state delta"；
- Review 产出 observation（不改变正文完成态）；
- `commitAtomicFileSet` 多文件 journal 原子落盘；
- 修订是**独立 action**，生成新 revision，不动旧的。

**(7) 记忆三层**

`story/state/*.json`（Zod 校验的权威状态）+ `story/*.md`（人读投影）+ `memory.db`（SQLite FTS5/BM25，可重建）。检索先 BM25 召回，再由 LLM 做语义选择。

### 4.4 设计亮点

1. **"结果优先"的完成语义**：完成态来自 `ActionResult` + 真实 artifact revision，不来自模型自述。这条被写进 spec，也在多轮重构文档里反复验证。
2. **protected 上下文 fail-closed**：绝大多数项目超预算就截断，它选择报错。对"硬约束不能被裁掉"的场景，这是正确取舍。
3. **原子多文件提交 + 恢复协议**：`commitAtomicFileSet` 带 journal；typed error 在模型边界保留 `code` 与 `recovery`，模型知道怎么修，而不是看到一句"失败"。
4. **授权按来源分叉**：同一动作，用户显式要求 vs 模型推断，策略不同。这是"Agent 自主性"的细粒度控制，比一个全局 auto-approve 开关强得多。
5. **工程自省文档**：`docs/harness-result-first-redesign.md` 记录了 7 批真实旅程，包含回执复放（284 条）、观察体积变化（628KB → 789KB，+25.6%）、并明确写"这项改动没有取得上下文成本下降的证据"。这种"承认没变好"的记录，比任何架构图都有说服力。

### 4.5 不足（有证据）

| 问题 | 证据 | 影响 |
| --- | --- | --- |
| 复杂度高 | core 758+ 源文件、206 个测试文件、13 类创作、9 个 profile | 新贡献者门槛高；隐性耦合多 |
| 契约文档薄 | `spec/creative-harness-v2.md` 仅 74 行 | 真实契约散在代码与测试里，外部难对接 |
| 首次完成率仍不足 | 重构文档自述多轮"首次遗漏、绕路、超长稿误判" | 产品体验依赖模型能力，非纯工程可解 |
| AGPL-3.0 | 仓库许可 | 闭源产品集成基本不可行 |
| 迭代极快 | 2026-03 建仓，245 open issues | schema/API 迁移压力，legacy 迁移工具已存在 |
| 中文优先 | spec/docs 多为中文，README.en 存在但薄 | 海外采用与贡献受限 |

### 4.6 可优化点

1. **spec 变可执行契约**：状态机图 + JSON Schema + 兼容矩阵，减少"读代码才知道规则"。
2. **把真实旅程指标固化**：作者已在做人工旅程，建议固化成可重复的 bench（固定书稿 + 记录首次完成率/动作错误数/往返次数），进 CI 抽样。
3. **pipeline 去重**：capability/profile 已收敛，但每类创作仍有独立 runner，可抽公共阶段骨架。
4. **预算与延迟联动**：已有 token usage summary，可再加"计划阶段就锁预算 + 超支降级"，而不是事后统计。
5. **英文契约与贡献指南**：若想吃海外生态，spec 双语是低成本高回报。

---

## 5. Oh Story：用"文档预算 + 交易脚本"约束提示词系统

### 5.1 定位与形态

给中文网文作者的 Skill 套装：13 个 skill、7 个专业 agent、8 个 hook，适配 7 种宿主（Claude Code、Codex、OpenCode、Antigravity、ZCode、OpenClaw、Reasonix）。没有自建运行时，靠宿主 + 文件系统 + 脚本。

### 5.2 整体架构

```
宿主（Claude Code / Codex / …）
  ├── Skills（13）：story 路由 / setup / long-write / long-analyze /
  │                 long-scan / short-* / deslop / review / import / cover
  ├── Agents（7）：architect、character-designer、narrative-writer、
  │                consistency-checker、researcher、explorer、chapter-extractor
  ├── Hooks（8）：session-start/end、pre/post-compact、gap 检测、
  │                commit 校验、写正文前大纲守卫（唯一阻断）、写后扫描
  └── scripts/：tracking_commit.py（事务）、outline_view.py（取段）、
                author_memory_commit.py、check-*.sh（契约校验）
        │
项目文件系统 = 记忆
  作者记忆（全局/题材/流程 AP + 本书 BP，_author-memory-state.json 唯一权威）
  书目录：设定/ 大纲/ 正文/ 对标/ 追踪/（_tracking-state.json 唯一权威 + 派生视图）
```

### 5.3 系统设计

**(1) 状态：唯一权威 + 派生视图**

`追踪/_tracking-state.json` 是唯一结构化权威，`上下文.md`、`伏笔.md`、角色快照、时间线全部由脚本派生，**禁止手改**。派生视图有体积上限（如续写状态卡 ≤12KB、逐章记录 ≤3072 bytes），超限由脚本一次报全。

**(2) 事务：tracking_commit.py（1696 行）**

带项目写锁、原子写、`draft → check → commit` 三段、字段白名单、别名归一、跨平台路径安全、体积检查、退役路径归档。也就是说，"写章节状态"不是让模型改 Markdown，而是提交一个结构化 delta，由脚本校验后落盘并重算视图。

**(3) 上下文：按时刻加载 + 硬预算**

- 每个阶段（定方向/定设定/卷纲/细纲/单章/日更/大修）只读对应的一份 workflow 文件；
- `doc-budget.json` 登记所有"每次会话或每章都会进上下文"的文件，按去空白字符数计预算；
- 单次调用硬上限 35,000 字（`path_ceiling`），同一次调用会同时加载的分支按最坏组合叠加计算；
- `check-doc-budget.sh` 强制执行，超了要么删等量旧文本，要么显式调高并说明理由。

**(4) 门禁：hook 的 fail-open / fail-closed 取舍**

唯一阻断的是 `guard-outline-before-prose.sh`：没有对应细纲/小节大纲，不许首次创建正文；追踪事务未提交，不许写下一章。其余 hook 只提醒不阻断（写后扫描、commit 校验）。设计原则写死在注释里："宁可漏拦不可误伤，任何不确定都 exit 0"。

实现上有不少硬功夫：强制 `LC_ALL=C` 避免中文路径在 GBK 区域失效；不 export 整章正文避免 `E2BIG`；node 缺失时回退纯 bash 抽取。

**(5) 多宿主降级**

宿主没有 custom agent、或缺 hook 能力（如 ZCode 3.3.4 无 compact/session-end）时，显式声明 fallback 到 solo/direct，并在技术备注行提示。不假装能力一致。

### 5.4 设计亮点

1. **文档预算制度**：把"提示词膨胀"变成可度量、可审查的工程指标。绝大多数 prompt 系统最后都烂在"再加一句话"，它用 CI 挡住的正是这件事。
2. **按时刻加载**：把 prompt 从"全量塞"变成状态机式路由——当前在哪个阶段，只读那个阶段的文件。这与"检索 top-k"是两条不同路线，对流程确定的写作更有效。
3. **唯一权威 + 派生视图 + 事务脚本**：与 InkOS、Webnovel 独立收敛，说明这是长文写作的稳定解。
4. **hook 注释即 ADR**：为什么 fail-open、为什么用字节区域、为什么不用 export，全部写在脚本头部。后来者不需要考古。
5. **质量实验有方法**：`scripts/bench/`（cases/judge/metrics/compare）+ 预先注册协议（prereg）做 A/B，比"我觉得改完更好"强。
6. **面向作者的表达规范**：汇报只讲"写了什么/要你定什么/下一步"，禁止内部术语。这是少见的"产品语言"设计。

### 5.5 不足（有证据）

| 问题 | 证据 | 影响 |
| --- | --- | --- |
| 能力上限 = 宿主上限 | 依赖 hook/agent 注册；部分宿主降级 | 无法跨会话调度、后台任务、服务化 |
| 校验可被绕过 | hook 只拦 Write/Edit 与部分 Bash；子 agent 直写、脚本写文件仍可能绕过 | 状态一致性依赖模型守规矩 |
| 规则密度高 | 单 SKILL.md 6750 字预算、30+ reference 文件 | 作者/贡献者认知负担大；改一句话要算字数 |
| 测试以契约脚本为主 | `test_*.py` 仅 1 个（dashboard server）；其余是 `check-*.sh` | 逻辑正确性覆盖弱于契约一致性 |
| 质量评测样本小 | bench 为若干 demo 书 + LLM judge | 结论外推有限 |
| 模型档位写死 | agents 模板默认 Opus/Sonnet/Haiku | 换模型/降本要逐文件改 |

### 5.6 可优化点

1. **事务语义上收为共享运行时**：现在每个宿主各自 hook，行为一致性靠生成脚本维护；抽成宿主无关的小 runtime 更稳。
2. **补逻辑单测**：`tracking_commit.py` 1696 行是纯逻辑，值得独立单测，不只靠 e2e 契约脚本。
3. **规则分层**：把"写作方法"（可长）与"流程强制"（必须短）分开，热路径只留强制规则，方法按需加载。
4. **headless 入口**：提供不依赖 IDE 会话的 CLI，才能做批量生产与自动化评测。
5. **模型档位配置化**：agents 模板从配置读"角色 → 模型档"，便于降本与多模型对比。

---

## 6. Webnovel Writer：把写作当数据库事务

### 6.1 定位与形态

Claude Code 插件，面向中文长篇网文（200 万字级连载）。8 个 skill、3 个 agent、hooks、52k 行 Python 脚本、本地 dashboard。核心主张：解决 AI 写作的"遗忘"和"幻觉"。

### 6.2 整体架构

```
Skills：init / plan / write / review / query / learn / dashboard / doctor
Agents：Context（读）/ Data（写）/ Reviewer（审，六维）
Hooks：SessionStart 报状态；PreToolUse 保护运行产物不被手改
Scripts：webnovel.py（统一 CLI）、story_system.py、chapter_commit.py、
         story_events.py、review_pipeline.py、status_reporter.py
Data：
  .story-system/   合同（MASTER_SETTING / volumes / chapters / reviews）
                   + commits（accepted 章节提交）
                   + events（事件审计 + 修订提案 + 覆写账本）
  .webnovel/       投影/read-model：state.json、index.db、
                   vectors.db、summaries、memory_scratchpad
```

### 6.3 系统设计

**(1) 真源划分（写前 / 写后）**

- 写前真源：`MASTER_SETTING.json` + 卷合同 + 章合同 + 审稿合同；
- 写后真源：accepted 的 `CHAPTER_COMMIT`；
- 其余（state、index、summary、memory、vector）都是投影，坏了可重建。

这条划分写在 `docs/architecture/overview.md` 第一段，是全项目的地基。

**(2) 提交链**

```
chapter-commit --chapter N
  → 组装 payload（meta / contract_refs / provenance / outline_snapshot /
                  review_result / fulfillment_result /
                  disambiguation_result / extraction_result / projection_status）
  → schema 校验（pydantic）
  → persist commits/chapter_XXX.commit.json
  → EventProjectionRouter.required_writers(payload) 决定哪些投影必需
  → 5 个 writer 逐个执行：state / index / summary / memory / vector
  → 每个记 done / skipped / failed:reason
```

关键设计：**只有 `accepted` 或 `rejected` 的提交才跑投影**；投影失败不污染真源，可以 retry/replay。

**(3) 防幻觉三定律**

| 定律 | 机制 |
| --- | --- |
| 大纲即法律 | Context Agent 强制加载本章大纲 |
| 设定即物理 | Reviewer 内置一致性审查（战力/地点/时间线） |
| 发明需识别 | Data Agent 提取新实体，消歧后入库 |

**(4) 上下文选择**

`ContextRanker` 按 `recency / frequency / length / hook 提示` 组合打分，再用模板权重分配预算：剧情/战斗/情感/过渡四类模板 × 早/中/后期三阶段，权重表集中在 `context_weights.py`。这比纯向量召回更贴"长篇连载"的注意力分布。

**(5) 审查**

Reviewer 六维：爽点密度、设定一致性、节奏（Strand 比例与断档）、OOC、连贯性、追读力。Strand Weave 规定 Quest 60% / Fire 20% / Constellation 20%，并设红线（Quest 连写不超过 5 章等）。这是把"网文经验"编码成可检查规则。

### 6.4 设计亮点

1. **合同优先 + 提交优先**：写作被建模成"按合同产出 → 提交 → 投影"的事务流，是五个项目里最接近数据库工程的。
2. **投影状态显式化**：`projection_status` 每个投影 `pending/done/skipped/failed`，加上 `story-events --health` 与 `preflight`，故障可定位、可重放。
3. **上下文打分 + 阶段权重**：把"该给模型看什么"变成可调参数，而不是拍脑袋的 top-k。
4. **hook 只保护真正不能手改的东西**：`state.json` 故意不锁，因为审计常需批量修，且它有备份 + 重建路径（注释里点了 issue #113）。这是"知道例外"的设计。
5. **CLI 化**：`preflight / doctor / events / health / dashboard` 让排障与自动化有抓手。

### 6.5 不足（有证据）

| 问题 | 证据 | 影响 |
| --- | --- | --- |
| GPL-3.0 | 仓库许可 | 商用/闭源集成几乎不可行 |
| 体量大、入口多 | 52k 行 Python、8 skills、5 投影 | 学习曲线陡；维护成本高 |
| 双写一致性无事务 | JSON 真源 + SQLite 投影分别写 | 崩溃/失败会留 pending，需人工修复 |
| 题材绑定 | Strand 比例、六维审查面向网文 | 非网文（文学、非虚构）适配差 |
| 历史文档堆积 | `docs/archive/` 大量阶段方案 | 新人难判断哪份有效 |
| 强绑 Claude Code | 插件协议 + hooks | 换宿主成本高 |

### 6.6 可优化点

1. **单库承载**：state/index/events 进同一个 SQLite，用事务消除双写，Markdown 只做导出。
2. **投影自动补偿**：失败自动重试 + 补偿队列 + 健康快照，减少人工 `retry`。
3. **权重自适应**：Strand 比例按题材/读者反馈学习，而不是全局常量。
4. **core 与宿主解耦**：脚本已相对独立，可做 CLI-first，插件只当薄壳。
5. **文档归档策略**：`docs/archive` 加"已废弃"索引，避免误读旧方案。


---

## 7. 横向对比

### 7.1 技术维度

| 维度 | STORM | GPT Researcher | InkOS | Oh Story | Webnovel |
| --- | --- | --- | --- | --- | --- |
| 编排范式 | 固定四段流水线 | 过程式 + 动态递归 | 运行时 + 能力注册 | Skill 契约 + hook | 合同 + 提交 + 投影 |
| 流程定义位置 | Python 类 | 一个 1148 行类 | Capability/Profile + Pipeline | SKILL.md + workflow 文件 | Python CLI + 合同 JSON |
| 状态真源 | 产物文件（信息表/大纲/正文） | 内存 context + 落盘报告 | work.json + artifact revision + episode | `_tracking-state.json` | `.story-system/commits/*.json` |
| 投影/派生 | 无 | 无 | Markdown 视图 + FTS 索引 | 上下文卡/伏笔/角色/时间线 | state/index/summary/memory/vector |
| 上下文治理 | 检索 top-k + 全量拼接 | 检索 + 摘要 + 向量 | protected/compressible + token 预算 + 语义压缩 | 按时刻加载 + 字数预算 + 35K 硬上限 | 打分排序 + 阶段权重 |
| 超预算行为 | 截断（隐式） | 压缩 | **报错**（fail-closed） | CI 阻断（开发期）/ 运行时提醒 | 按权重裁剪 |
| 校验强度 | 无 | 弱（引用 prompt） | 强（Zod + checksum + 证据） | 中（hook + 事务脚本） | 强（pydantic + 投影状态） |
| 恢复语义 | 阶段重跑 | 无 | Episode + 原子提交 + 恢复协议 | 事务草稿 + 提交检查 | commit + projection retry |
| 并发控制 | 线程池（最多 10） | asyncio 并发 | 进程队列 + 跨进程书锁 | 文件写锁 | 单进程脚本（未见强力锁） |
| 模型策略 | 5 个显式槽位 | 3 档（fast/smart/strategic） | 多 provider 路由 + 角色档 | 角色→模型写死 | 按 skill 配置 |
| 扩展点 | 四个阶段接口 | Skills + Provider | Capability + Skill 覆盖 | 新增 SKILL + reference | 新增投影 writer / 合同 |
| 可观测 | callback | WebSocket + 成本 | Episode 事件 + trace 文件 | session log + 缺口检测 | dashboard + health |
| 自动化测试 | 0 个测试文件 | 137 个 | 206 个 | 1 个 + 20+ 契约脚本 | 84 个 |
| 许可 | MIT | Apache-2.0 | AGPL-3.0 | MIT | GPL-3.0 |

### 7.2 四条范式路线的演化压力

#### 路线 A：固定流水线（STORM）
- 优势：可解释、可复现、便宜；每段都能单独重跑。
- 压力：一旦需要"根据中间结果改变计划"，就得在代码里加分支，最终变成 route B 的乱麻。
- 适用：一次性长文、研究复现、批量内容。

#### 路线 B：研究型动态 Agent（GPT Researcher）
- 优势：深度/广度可按需扩展；provider 矩阵覆盖广。
- 压力：动态决策带来的状态爆炸，没有统一状态模型时只能靠"内存 + 重跑"兜底；代码随报告类型线性膨胀。
- 适用：信息密集、结论导向的写作（研报、尽调、综述）。

#### 路线 C：自建 Harness（InkOS）
- 优势：完成语义、授权、版本、恢复都可控；能承载多形态产品。
- 压力：复杂度税。要养一个运行时团队，否则 spec 与实现会漂移。
- 适用：要做产品、要商业化、要多创作类型复用。

#### 路线 D：Skill 编排（Oh Story / Webnovel）
- 优势：上手快、贴着宿主生态、方法论沉淀直接可读；改动成本低。
- 压力：上限受宿主；一致性靠提示词 + hook，模型换版本就可能退化；无法做后台/服务化。
- 适用：个人作者、内容团队、方法论输出。

**判断**：这四条不是替代关系，而是"控制权"光谱。控制权越往代码移，可靠性越高、灵活性越低、成本越高。选哪档取决于"错误代价"——写研报错一次可以重跑；写 200 万字连载错一次要改几十章。

### 7.3 产品维度

| 维度 | STORM | GPT Researcher | InkOS | Oh Story | Webnovel |
| --- | --- | --- | --- | --- | --- |
| 目标用户 | 研究者、知识工作者 | 分析师、开发者 | 中文网文/剧本作者 + 开发者 | 中文网文作者 | 中文网文作者 |
| 交付形态 | 库 + demo | 库 + API + 云服务 | CLI + TUI + Studio + Agent | 插件 + Skill | 插件 + Dashboard |
| 上手成本 | 中（要配模型/检索） | 低（pip + 环境变量） | 中高（装 Node、建工作区） | 低（装插件） | 中（插件 + 项目初始化） |
| 质量承诺 | 论文级可复现 | 带引用的报告 | 可审计的交付 | 方法论 + 门禁 | 连载一致性 |
| 变现路径 | 学术影响 | 开源 + 云服务 | 开源 + 可能有商业版 | 开源 + 品牌/课程 | 开源 + 赞助 |
| 护城河 | 多视角提问方法 | provider 集成广度 | 运行时 + 真实旅程数据 | 写作方法论 + 预算制度 | 合同/投影工程 |
| 最大风险 | 停更 | 编排腐化 | 复杂度 + 许可 | 宿主依赖 | 许可 + 运维负担 |

一个观察：**star 高不等于"写作能力"强**。STORM 和 GPT Researcher 的高 star 来自"研究自动化"这个更宽的需求；真正面向创作者的三个项目 star 在 7k–10k，但工程密度明显更高。

### 7.4 共同失败模式：长文三难

五个项目都在解同一组问题，只是解法不同：

| 难题 | 表现 | 各家解法 |
| --- | --- | --- |
| 遗忘 | 角色设定、伏笔、已发生事件丢失 | 外部状态 + 投影（InkOS/Oh Story/Webnovel）；检索式证据池（STORM/GR） |
| 漂移 | 前后矛盾、OOC、时间线错乱 | 一致性审查（Webnovel 六维、InkOS continuity）；hook 门禁（Oh Story） |
| 失控 | 越写越长、跑题、模型自称完成 | 字数治理（InkOS）、章节范围上限（Oh Story 单轮 ≤3 章）、产物判定完成（InkOS） |

**没有项目解决"审美质量"**。所有质量机制都在管"事实与结构"，文笔好坏仍靠模型 + 人工。这是当前开源写作 Agent 的共同天花板，也是我们做产品时要诚实面对的地方。

---

## 8. 对本项目的可落地结论

本项目已有 `GraphRunner + EventPort`、端口/适配器分层、checkpoint、版本化产物（ADR 0009）、预算两层分离（技术方案 §15.3）。下面的建议按"是否与现有方向一致"分级，**不改变现有 ADR，只是增量参考**。

### 8.1 建议直接吸收（5 条）

1. **上下文分级 + 溢出失败**
   照 InkOS 的 `protected / compressible`：硬约束（当前章大纲、角色设定、用户明确要求）标 protected，超预算直接报错，不做静默截断。这与我们"预算两层分离"天然契合，实现上就是给每个 context fragment 加 `protection` 字段 + 编译函数。

2. **产物 revision + checksum 作为完成证据**
   ADR 0009 已有版本化产物；补两点：读取/审稿/导出都按 `revisionId` 解析并校验 checksum；模型看到的"完成"必须来自 `ActionResult.artifacts`，不接受自述。这条能直接消掉"改错版本""读到候选稿"两类 bug。

3. **授权矩阵按来源分叉**
   `risk(read/write/destructive-write) × source(user/agent) × confirmed` 决定是否执行。我们的门禁 interrupt 已有确认概念，补上"来源"维度即可区分"用户要求改"与"模型想改"。

4. **结构化错误带恢复指引**
   错误对象保留 `code` + `recovery`（下一步该调什么工具、哪个参数），而不是只给 message。InkOS 的实测表明这能显著减少模型瞎试。

5. **真源/投影分离写进文档与代码**
   权威状态用结构化格式（JSON/SQLite），Markdown 只做人类可读导出；索引可重建。三个中文项目独立收敛，说明这是长文写作的稳定解。

### 8.2 建议缓做（4 条）

1. 多 Agent 角色细分（先单 Agent + 显式阶段；角色拆分等流程稳定后再做）。
2. 五投影（先 state + summary 两投影，index/vector 后置）。
3. 多宿主适配（先单宿主跑通，适配层等有第二个真实需求再做）。
4. LLM 语义压缩器（先做预算 + 裁剪 + 告警，压缩器等上下文真的经常超再上）。

### 8.3 明确不抄（4 条）

1. **AGPL/GPL 代码直接集成**：架构可参考，代码不进产品。
2. **巨型 prompt 单文件**（GPT Researcher 的 `prompts.py` 903 行）：模板目录 + 版本化。
3. **按创作类型复制 runner**（InkOS 的 13 类各一套）：先抽公共阶段，再允许差异。
4. **把宿主 hook 当唯一门禁**（Oh Story）：门禁必须在自家运行时里，hook 只能当补充。

### 8.4 一个可执行的下一步（如果只做一件事）

给现有 GraphRunner 加一个**"Episode 事件流 + 产物 revision 校验"的最小闭环**：

- 每个动作 append 一条事件（started/completed/failed + actionId + result 摘要）；
- 完成判定只读 `result.artifacts[].revisionId` 并校验 checksum；
- 崩溃后从最后一条 completed 事件恢复，未完成的动作标记为 candidate 而非 current。

工作量约 1 个模块，但能同时获得：可恢复、可审计、可判定完成。这是五个项目里性价比最高的一块。

---

## 9. 待验证与风险

| 结论 | 可信度 | 需要什么验证 |
| --- | --- | --- |
| STORM 已停更 | 高（最后提交 2025-09-30） | 如需采用，先确认是否有活跃 fork |
| GPT Researcher 无 checkpoint | 中（未找到相关模块，未做全仓搜索式确认） | 精读 `agent.py` 全流程与 `backend/` |
| InkOS 首次完成率不足 | 高（项目自述） | 量化数据未公开，需自测 |
| Oh Story 35K 上限有效降本 | 中（有 prereg 实验设计，未见完整结果数据） | 读 `scripts/bench` 与 note 中的实验结论 |
| Webnovel 投影失败率低 | 低（无公开数据） | 看 issue 中 projection retry 相关讨论 |
| "三项目独立收敛到真源/投影" | 高（三份架构文档均明确写出） | — |

**风险提示**：本分析基于 2026-10-24 的快照，这 5 个项目更新都很快（尤其 InkOS），具体文件行号与模块划分可能已变。引用前先看 commit。

---

## 10. 附录：证据索引

| 结论 | 证据位置 |
| --- | --- |
| STORM 四阶段 + 5 个 LM 槽 | `knowledge_storm/storm_wiki/engine.py:21-170`、`:341-441` |
| STORM 并行多视角对话 | `knowledge_storm/storm_wiki/modules/knowledge_curation.py:286-393` |
| STORM 小节并发生成 | `knowledge_storm/storm_wiki/modules/article_generation.py:1-90` |
| STORM 无测试文件 | 仓库内 `test_*.py` 计数为 0 |
| Co-STORM 回合策略 | `knowledge_storm/collaborative_storm/engine.py:294-505` |
| GR 分层与文件定位 | `.claude/references/architecture.md`、`gpt_researcher/skills/*` |
| GR 编排分支 | `gpt_researcher/skills/researcher.py:97-245` |
| GR 深度研究 | `gpt_researcher/skills/deep_research.py:239-586` |
| GR 配置优先级 | `gpt_researcher/config/config.py`、`.claude/references/architecture.md` |
| InkOS 运行时与授权 | `packages/core/src/harness/runtime.ts:43-234` |
| InkOS 上下文预算 | `packages/core/src/harness/context-compiler.ts:84-175` |
| InkOS 契约 | `spec/creative-harness-v2.md`、`packages/core/src/harness/contracts.ts:1-60` |
| InkOS 重构自省 | `docs/harness-result-first-redesign.md` |
| Oh Story 三层架构 | `docs/architecture.md` |
| Oh Story 文档预算 | `scripts/doc-budget.json`、`.agents/notes/implemented/architecture/2026-09-26-per-call-load-ceiling-35k.md` |
| Oh Story 事务脚本 | `skills/story-long-write/scripts/tracking_commit.py`（1696 行） |
| Oh Story 阻断守卫 | `skills/story-setup/references/templates/hooks/guard-outline-before-prose.sh` |
| Webnovel 真源划分 | `docs/architecture/overview.md` |
| Webnovel 提交与投影 | `scripts/data_modules/chapter_commit_service.py:29-164` |
| Webnovel 上下文权重 | `scripts/data_modules/context_weights.py`、`context_ranker.py` |
| Webnovel hook 取舍 | `hooks/guard_runtime_write.py:12-24` |

_说明：行号基于上表 commit；引用前请以仓库当前 HEAD 复核。_
