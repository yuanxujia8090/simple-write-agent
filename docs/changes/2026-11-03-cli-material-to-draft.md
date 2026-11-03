# 变更：CLI 素材→主稿最小路径 · 2026-11-03

- tip（收尾）：`8786a2f`（feat: CLI 支持素材路径启动创作主路径）
- 方案：`docs/design/2026-11-03-cli-material-to-draft.md`
- 实现要点：`--file` 素材路径进入既有写作主路径；固定模型可导出 MD/HTML
- 验证：自测 REPORT（固定模型绿）；`2026-11-03-my-write-agent-自测/`
- 已知缺口：部分真实模型（bai/deepseek-v4.1-flash）不兼容 `generateObject`/`response_format`——另票
