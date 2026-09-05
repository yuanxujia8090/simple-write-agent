# 变更：需求审查后的 PRD 修订

- 日期：2026-09-04
- 状态：已完成
- 关联需求：`docs/wiki/01-prd-writing-agent.md`
- 关联决策：`docs/adr/0003-confirmation-gate-types.md`、`docs/adr/0004-fact-checking-boundary.md`、`docs/adr/0005-rejection-rollback-parent-stage.md`

## 变更目的

以 Agent 产品经理视角审查 PRD 后，修正 3 处逻辑矛盾、补全 4 处需求空洞、打磨 5 处体验与一致性，使需求进入实现前无歧义、可测试的基线。

## 实际改动

- `docs/wiki/01-prd-writing-agent.md`：
  - 2.1 补裸启动欢迎页（idle 主界面）入口；
  - 2.2 命令表 `/export` 支持 `--copy` 复制 HTML；
  - 3.2 补 MVP 固定问题访谈集（5 个问题映射 CreativeBrief 字段，答完 1–3 可确认）；
  - 3.3 明确素材归属按发起方区分（Agent 读取→整批确认、`/read` 直接入池、`/search`→整批确认），素材整批确认为采纳门禁；搜索失败分基础设施/质量两类；
  - 3.6.2 规则层只验证可追溯性，新增三类争议信号；快速模式改写遵守"只降级、不新增"，降级清单带原因代码；
  - 3.7 拒绝采用最小回退到父阶段（含回退目标表）；确认点明确为内容门禁；
  - 4.5 主题 `version` MVP 只接受 1；
  - 4.6 补 `/export --copy`；
  - 5.4 新增质量遥测三指标与进度提示/`Ctrl+C` 保存退出；
  - 验收标准 4 与新增 12 同步。
- `docs/plan/00-plan.md`：决策表补 D8–D10；5.2/5.3 同步门禁与证据规则；任务 T3–T14 与验证门禁 V4 按新规则更新；T11 验证项去重，`SIGINT` 与 `Ctrl+C` 统一为同一中断保存行为。
- `CONTEXT.md`：确认门禁拆为采纳门禁（AdoptionGate）与内容门禁（ApprovalGate），更新 ConfirmationGate 为统称。
- `docs/adr/0003-confirmation-gate-types.md`、`docs/adr/0004-fact-checking-boundary.md`、`docs/adr/0005-rejection-rollback-parent-stage.md`：新增。

## 验证

- 命令：`grep -n "AdoptionGate\|ApprovalGate" CONTEXT.md docs/wiki/01-prd-writing-agent.md docs/plan/00-plan.md`；`grep -c "最小回退\|只降级\|version: 1" docs/wiki/01-prd-writing-agent.md`；`wc -l docs/wiki/01-prd-writing-agent.md docs/plan/00-plan.md CONTEXT.md`
- 结果：已确认三类关键术语在 PRD 与计划中均出现，修改后各文档行数符合预期（见后续核对输出）。

## 未完成事项与风险

无。P2 打磨项已作为 MVP 内低成本增强并入对应任务，未扩大计划范围。
