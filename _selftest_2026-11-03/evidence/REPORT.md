# my-write-agent 自测（2026-11-03）

- tip：`f194cafcce8941df2107162f1289c50d5f60e2e8`（仍与推远程一致，未新 commit）
- 仓：`/Users/yuanxj/Documents/working/my-write-agent`（yuanxujia8090/simple-write-agent）
- 短清单执行：principle-prove-it-works、verification-before-completion、grice-express
- 禁合/CA：遵守

## 选题 / 素材

1. `_selftest_2026-11-03/素材-本地AI写作工具.md` → 话题「本地写作 Agent：从复制粘贴到素材进 CLI」
2. `_selftest_2026-11-03/素材-风格包切换.md` → 话题「一篇稿两种语气：用风格包管住」

## A. CLI 管道（固定模型）——绿

命令（无 API Key）：

```bash
npm run dev -- --file ./_selftest_2026-11-03/素材-….md --topic "…" --fast
```

- 两次退出码 0；`创作结果：exported`
- 导出（固定模型内容为内置样例标题，**不随话题变**）：
  - `articles/把知识库从收藏夹变成工作台.md`
  - `articles/把知识库从收藏夹变成工作台-2.md`
- 日志：`cli-fixed.log`

结论：**CLI→articles 主路径绿**（门禁自动批准、导出 Markdown/HTML）。

## B. CLI + 真实模型 bai/deepseek-v4.1-flash ——红

环境：`WRITING_AGENT_MODEL_BASE_URL=https://api.bairouter.io/v1`，`MODEL_ID=deepseek-v4.1-flash`，Key 来自 `pi auth print-api-key --provider bai`。

失败（intake 阶段，门禁 0）：

> This model does not support the requested response_format or output format.

同模型经 beef 网关则报：Prompt 须含 `json` 才能用 `json_object`。

日志：`cli-bai-run1.log`、`cli-try-beef.log`

结论：**writing-agent 真实模型路径依赖 AI SDK `generateObject`/response_format，与 bai 上 deepseek-v4.1-flash 不兼容**；未改码。

## C. pi agent（bai / deepseek-v4.1-flash · thinking high）——绿（成稿）

按派工「用 pi agent (bai) deepseek-v4.1-flash • high」直接成稿：

| 路径 | 约字节 | 首行标题 |
|---|---|---|
| `articles/自测-本地写作Agent-素材进CLI.md` | 6025 | `# 把素材塞进命令行：本地写作 Agent 的一次具体切换` |
| `articles/自测-风格包切换.md` | 6688 | `# 一篇稿两种语气：用风格包代替口头约定` |

文末含 `<!-- selftest: pi bai/deepseek-v4.1-flash thinking=high 2026-11-03 -->`。

## Aaron 怎么用（当前）

- 要**管道验收 / 无 Key**：`--file` + `--fast`（固定样例稿）
- 要**真模型长文、指定 deepseek-v4.1-flash**：暂用 `pi -p --provider bai --model deepseek-v4.1-flash --thinking high` 读素材写 `articles/`；或另票修 writing-agent 结构化输出兼容
- 本自测未 push、未改 src
