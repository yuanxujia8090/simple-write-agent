# 变更：补充效率、反馈与内容诊断

- 日期：2026-09-04
- 状态：已完成
- 关联需求：`docs/wiki/01-prd-writing-agent.md`
- 关联决策：`docs/adr/0008-efficiency-feedback-content-diagnosis.md`

## 变更目的

落实产品预期：研究阶段防止过度研究（研究预算）、草稿前快速见稿（到稿交互数指标）、内容有软性质量反馈（内化 dbs-content 三维度）、用户可随时记录想法（会话内 `/note` + 跨会话 `/idea`）。

## 实际改动

- `docs/wiki/01-prd-writing-agent.md`：
  - 2.2 命令表新增 `/note`、`/idea`；
  - 新增 2.4 自由反馈与想法速记（`/note` 语义、`/idea add/search/use`、全局 `ideas` 表、MVP 三能力）；
  - 3.3 新增研究预算（普通 2 轮、快速 1 轮，每轮搜索 ≤ 2 次；与 `maxRounds` 区分）；
  - 新增 3.6.3 内容诊断（软性）：文字洁癖/表达效率/认知落差，建议形式、不构成硬门禁；
  - 4.1 核心对象新增 Note、Idea；
  - 5.4 质量遥测新增"到稿交互数"指标（4 项）；
  - 验收标准新增 15–17（`/note`/`/idea`、研究预算、内容诊断），第 1 条命令列表与 12 条指标数同步。
- `docs/plan/00-plan.md`：新增 5.5 效率、反馈与想法速记；T5（ideas 表）、T6（到稿交互数）、T9（研究预算）、T10（预算收敛）、T13（`/note`/`/idea`）、T15/V4 同步。
- `CONTEXT.md`：新增 Note、Idea、ResearchBudget 术语（含与修订指令、`maxRounds` 的避免混淆说明）。
- `docs/adr/0008-efficiency-feedback-content-diagnosis.md`：新增。

## 验证

- 命令：`grep -c "研究预算\|/note\|/idea\|ideas\|到稿交互数\|内容诊断\|ResearchBudget" docs/wiki/01-prd-writing-agent.md docs/plan/00-plan.md CONTEXT.md docs/adr/0008-efficiency-feedback-content-diagnosis.md`
- 结果：关键术语已按计划出现；PRD、计划、术语表、ADR 引用一致（见核对输出）。

## 未完成事项与风险

无。
