# 变更：真实模型兼容、门禁确认卡与工作区卫生

- 日期：2026-11-04
- 状态：已完成
- 关联需求：2026-11-04 项目评估后的三项决定（用户回复「按推荐」）
- 关联决策：无新增 ADR；沿用 ADR 0003（两类门禁）、ADR 0005（拒绝回退父阶段）、ADR 0012（确认与 checkpoint 同事务）
- 关联方案：`docs/design/2026-11-04-cli-usability-fixes.md`

## 变更目的

1. 真实模型路径不再因 `response_format` 在 OpenAI 兼容网关上直接 400。
2. 终端里人能逐道门禁批准/修改/拒绝，而不是只能自动批准。
3. `git status` 干净：本地运行状态被忽略，重复证据包不再占位。

## 实际改动

- `src/model/ai-sdk.ts`：`generateObject` 改为 `generateText` + JSON Schema 提示 + `extractJsonObject` + zod 校验，解析失败回灌错误重试一次；导出 `extractJsonObject` 供测试；`tool as unknown as SdkToolFactory` 补 SAFETY 说明。
- `src/model/ai-sdk.test.ts`（新增）：脏输出解析 10 个用例（代码围栏、前后说明、坏 JSON、顶层非对象等）。
- `src/model/ai-sdk.integration.test.ts`（新增）：本地假 OpenAI 兼容服务，断言请求体无 `response_format`、JSON Schema 进了 prompt、重试一次后成功、两次失败给可读错误。
- `src/cli/confirm.ts`（新增）：确认卡渲染 `formatCard`、决策解析 `parseAnswer`、readline 交互 `createTerminalConfirm`。
- `src/cli/confirm.test.ts`（新增）：11 个用例，含「看不懂就重问、不默认批准」和内存流交互。
- `src/cli/auto-run.ts`：新增可注入 `confirm`；不注入时保持自动批准，非交互行为不变。
- `src/cli/main.ts`：终端且未给 `--yes` 时启用确认卡；启动/模式文案随交互状态变化；`isInteractive`、`confirmGate` 可注入以便测试。
- `src/cli/args.ts`、`src/cli/help.ts`：新增 `--yes`。
- `src/cli/args.test.ts`、`src/cli/main.test.ts`：补 `--yes` 解析与交互文案用例。
- `.gitignore`：新增 `.writing-agent/`。
- `_selftest_2026-11-03/evidence.tgz`：删除。删除前 `diff -r` 确认与 `evidence/` 下 6 个文件逐字一致。

## 验证

- 命令：`npm run typecheck` → 通过，无输出。
- 命令：`npm test` → `Test Files 23 passed (23)`、`Tests 263 passed (263)`。
- 命令：`npm run build` → 通过，`dist/cli.js` 生成。
- 命令：`node dist/cli.js --help` → 输出含 `--yes` 与「默认在终端逐道门禁确认」。
- 命令：`node dist/cli.js --file ./_selftest_2026-11-03/素材-本地AI写作工具.md --topic "…" --fast` → 退出码 0，`创作结果：exported`，导出 `articles/*-3.md` 与同名 `.html`。
- 命令：`(printf 'y\n'; sleep 2; …) | script -q /dev/null node dist/cli.js --file … --fast` → 伪终端下显示确认卡 1/2，两次批准后 `创作结果：exported`；把第二次输入改为 `m 标题再短一点` 时流程重做并出现第三张确认卡。
- 命令：`git status --short` → 不再出现 `.writing-agent/`；`evidence.tgz` 已不在列表。

## 未完成事项与风险

- 真实 provider 端到端已于同日补齐（负责人填入 `.env.local` 凭据后实测）：`node dist/cli.js --file … --fast --yes` → 退出码 0、`创作结果：exported`、2 道门禁、2 分钟、主稿 2103 中文字并导出 HTML。详见 [`docs/runs/2026-11-04-bai-real-model.md`](../runs/2026-11-04-bai-real-model.md)。
- 改动已按一功能一 commit 拆分提交（见 `git log`：fix 模型、feat 确认卡、chore 忽略、docs 文档四笔）。
- `_selftest_2026-11-03/` 仍未纳入版本管理；其中 `*.log` 命中 `.gitignore`，只有 md 会被跟踪。
- 本轮未做：Ink TUI、斜杠命令、搜索提供方、`profile.db`、`--output-dir` 生效、单实例锁接线。
