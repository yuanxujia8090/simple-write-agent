# 阶段方案：零配置搜索兜底（Bing RSS）

- 日期：2026-11-04
- 关联决策：新增 [ADR 0013](../adr/0013-default-external-search-bing-rss.md)（默认把话题发给 bing.com，可用 `--no-search` 关闭）
- 关联计划：`docs/plan/00-plan.md` §1.3「补齐已确认产品能力」中的搜索提供方（T9 的最小切片）
- 起因：2026-11-04 用户提出「至少得有一个兜底搜索能力，用户不一定会配置第三方搜索」。同日实测：Google 返回 JS 壳、DuckDuckGo 与 Mojeek 返回验证码、Bing 的 `format=rss` 返回 10 条结构化结果。

## 1. 目标

阶段结束后：**不配置任何 key，也能让 Agent 拿到外部搜索结果**；搜索结果作为素材进入创作，并在日志里说清「用了哪个引擎、命中几条、失败原因」。

## 2. 范围

**包含**

- `SearchPort`（搜索端口）接口与 `BingRssSearch` 实现（`src/search/`）。
- CLI 默认在开始创作前搜一次话题，把命中结果格式化成素材块，追加到 `StartInput.materials`。
- `--no-search` 关闭搜索；启动日志明示是否外发话题。
- 失败处理：搜索失败只告警，不阻断创作；不假装搜到。

**不包含（本轮明确不做）**

- Tavily 实现。`config.search` 已有字段但没有代码，本轮保持"接口留位、不写实现"，避免多一份无法验证的代码。
- 完整 T9：`ResearchPlan`（研究计划）、候选保留/淘汰原因、研究预算硬约束、连续失败暂停让用户选择跳过、来源验证状态入库。
- 搜索结果的采纳门禁：本轮搜索内容直接进素材清单，不单独过一次 AdoptionGate。
- 网页正文抓取（只取搜索结果里的标题、链接、摘要）。

## 3. 数据流

```text
CLI 参数（--topic / --file）
  ↓
topic 确定（--topic 优先，否则素材文件名）
  ↓ 未给 --no-search
BingRssSearch.search(topic)  ── 失败 ──→ stderr 告警，materials 不变
  ↓ 命中
格式化：每条「[外部搜索] 标题 / URL / 摘要(≤200 字)」，最多 5 条
  ↓
StartInput.materials = [用户素材..., 搜索结果块...]
  ↓
research 节点 → materials 阶段整理成素材清单 → 后续阶段按原流程
```

## 4. 关键规则

1. **搜索是兜底，不是主搜索**：默认上限 5 条，只取标题、链接、摘要。
2. **失败必须可见**：网络错误、非 2xx、0 条结果，都在 stderr 写明原因；不静默当作"没搜到也没关系"。
3. **不虚构来源**：搜索结果块带原始 URL；模型若在正文引用，事实核查阶段按现有规则处理（ADR 0004）。
4. **隐私可见**：默认开启意味着话题会发给 bing.com，启动日志必须打印一行说明；`--no-search` 可关闭。
5. **不加隐藏参数**：实测 `mkt` / `cc` / `setlang` 会让 Bing RSS 返回 0 条，实现里不传这些参数。

## 5. 失败处理

| 情况 | 行为 |
| --- | --- |
| 网络错误 / 超时（8s） | stderr 一行告警，继续用本地素材创作 |
| HTTP 非 2xx | 同上，附状态码 |
| 返回 0 条 | 告警「没有命中结果」，不写空块进 materials |
| XML 结构变化、解析失败 | 告警「无法解析搜索结果」，按失败处理，不抛到编排层 |
| 用户传了 `--no-search` | 完全不发请求 |

## 5.1 借鉴 Hermes Agent（`~/.hermes/hermes-agent` v0.20.0）

读实现后的对比结论：

| Hermes 做法 | 本仓是否借鉴 | 落地 |
| --- | --- | --- |
| 多后端注册表（tavily / exa / parallel / firecrawl / searxng / brave-free / ddgs），按配置 → key 探测 → 包可 import 探测 → 插件注册依次选 | 采纳选型顺序 | 本轮只做两个层级：无 key → Bing RSS；接口保留 provider 字段 |
| 零 key 兜底用 `ddgs` Python 包，不手写 HTML 抓取 | **不采纳实现，采纳原则** | Node 无同等维护的库；Bing RSS 是结构化 XML，比 DDG 的 202/验证码页面稳 |
| 搜索失败返回 `{success:false, error}`，不抛到编排层 | 采纳 | `SearchOutcome` 判别联合，不抛异常 |
| 结果形状 `{title,url,description,position}` | 采纳 | `SearchHit` 同字段 |
| 单次搜索硬超时 + 子进程隔离（原文理由：`ddgs`/`primp` 在 native 代码里阻塞并持有 Python GIL，线程池 timeout 也救不了） | 采纳原则 | Node 用 `fetch` + `AbortSignal.timeout(8000)`；将来若换同步解析库必须走 worker |
| search 与 extract 分开选后端 | 本轮不做 | 无正文提取需求 |

## 6. 验证方法

```bash
npm run typecheck
npm test
# 离线：解析器用固定 RSS 样本，错误路径注入 fake fetch
# 在线（可选，需网络）：node dist/cli.js --topic "…" 观察「外部搜索」日志行
npm run dev -- --file ./_selftest_2026-11-03/素材-本地AI写作工具.md --topic "…" --fast --yes
npm run dev -- --file … --no-search --fast --yes   # 确认不发请求
```

## 7. 实际结果（2026-11-04 收尾）

- `src/search/types.ts`：`SearchPort`、`SearchOutcome` 判别联合、`SearchHit{title,url,description,position}`、默认上限 5 条。
- `src/search/bing-rss.ts`：`parseBingRss`（CDATA、HTML 实体、去标签、缺字段跳过）+ `createBingRssSearch`（`fetch` + `AbortSignal.timeout(8000)`，非 2xx / 0 条 / 网络异常都返回 `{ok:false,error}`，不抛）。
- `src/search/index.ts`：`formatHitsForMaterials` 把结果拼成带「未经核实」声明的素材块，摘要截断 200 字。
- `src/cli/`：`--no-search`；默认在启动检查阶段搜一次话题并并入素材，日志打印 `外部搜索：bing-rss，命中 N 条`；失败只告警。
- 测试：`src/search/bing-rss.test.ts`（10 个）、`src/search/index.test.ts`（3 个）、`src/cli/main.test.ts` 新增 3 个（并入素材 / `--no-search` 零调用 / 失败继续）。
- 实跑（固定与真实模型各一次）：`外部搜索：bing-rss，命中 5 条（已并入素材；来源 bing.com）`，创作到 `exported`。
- 已知风险：一次真实模型运行在 `drafting` 阶段失败（结构校验未过，门禁 1 次），紧接的另一次同命令成功。属真实模型输出稳定性问题，与搜索无直接因果，需单独跟进。
