# 默认启用零配置兜底搜索（Bing RSS）

- 状态：accepted
- 日期：2026-11-04

## 背景

用户要求「至少得有一个兜底搜索能力，用户不一定会去配置第三方搜索」。本仓原先只有 `config.search` 字段，没有任何搜索实现；研究阶段完全依赖用户提供的本地素材。

同日实测（同一 UA、同一网络）四个零配置入口：

| 入口 | 结果 |
| --- | --- |
| Google `/search?q=` | 200 + 92KB，但无结果节点（`<h3>`=0、`/url?q=`=0），返回 JS 壳 |
| DuckDuckGo HTML / lite | 202 + 14KB 反爬页 |
| Mojeek | 验证码页 |
| Bing `?format=rss` | 200 + 10 条结构化 `<item>`（title/link/description），无跳转链接 |

## 决策

1. 兜底搜索用 **Bing RSS**，零 API key、零额外依赖（Node 全局 `fetch`）。
2. **默认开启**：每次创作前用话题搜一次，最多取 5 条，结果作为素材块并入 `StartInput.materials`。
3. 默认开启意味着**话题会发给 bing.com**。因此要求：
   - 启动日志必须打印一行外部搜索说明；
   - 提供 `--no-search` 完全关闭；
   - 帮助文本写明外发行为。
4. 搜索失败一律降级：只向 stderr 告警，不阻断创作，不伪造结果。
5. 本轮不实现 Tavily：`config.search` 字段保留，启动日志注明「本轮统一用 Bing RSS 兜底」，避免留下无法验证的代码。

## 后果

- 好处：不配置任何 key 也能拿到外部线索；接口形状沿用 Hermes Agent 的 `{title,url,description,position}`，以后加 Tavily 不用改上层。
- 代价：结果质量与可用性受 Bing 制约（本地化按出口 IP 猜、可能限流、改版即失效）；搜索内容**未经核实**，只能当线索，事实核查规则（ADR 0004）不变。
- 隐私：默认外发话题。介意时用 `--no-search`；启动日志会让这件事每次都可见。

## 相关

- 方案：`docs/design/2026-11-04-search-provider.md`
- 借鉴对象：Hermes Agent v0.20.0 `plugins/web/ddgs/provider.py`（零配置兜底用 `ddgs` 包、失败返回 `{success:false}`、单次搜索硬超时 + 子进程隔离）
