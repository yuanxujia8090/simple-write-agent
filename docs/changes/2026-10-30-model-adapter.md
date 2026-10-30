# 变更：真实模型适配与本地配置入口

- 日期：2026-10-30
- 状态：已完成（真实模型烟测未运行）
- 关联需求：[需求](../wiki/01-prd-writing-agent.md) §3.3、§5.1
- 关联决策：[0001](../adr/0001-langgraph-ai-sdk-collaboration.md)
- 阶段方案：[真实模型适配与本地配置入口](../design/2026-10-30-model-adapter.md)

## 变更目的

在此之前模型结果全是脚本化假数据。现在填好 `.env.local` 就能用本机或云端的 OpenAI 兼容模型跑同一条闭环；没填模型名、服务连不上、模型返回结构不对，都给可读错误。

## 实际改动

- `.env.local`（新增，未入库）：模型与搜索字段模板，注释写明每项怎么填。
- `.gitignore`：新增 `.env.local`、`.env`。
- `src/config/env-file.ts`（新增）：`.env.local` 解析与加载；不覆盖已存在的 shell 变量。
- `src/model/chat.ts`（新增）：`ChatPort` 端口（结构化输出 + 流式事件 + 工具定义）。
- `src/model/ai-sdk.ts`（新增）：`@ai-sdk/openai-compatible` + `ai` 适配器；配置校验；错误翻译。
- `src/model/writing-model.ts`（新增）：7 个阶段的结构化调用，`PROMPTS` 集中定义。
- `src/agent/fixed-model.ts`：`WritingModel` 方法一律返回 Promise，脚本化实现包 async。
- `src/agent/graph.ts`：7 个生成节点改为 `await model.*`。
- `src/cli/main.ts`：启动时读 `.env.local`。
- `src/cli/replay.ts`、`src/cli/replay-main.ts`：新增 `--model mock|env`；输出模型来源。
- `src/runtime.ts`：持久化运行时接受 `model`。
- `package.json`：新增 `ai@7.0.157`、`@ai-sdk/openai-compatible@3.0.81`。
- 测试：`src/config/env-file.test.ts`（4 个）、`src/model/writing-model.test.ts`（7 个）。

## 验证

- 命令：`npm run typecheck`
  结果：通过，无输出。

- 命令：`npm test`
  结果：`Test Files 18 passed (18)`，`Tests 213 passed (213)`（上一阶段 202，新增 11）。

- 命令：`npm run build`
  结果：构建成功。

- 命令：`npm run replay -- --model mock`
  结果：`exported`；输出「模型：mock（脚本化固定结果）」；Trace 28 条。

- 命令：`npm run replay -- --model env`（`.env.local` 里模型名为空）
  结果：`重放失败：未配置模型 ID`，提示去填 `WRITING_AGENT_MODEL_ID`。

- 模型层测试覆盖：7 个 schemaName 与调用顺序、prompt 带上游内容、错误透传、流式事件契约（text / tool_call / finish）、配置校验（缺模型名、provider 不支持）。

- 命令：`git diff --check`
  结果：无输出（通过）。

## 未完成事项与风险

- **真实模型烟测未运行**：本机 `http://localhost:11434` 无服务；需要先启动 Ollama/LM Studio 并在 `.env.local` 填模型名。
- **SDK 流式与工具调用映射未端到端验证**：只验证了端口契约；真模型跑一次才能确认 `text-delta` / `tool-call` 解析。
- **无重试、限流、用量统计**：一次失败直接中止。
- **结构化输出依赖模型能力**：不支持 JSON schema 的模型会报错，不会降级解析自由文本。
- **风险：`.env.local` 误提交**：已加入 `.gitignore`；不要把它改名成 `.env` 提交（同样已忽略），也不要把真实密钥写进文档或测试。
- **风险：provider 兼容性**：不同 OpenAI 兼容服务的结构化输出支持不一样，同一份配置换服务可能需要复查。
