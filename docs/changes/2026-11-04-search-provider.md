# 变更：零配置兜底搜索（Bing RSS）

- 日期：2026-11-04
- 状态：已完成
- 关联需求：用户要求「至少得有一个兜底搜索能力，用户不一定会去配置第三方搜索」
- 关联决策：[ADR 0013](../adr/0013-default-external-search-bing-rss.md)
- 关联方案：[`docs/design/2026-11-04-search-provider.md`](../design/2026-11-04-search-provider.md)

## 变更目的

不配置任何 API key 时，创作前能拿到外部搜索结果作为素材线索，并在日志里说清用了什么引擎、命中几条、失败原因。

## 实际改动

- `src/search/types.ts`（新增）：`SearchPort` 接口、`SearchOutcome` 判别联合、`SearchHit`（title/url/description/position）、`DEFAULT_SEARCH_LIMIT=5`。
- `src/search/bing-rss.ts`（新增）：
  - `parseBingRss`：解析 `<item>`，处理 CDATA、HTML 实体、去标签，缺 title/link 跳过；
  - `createBingRssSearch`：`fetch` + `AbortSignal.timeout(8000)`；请求不带 `mkt`/`cc`/`setlang`（实测带上返回 0 条）；非 2xx、0 条、网络异常都返回 `{ok:false,error}`。
- `src/search/index.ts`（新增）：`formatHitsForMaterials` 生成带「未经核实 / 保留链接」声明的素材块，摘要截断 200 字。
- `src/search/bing-rss.test.ts`、`src/search/index.test.ts`（新增）：13 个离线用例。
- `src/cli/main.ts`：启动检查阶段把搜索结果并入 `StartInput.materials`，日志打印命中条数；失败只写 stderr 警告，创作继续。
- `src/cli/args.ts`、`src/cli/help.ts`：新增 `--no-search`，帮助与启动说明写明默认会外发话题。
- `src/cli/main.test.ts`：单测默认注入 stub 搜索（不联网），新增「并入素材」「`--no-search` 零调用」「失败继续」3 个用例。
- `docs/adr/0013-default-external-search-bing-rss.md`（新增）：记录默认外发的决策与开关。
- `docs/design/2026-11-04-search-provider.md`：补 Hermes 借鉴对比与「实际结果」。

## 验证

- 命令：`npm run typecheck` → 通过。
- 命令：`npm test` → `Test Files 25 passed (25)`、`Tests 281 passed (281)`。
- 命令：`npm run build` → 通过。
- 命令：`node dist/cli.js --file … --topic "本地写作 Agent 的素材入 CLI" --fast --yes`
  → 日志 `外部搜索：bing-rss，命中 5 条（已并入素材；来源 bing.com）`，随后 `创作结果：exported`，导出 md 与 html。
- 命令：同一条加 `--no-search` → 日志 `外部搜索：已关闭（--no-search）`，`创作结果：exported`，未发外部请求。
- 离线：`bing-rss.test.ts` 断言请求地址含 `format=rss`、不含 `mkt/cc/setlang`，HTTP 503 与网络异常均返回可读失败。

## 未完成事项与风险

- **Tavily 未实现**：`config.search` 字段保留；启动日志写「本轮统一用 Bing RSS 兜底」，避免留下无法验证的代码。
- **T9 完整项未做**：`ResearchPlan`、候选保留/淘汰原因、研究预算硬约束、连续失败暂停让用户跳过、来源验证状态入库。
- **采纳门禁**：搜索结果直接进素材清单，不单独过一次 AdoptionGate。
- **只用摘要**：不抓正文，引用需人工核实。
- **可用性受 Bing 制约**：本地化按出口 IP 猜（英文查询可能返回非中文结果）、可能限流、改版即失效。失败会明确告警，不会伪造结果。
- **真实模型稳定性观察**：一次真实模型运行在 `drafting` 阶段结构校验失败（`创作结果：failed`，门禁 1 次），紧接另一次同命令成功。与搜索无直接因果，需单独跟进。
- 本轮验证产生了真实模型调用费用（3 次运行，其中 2 次成功、1 次失败），未计量金额。
