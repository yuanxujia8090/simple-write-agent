# 从写作到客服：Agent 项目设计与当前架构检查

- 日期：2026-10-28
- 性质：学习材料与设计分析；不是新的架构批准，也不是业务实施记录
- 关联需求：用户询问如何设计 Agent 项目、三个典型行业案例，以及当前项目需补充的设计
- 网页入口：[可交互架构学习手册](2026-10-28-agent-architecture-guide.html)
- 范围：新增学习网页及本说明；保留需求、设计、计划、配置和既有用户修改

## 结论

当前项目适合“程序控制固定阶段 + 模型在局部选择工具与生成内容 + 作者确认关键结果”，不建议为了学习架构而先增加多智能体、向量数据库或自动发布。

已按推荐选了“单文件交互学习手册”，因为用户需要看懂输入输出和控制权，不需要先做视觉选型。全部页面交互在本地完成，不调用模型、不访问业务接口。视觉采用纸色正文、深绿流程、虚线人工确认；它是学习说明，不是产品界面改版。

技术建议仍是建议，不改既有架构决策。需变更技术路线或范围时另行处理；本次没有创建接受状态的新架构决策，也没有把候选建议写进实施计划。

## 一、当前项目事实

已读取：

- `agents.md`：项目以学习实践为目标，默认分析不改业务文件。
- `docs/wiki/01-prd-writing-agent.md`：单人本地、公众号长文、输入简报、研究、论点、大纲、草稿、审查、导出；明确排除多租户、自动发布、向量数据库。
- `docs/design/2026-09-05-agent-technical-design.md`：分层、流程运行器、模型适配、存储、确认、上下文、恢复与预算。
- `docs/plan/00-plan.md`：最小闭环原则、从脚手架开始的待办、安全与真实评测要求。
- `docs/adr/0001-langgraph-ai-sdk-collaboration.md`：LangGraph.js 编排、Vercel AI SDK 节点内调用。
- `docs/adr/0004-fact-checking-boundary.md`：规则层只验证可追溯性，不验证语义真伪。
- `docs/adr/0009-versioned-artifact-gate-commit.md`：确认绑定版本，业务状态与检查点原子提交要求。
- `docs/adr/0010-learning-first-incremental-validation.md`、`docs/learning/2026-10-19-review-loop.md`：学习与项目双向联动、证据验收。
- `docs/design/2026-10-19-prd-plan-learning-review.md`、`docs/design/2026-10-24-open-source-writing-agent-architectures.md`：历史审查与候选建议。

仓库清单当前以文档、主题样例和编辑器/会话配置为主，实施计划从脚手架起仍待推进。因此本文评价设计的完备性，不评价已运行代码的正确性。

已读取学习工作区：

- `/Users/yuanxj/Documents/knowledge-space/learn-agent/agent-learning/progress/PROGRESS.md`
- `/Users/yuanxj/Documents/knowledge-space/learn-agent/agent-learning/progress/LOGBOOK.md` 最近记录

学习记录的下一个动作仍包括检索链路输入输出和故障归因复测。本文按“输入、输出、负责方、验收”解释；阅读学习材料不能代替答题和实践，不更新学习分数与掌握状态。

## 二、如何设计 Agent 项目

Agent（能够根据任务目标与工具结果选择下一步行动的智能程序）不必覆盖整个产品。固定步骤由程序控制，只有不确定的局部任务交给模型。

建议顺序：

1. **确定结果**：写作交付可编辑主稿；客服交付真实解决或带上下文转人工。回答文本不是唯一成功标准。
2. **列真实任务**：至少包括成功、信息不足、工具失败、用户反悔、重复请求、中断六类情境。
3. **拆输入输出**：每步拿哪个版本、交付什么结构、谁校验、失败去哪。
4. **分控制权**：程序管身份、授权、预算、状态、写入、完成；模型管理解、候选、允许范围内的工具选择；人管价值判断与高风险批准。
5. **定义工具合同**：参数和返回结构、允许范围、超时、是否有副作用、如何核对成功、能否安全重复。
6. **定义状态与恢复**：会话状态、任务状态、内容版本、检查点、执行记录分开；超时结果不明时先对账。
7. **定义评测和运行**：固定样本、人工参考、可执行规则、成本与耗时；最小闭环先于完整目录。

### 写作与客服的区别

| 维度 | 写作 | 客服 |
| --- | --- | --- |
| 主组织方式 | 稿件按阶段推进 | 按请求类别分流，多轮处理 |
| 模型适合承担 | 简报理解、研究、论点、写作 | 意图判断、知识解释、参数提取 |
| 主要事实源 | 采纳素材与来源快照 | 授权知识、当前账号的订单与业务系统 |
| 高风险 | 覆盖用户稿件、虚构事实、素材外传 | 越权查询、错误承诺、重复改签退款 |
| 恢复证据 | 文件指纹、版本、确认与动作记录 | 业务操作编号、状态查询、去重键 |
| 成功判据 | 作者可用稿件、证据质量、修改量 | 真实解决率、正确接管、业务执行结果 |

客服推荐分为知识问答、业务查询、业务办理三条路径。业务办理必须经过程序授权和真实业务结果校验。多角色转交不是权限提升，模型的成功文本也不是业务凭证。

## 三、三个典型架构案例

这里的“典型”指能代表公开可核对的架构模式，不是生产效果排行榜。

### 1. STORM：固定流水线，研究内部多视角

STORM（Synthesis of Topic Outlines through Retrieval and Multi-perspective Question Asking，通过检索和多视角提问形成主题大纲）原始主流程：

```text
主题 → 多视角研究与来源 → 大纲 → 分节生成文章 → 润色与文件
```

- 外层由 `STORMWikiRunner.run()`（写作主流程入口）安排阶段。
- 研究模块模拟多视角提问与检索回答，可并发执行；外层固定不等于内部只有一个模型调用。
- 本案例分析原始 STORM，不混入 Co-STORM 交互讨论架构。
- 借鉴：先研究再写、阶段产物与来源链。
- 限制：百科写作不等于作者表达，文件产出不等于版本化人工确认和可靠恢复。

证据：

- [官方说明](https://github.com/stanford-oval/storm/blob/fb951af7744dab086e34962e9bc6fe878e145f83/README.md)
- [主流程](https://github.com/stanford-oval/storm/blob/fb951af7744dab086e34962e9bc6fe878e145f83/knowledge_storm/storm_wiki/engine.py)
- [研究模块](https://github.com/stanford-oval/storm/blob/fb951af7744dab086e34962e9bc6fe878e145f83/knowledge_storm/storm_wiki/modules/knowledge_curation.py)

### 2. Open Deep Research：主管与研究员

```text
澄清 → 研究简报 → 主管分派 → 多个研究员独立研究
                         ↑           ↓
                         └─ 汇总、补查
                              ↓
                           统一写报告
```

- 主管动态决定子题与分工；研究员用独立上下文执行工具循环。
- 研究员整理带来源的发现再交主管，避免把大量原始网页全部上交。
- 主管迭代、研究员工具循环和并发数量有配置限制。
- 官方文章明确提到：并行写不同章节曾造成割裂，因此多角色主要用于研究，最终统一写报告。
- 借鉴：研究简报、子题隔离、结构化交接。
- 当前不建议直接引入：本项目尚未证明普通长文需要多研究员；先借数据合同，不借角色数量。

证据：

- [官方架构文章](https://www.langchain.com/blog/open-deep-research)
- [主流程源码](https://github.com/langchain-ai/open_deep_research/blob/1b7d2e80db9faa586165c60e09096dbbfd483a64/src/open_deep_research/deep_researcher.py)

### 3. OpenAI 航空客服示例：角色转交

```text
分诊角色 ↔ 常见问答角色 → 关键词查询工具
    ↕
选座角色 → 更新内存座位工具
```

Handoff（对话转交）是改变当前处理角色；通常携带对话历史，也可以配置过滤。它不是多个角色并行回答。

- 常见问答工具用关键词分支返回预设内容。
- 选座工具修改共享内存中的确认号和座位。
- 转交回调随机生成航班号。
- 运行器继续保存对话项、共享业务上下文和最后处理角色。
- 该示例不展示真实订票身份核验、座位库存、持久化或业务事务，不能包装成生产客服。

借鉴角色工具隔离、转回分诊和对话延续。上线仍需服务端授权、真实业务凭据、客户确认、重复动作去重和人工接管。

证据：

- [官方客服示例源码](https://github.com/openai/openai-agents-python/blob/cd26bbbc52847845fde73b9952b51e62e2bcbdc0/examples/customer_service/main.py)
- [官方转交文档](https://openai.github.io/openai-agents-python/handoffs/)

## 四、当前项目需要补什么

### 已经设计过，不应重复报为缺失

阶段工作流、人工确认、产物版本与指纹、外部编辑检测、研究预算、作者档案、来源可追溯性、真实模型验证、安全演练和固定样本评测，都已写入当前需求、设计或计划。

真正需要补的是实施合同和冲突收敛，而不是重新加同名模块。

| 顺序 | 现状 / 问题 / 影响 | 建议与可复核验收 |
| --- | --- | --- |
| 先验证提交边界 | 现有决策要求业务表与检查点同事务；同时直接透传现成保存器。共享数据库文件不能证明共享事务，文件写入又在事务之外。可能出现版本、确认和恢复点不一致。 | 锁定依赖后实验同一提交边界；文件以独立版本写入再关联状态，启动对账。在关键写入位置中断，恢复应得到唯一有效版本。 |
| 先统一暂停与取消 | “阶段完成保存”“取消不保存”“Ctrl+C 保存并回主界面”多种描述并存；恢复会从暂停节点开头重跑。可能重复副作用或丢掉批量待写事件。 | 生成与确认拆开；明确取消状态、动作编号、结果与重放边界。重复恢复、重复确认和迟到结果都不能错误推进。 |
| 补工具级安全与隐私 | 已有安全原则，但路径、符号链接、网页跳转、私网访问、搜索词外传边界需具体化。 | 真实路径检查、网络限制、体积与时间限制、资料与指令隔离；外部模型/搜索明确发送范围。用恶意网页、越界路径、跳转本机地址验证。 |
| 补逐节点上下文合同 | 文档说稿件按需读，同时写作节点无模型工具；档案注入、重载、历史去重也需统一。可能丢大纲或读旧稿。 | 程序预读指定版本；列输入输出与保护字段；关键内容超限停止。实际核对改大纲、重载、超限与消息失效后的模型请求。 |
| 明确证据层级 | 已限定只做可追溯，不做自动语义真伪判定。真实链接仍可能不支持具体结论。 | 关联声明、原文摘录、位置、快照与稿件版本；标“可追溯”不标“已证实”。自动逐句语义判定仍后置，不能擅自扩大范围。 |
| 把评测要求变成实际样本 | 计划已提出评测，具体样本、参考、规则与界限待落地。批准率不等于事实质量。 | 建议先 6–10 个小样本；比较直接写与完整流程，记录人工修改、证据缺口、耗时、用量。样本数量是建议，不是行业统一标准。 |
| 核对版本与总预算 | 设计使用历史模型接口写法；工具步数不等于调用次数，重试和重放可能放大预算。 | 实际版本中核对循环停止接口；适配层映射；跨会话记录模型调用、工具读取、总耗时和用量上限；验证批量工具和恢复计数。 |
| 用薄闭环推进并补运行说明 | 原则要求闭环，任务仍按组件分波；单实例锁、备份、日志和升级恢复须变成具体运行规则。 | 从本地素材到短文导出，再叠加恢复和外部编辑；首轮留下实际运行与恢复证据，后续补齐原有功能，不删减范围。 |

### 两个必须先做的小实验

1. **暂停重放实验**：生成候选 → 独立确认节点暂停 → 恢复，观察哪些代码重复；确认重复提交不重复生成或覆盖。
2. **提交一致性实验**：用实际版本的检查点保存器，验证业务状态与检查点能否真正共享提交边界；在文件、数据库和检查点各边界中断，再恢复核对。

这只是建议，本次不执行写作程序的实验或业务改造。

### 与历史建议的区别

`2026-10-24-open-source-writing-agent-architectures.md` 曾建议让结构化数据做唯一真源、Markdown 做投影。但当前已接受决策明确主稿文件是内容权威。不能用历史研究建议悄悄改掉该决定。本次沿用文件权威，补的是版本关联、提交和恢复对账。

## 五、资料口径与限制

- [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)：经典模式来源，原文提示工具生态已变化。借鉴设计原则，不把旧接口当当前接口。
- [LangGraph 暂停恢复](https://docs.langchain.com/oss/javascript/langgraph/interrupts)：恢复会重跑暂停节点；之前的副作用要可安全重复或隔离。
- [SqliteSaver 源码](https://github.com/langchain-ai/langgraphjs/blob/b5f96bdac43542a053a80cb4b056d710cf46393c/libs/checkpoint-sqlite/src/index.ts)：构造器接收数据库对象，写入含异步序列化；存在内部写入事务。需要实验集成，不能据此直接断言一定能或一定不能加入自家业务事务。
- [Vercel AI SDK 工具调用](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling)：当前文档使用 `stopWhen`（循环停止条件）等方式描述多步调用。项目尚无实际安装版本，本文提示兼容性核对，不诊断既有代码故障。
- [上下文工程](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)：输入筛选与上下文管理。
- [Agent 评测](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)：以实际任务、评分与运行结果评估系统。

查询日期为 2026-10-28。仓库源码链接固定到读取时的提交；在线文章可能更新。本次不比较生产性能、不背书行业排名，也不声称三个案例已有相同级别的安全与恢复能力。

## 六、验证记录

### 实际验证结果

使用本机已有 Playwright（控制浏览器执行交互检查的工具）与 Google Chrome 无界面模式，直接打开本地网页，**23 / 23 项检查通过**：

- 中文标题与默认案例；三个案例切换；各案例逐步说明到达终点、返回起点及按钮边界；全部案例顺序阅读。
- 三个故障场景切换；自检答案展开；8 个页内导航目标；10 个本地文档链接。
- 桌面 1440 像素和手机 390 像素宽度检查，页面宽度分别为 1440 和 390；手机案例切换。
- 关闭脚本仍显示三个案例；打印样式包含全部案例；页面脚本错误 0、自动外部请求 0。

另外核对页面 15 个唯一编号和 41 个链接；任务前记录的 29 个已有文件内容指纹逐一保持一致。

本次生成的本机临时证据（不属于长期项目文件）：

- `/tmp/my-write-agent-architecture-verification.json`：23 项检查结果。
- `/tmp/my-write-agent-architecture-desktop.png`：桌面截图。
- `/tmp/my-write-agent-architecture-mobile.png`：手机截图。
- `/tmp/my-write-agent-20261028-before-architecture-learning.json`：已有文件内容指纹基线。

**限制**：当前模型不支持查看图片附件，因此没有完成肉眼视觉审阅；截图只作为运行产物，不能冒充已观察的视觉证据。写作业务程序的模型、搜索、恢复与事务实验均未运行，不把网页检查写成业务验证。

### 最小复现命令

在当前项目根目录运行。命令使用本机现有工具，不安装依赖；复现核心交互，不声称覆盖上面全部 23 项：

```bash
node <<'JS'
const { chromium } = require('/Users/yuanxj/.bun/install/cache/playwright-core@1.64.1@@@1/index.js');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('file://' + process.cwd() + '/docs/learning/2026-10-28-agent-architecture-guide.html');
    await page.locator('[data-case="deep"]').click();
    assert(await page.locator('#case-deep').isVisible());
    for (let i = 0; i < 4; i++) {
      await page.locator('[data-step="deep"][data-delta="1"]').click();
    }
    assert((await page.locator('#deep-step').innerText()).includes('第 5 / 5 步'));
    await page.locator('[data-scenario="refund"]').click();
    assert((await page.locator('#scenario-result').innerText()).includes('先查业务结果'));
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
    console.log('5 项核心交互与布局检查通过');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
JS
```

工具缓存路径属于本机环境；换机器时使用当地已安装的 Playwright 和 Chrome 路径。

复现命令首次使用外层 `playwright` 包时，普通 Node.js 环境报错 `Cannot find module 'playwright-core'`；原因是本机缓存目录的依赖解析方式与验证工具运行环境不同。已改为直接使用实际存在的 `playwright-core` 入口，不安装或修改项目依赖；实际执行修正后的上述命令，退出码 0，输出“5 项核心交互与布局检查通过”。完整浏览器 23 项结果来自前述实际运行，不能与这次命令环境错误混为一谈。
