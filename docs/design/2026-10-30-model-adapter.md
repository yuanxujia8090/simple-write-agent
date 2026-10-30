# 阶段方案：真实模型适配与本地配置入口

- 日期：2026-10-30
- 状态：已完成（真实模型烟测未运行）
- 关联需求：[需求](../wiki/01-prd-writing-agent.md) §3.3、§5.1
- 关联决策：[0001](../adr/0001-langgraph-ai-sdk-collaboration.md)（LangGraph 管阶段、AI SDK 只在节点内调用）
- 主计划：[00-plan.md §6 T7](../plan/00-plan.md)
- 上一阶段：[主题配置与确定性 HTML 导出](2026-10-30-theme-html-export.md)

## 1. 目标

把「脚本化固定结果」换成一个可以接真实模型的实现：填好 `.env.local` 后，同一条重放命令就会真的去调本地或云端模型；模型返回不符合结构、连不上、模型名没填，都要给出人话错误，而不是继续往下写。

## 2. 范围

### 包含

1. **本地配置入口**：项目根目录 `.env.local`（已在 `.gitignore` 中忽略），预留模型与搜索字段；启动与重放时读取，已存在的 shell 变量优先。
2. **模型端口**：`ChatPort`（结构化输出 `generateObject` + 流式 `streamText`），编排层只依赖这个端口。
3. **AI SDK 适配器**：`createAiSdkChat()` 用 `ai` + `@ai-sdk/openai-compatible`，支持 OpenAI 兼容接口（Ollama、LM Studio、DeepSeek 等）；缺模型名、provider 不支持时直接报可读错误；SDK 异常翻译成 `AppError("RUNTIME")`。
4. **真实模型版 `WritingModel`**：7 个阶段各一次结构化调用，prompt 集中在一处便于回看；用 zod 校验模型输出结构。
5. **异步化模型端口**：`WritingModel` 方法改为一律返回 Promise，编排节点 `await`；脚本化实现同步逻辑包一层 async。
6. **重放开关**：`npm run replay -- --model mock|env`，默认 `mock`；`env` 时读 `.env.local` + `config.json` 取模型配置。

### 不包含

- 真实搜索（T9）、工具注册与权限（T8）、流式输出接到界面（T13）。
- 重试、限流、成本统计、多模型路由。
- 真实模型跑通一篇完整文章的验收（需要本机模型服务，见「未验证」）。

### 已知边界

- **每次调用无重试**：模型报错直接冒泡到 `RunState.error`。重试策略留给编排层统一做（现状是失败即停，符合「不盲目重试」的约定）。
- **结构化输出依赖提供方能力**：走 AI SDK 的 `generateObject`；不支持结构化输出的模型会返回错误而不是降级成「解析自由文本」。
- **流式与工具调用只有端口契约**：`streamText` 已能把文本、`tool_call`、`finish` 事件交出去，但没有任何界面消费，SDK 侧的事件映射未用假模型覆盖。

## 3. 数据流

```text
.env.local ──loadLocalEnvFile──▶ process.env
                                    │
config.json ────────────────────────┼──▶ loadConfig() → ModelConfig
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
        createAiSdkChat(model)            （未配置时）fixedModel
                    │
        createAiWritingModel(chat)
                    │
         WritingModel（7 个 async 方法）
                    │
        LangGraph 节点 await 后交给 WorkflowService
```

## 4. 关键规则

- 编排节点不得绕过 `WritingModel` 直接调 SDK：阶段路由、门禁、重做都在图里。
- 模型输出先过 zod，再进 `saveTemporaryArtifact`；结构不符就是错误，不静默修补。
- 模型名、接口类型缺失时不发请求，`AppError("CONFIG")` 带具体怎么填的提示。
- `.env.local` 不进入版本库；文档只写字段名，不写任何真实密钥。
- shell 里显式设置的变量优先于 `.env.local`，便于临时覆盖。

## 5. 验证方法

- `npm run typecheck`、`npm test`、`npm run build`。
- `npm run replay -- --model mock`：行为与上一阶段一致（5 道门禁 → exported）。
- `npm run replay -- --model env` 在未填模型名时：给出「未配置模型 ID」而不是崩栈。
- 模型层单测：7 个 schema 名与顺序、prompt 带上游内容、错误透传、流式事件契约、配置校验。
- 真实模型烟测：需要本机服务与模型名，未运行（见 §7.4）。

## 6. 任务拆分

| 序 | 内容 | 产物 |
| --- | --- | --- |
| 1 | `.env.local` 模板与忽略规则 | `.env.local`、`.gitignore` |
| 2 | 环境文件解析与加载 | `src/config/env-file.ts` |
| 3 | 模型端口 | `src/model/chat.ts` |
| 4 | AI SDK 适配器 | `src/model/ai-sdk.ts` |
| 5 | 真实模型版 WritingModel + 模型端口异步化 | `src/model/writing-model.ts`、`src/agent/fixed-model.ts`、`src/agent/graph.ts` |
| 6 | 重放开关与运行时接线 | `src/cli/replay.ts`、`src/cli/replay-main.ts`、`src/runtime.ts`、`src/cli/main.ts` |
| 7 | 测试 | `src/config/env-file.test.ts`、`src/model/writing-model.test.ts` |

## 7. 实际结果

### 7.1 已交付

- `.env.local` 模板：provider / baseURL / modelId / apiKey + 搜索占位；`.gitignore` 增加 `.env.local`、`.env`。
- `src/config/env-file.ts`：`parseEnvText`、`loadLocalEnvFile`；注释、引号、`export` 前缀、空值覆盖规则都有测试。
- `src/model/chat.ts`：`ChatPort`、`ObjectRequest/Result`、`StreamEvent`（text / tool_call / error / finish）。
- `src/model/ai-sdk.ts`：`assertUsableModelConfig` 与 `createAiSdkChat`；SDK 错误统一转 `AppError("RUNTIME")`；工具定义转 `ToolSet`。
- `src/model/writing-model.ts`：7 个阶段的结构化调用 + `PROMPTS` 集中定义。
- `WritingModel` 全异步：`fixedModel` 包 async，图上 7 个生成节点改为 `await`。
- 接线：`writing-agent` 启动时读 `.env.local`；`replay --model env` 用配置里的真实模型。

### 7.2 实测

- `npm run typecheck`：通过。
- `npm test`：`Test Files 18 passed (18)`、`Tests 213 passed (213)`（上一阶段 202，新增 11）。
- `npm run build`：成功。
- `npm run replay -- --model mock`：`exported`，输出「模型：mock（脚本化固定结果）」，Trace 28 条。
- `npm run replay -- --model env`（未填模型名）：`重放失败：未配置模型 ID`，不是栈回溯。
- 本机 `http://localhost:11434` 当前无服务（连接被拒），所以真实模型烟测未运行。

### 7.3 与方案的偏差

- **模型端口从同步改成异步**：原 `WritingModel` 是同步签名，真实模型无法塞进去。改成一律 `Promise`，脚本化实现包 async；202 个既有用例在改造后全部通过。
- **工具定义在适配器边界做了一次类型转换**：SDK 的工具泛型按每个工具的 schema 推导，运行时 `ToolSet` 只能按名查找；用显式转换换取稳定的 `ToolSet` 返回值。

### 7.4 未验证与限制

- **真实模型烟测未运行**：需要 `.env.local` 填 `WRITING_AGENT_MODEL_ID` 且本机/云端服务可用。
- **SDK 流式与工具调用事件未做端到端验证**：只验证了端口契约与事件形态；真模型跑一次才能确认 `text-delta` / `tool-call` 映射。
- **无重试与限流**：一次失败即中止。
- **结构化输出对模型能力有要求**：不支持 JSON schema 的模型会直接报错。
