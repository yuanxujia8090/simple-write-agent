# 0001：LangGraph 与 Vercel AI SDK 协作

- 状态：accepted
- 日期：2026-09-02

写作 Agent 使用 LangGraph.js 负责有状态流程编排：阶段路由、人工暂停、恢复、回退和 checkpoint（检查点）。Vercel AI SDK 在 LangGraph 的模型节点内部负责模型调用、工具接口和流式输出，避免两套 Agent Loop（Agent 循环）并存。这样保留 LangGraph 的可恢复流程能力，同时复用 Vercel AI SDK 的模型与流式能力。

## 考虑过的方案

- 由 Vercel AI SDK 的 `Agent` 独立运行循环：无法自然承载本项目的阶段回退和可恢复人工门禁。
- LangGraph 只管理外层阶段、AI SDK 管理内层循环：会形成两层循环，状态和错误边界不清晰。

## 影响

模型节点必须通过统一适配层调用 Vercel AI SDK；LangGraph 节点不得再直接创建另一套模型循环。具体模型兼容性仍需在实现阶段验证。

## 机制细化（2026-09-07，补充而非取代）

落地机制进一步明确，完整设计见 `docs/design/2026-09-05-agent-technical-design.md` §15–17：

1. **工具循环归 AI SDK 驱动**：使用 `generateText({ tools, maxSteps })` / `streamText`，AI SDK 内部完成“模型请求工具 → 执行 → 结果回注 → 再次请求”；**不引入 LangGraph 的 ToolNode**，避免两套循环并存。
2. **maxSteps（最大工具步数）上限**：单次节点执行默认 3 步，防无界工具调用；与研究预算（跨节点、按轮次）分离计数。
3. **消息历史随 checkpoint 持久化**：LangGraph State 的 `messages` 字段随 SqliteSaver 落盘；恢复时整段重建 + 上下文组装器补静态部分。
4. **节点内不 interrupt**：流式生成中途不暂停，`interrupt()` 只在节点边界的门禁点。
5. **模型节点失败降级**：超时重试 1 次；tool calling 失败降级为纯文本流程（去掉 tools 重跑）。
