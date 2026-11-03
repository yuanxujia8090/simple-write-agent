# 变更：多风格本地加载 · 2026-11-03

- tip（收尾）：见 `65c2477`（feat: 风格包本地路径加载与 --style）；约定层 `371f2c7`
- 方案：`docs/design/2026-11-03-multi-style-loader.md`
- 实现要点：`styles/*` gitignore（保留 README/_example）；`--style` / `WRITING_AGENT_STYLE` 解析本地 `profile.md`
- 验证：`src/style/resolve.test.ts`；T3 证据 `hermes-out/00-给Aaron/2026-11-03-my-write-agent-t3/`
- 未做：风格指南全文进仓；自动检测 §5A 全条款
