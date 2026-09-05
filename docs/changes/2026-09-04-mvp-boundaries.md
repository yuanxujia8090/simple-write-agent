# 变更：补充 MVP 行为边界

- 日期：2026-09-04
- 状态：已完成
- 关联需求：`docs/wiki/01-prd-writing-agent.md`
- 关联决策：`docs/adr/0007-mvp-boundaries-and-quality-gate.md`

## 变更目的

在进入实现前，把 PRD 中未定义、会导致实现时靠猜的行为边界补齐：Checkpoint 粒度、质量判断标准、素材输入边界、slug 生成、搜索提供方、多进程并发、快速模式素材语义，以及一组默认采纳项。

## 实际改动

- `docs/wiki/01-prd-writing-agent.md`：
  - 2.3 会话默认名（主题前 8 字 + 日期）与 `/list` 最近事件定义；
  - 3.3 快速模式待验证素材自动进降级改写清单；素材边界（`--file` 可重复、≤ 1MB、UTF-8 容忍 BOM）；
  - 4.4 Checkpoint 阶段原子；
  - 4.5 默认主题 = 内置默认色值（字段结构对齐 my-theme.json）；
  - 4.6 slug 保留中文规则；HTML mdast 子集；
  - 5.1 单进程 + 锁检测；无配置首次引导；Tavily 接入；
  - 5.3 质量判断 = 结构门槛 + 交给人（maxRounds 默认 2）；错误分级；
  - 验收标准新增第 14 条。
- `docs/plan/00-plan.md`：T2（锁检测/首次引导）、T3（默认主题）、T5（阶段原子 checkpoint）、T8（素材边界）、T9（Tavily）、T10（maxRounds/质量门）、T12（mdast 子集）、T13（会话命名/最近事件）、T14（中文 slug）、V4（素材边界）。
- `CONTEXT.md`：新增 SearchProvider、Slug、Checkpoint 粒度术语。
- `docs/adr/0007-mvp-boundaries-and-quality-gate.md`：新增。

## 验证

- 命令：`grep -c "阶段原子\|maxRounds\|Tavily\|1MB\|保留中文\|mdast\|锁检测" docs/wiki/01-prd-writing-agent.md docs/plan/00-plan.md docs/adr/0007-mvp-boundaries-and-quality-gate.md`
- 结果：关键术语已按计划出现；PRD、计划、术语表、ADR 引用一致（见核对输出）。

## 未完成事项与风险

无。
