# 运行记录：真实 provider 端到端（bai / deepseek-v4.1-flash）

- 日期：2026-11-04
- 触发：`docs/design/2026-11-04-cli-usability-fixes.md` 的「真实 provider 未验证」项由负责人补齐凭据后实测
- 关联变更：`docs/changes/2026-11-04-cli-usability-fixes.md`
- 结论：**真实模型路径打通**，一条命令从素材到 Markdown/HTML 主稿，退出码 0。

## 1. 环境

| 项 | 值 |
| --- | --- |
| 模型接口类型 | `openai-compatible` |
| 接口地址 | `https://api.bairouter.io/v1` |
| 模型名 | `deepseek-v4.1-flash` |
| 密钥来源 | 本机 `.env.local`（`WRITING_AGENT_MODEL_API_KEY`，该文件已被 gitignore） |
| 搜索 | tavily，未配置密钥（已知缺口，不影响本轮） |

启动检查确认读到配置：`模型密钥：已配置`、`本次创作模型：真实模型 deepseek-v4.1-flash`。

## 2. 命令

```bash
cd /Users/yuanxj/Documents/working/my-write-agent
node dist/cli.js \
  --file ./_selftest_2026-11-03/素材-本地AI写作工具.md \
  --topic "本地写作 Agent：从复制粘贴到素材进 CLI" \
  --fast --yes
```

- `--fast`：只保留论点与终稿两道门禁。
- `--yes`：非交互，门禁自动批准（等价于无人值守）。

## 3. 结果

| 项 | 值 |
| --- | --- |
| 退出码 | 0 |
| 创作结果 | `exported`（阶段 `exported`，门禁 2 次） |
| 会话 | `sess-45da63f9-5994-4483-9b71-e66b2c35e5f8` |
| 总耗时 | 2m00s（7 次结构化调用） |
| 主稿 | `articles/从复制粘贴到素材进-CLI-本地写作-Agent-值不值得搭-先看这一条.md`（7354 字节，中文 2103 字） |
| HTML | 同名 `.html`（6099 字符，37 处内联样式，7 个 `<h2>`，无残留 Markdown 语法） |
| 大纲 | `outlines/同名.outline.md`（7 章，每章一句目标） |

## 4. 与前一次失败对比

2026-11-03 同一 provider、同一模型在 intake 阶段失败（`_selftest_2026-11-03/evidence/cli-bai-run1.log`）：

```text
This model does not support the requested response_format or output format.
```

本次同一命令到 `exported`。差异只有一处代码改动：结构化调用从 `generateObject`（发 `response_format`）改为 `generateText` + JSON Schema 提示 + JSON 提取。本地假服务集成测试已提前证明请求体不含 `response_format`，本次是真实网关上的确认。

## 5. 输出质量观察（抽样，非评测）

- 标题由模型生成（`从复制粘贴到素材进 CLI：本地写作 Agent 值不值得搭，先看这一条`），不再是固定样例标题——证明内容确实来自模型而非内置样例。
- 正文首段带事实边界声明：「本文是一个写作者的经验判断……未逐条核对公开文档」。这是事实核查阶段的降级清单被终稿阶段采用后的结果。
- 章内多处出现「这是我的推论」「我没有核对到公开文档来源」等限定语，符合 ADR 0004「规则层只验证可追溯性」的预期行为。
- HTML 为单层 `<div style=...>` 包裹的公众号内联样式，`<h2>`/`<blockquote>`/`<p>` 均带样式，无未转换的 `##` 或 `**`。

## 6. 成本与限制

- 调用次数：7 次（brief、materials、thesis、outline、draft、factReport、final），用量记账本版未写入数据库，**单次成本未计量**，需在 provider 侧账单核对；本文不估算金额。
- 耗时 2 分钟，其中大部分在草稿与终稿两次长文本生成。
- 搜索仍为未接入状态，研究阶段用本地素材替代；这不影响本次结论，但影响「需要外部事实」的选题。
- 本轮未验证：`--style` 风格包 + 真实模型组合、修改/拒绝后的真实重做路径、跨进程恢复后继续真实模型创作。
