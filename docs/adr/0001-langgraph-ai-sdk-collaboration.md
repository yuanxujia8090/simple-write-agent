# 0001：LangGraph 与 Vercel AI SDK 协作

- 状态：accepted
- 日期：2026-09-02

写作 Agent 使用 LangGraph.js 负责有状态流程编排：阶段路由、人工暂停、恢复、回退和 checkpoint（检查点）。Vercel AI SDK 在 LangGraph 的模型节点内部负责模型调用、工具接口和流式输出，避免两套 Agent Loop（Agent 循环）并存。这样保留 LangGraph 的可恢复流程能力，同时复用 Vercel AI SDK 的模型与流式能力。

## 考虑过的方案

- 由 Vercel AI SDK 的 `Agent` 独立运行循环：无法自然承载本项目的阶段回退和可恢复人工门禁。
- LangGraph 只管理外层阶段、AI SDK 管理内层循环：会形成两层循环，状态和错误边界不清晰。

## 影响

模型节点必须通过统一适配层调用 Vercel AI SDK；LangGraph 节点不得再直接创建另一套模型循环。具体模型兼容性仍需在实现阶段验证。
