# 变更：新增工作目录与全局状态目录模型

- 日期：2026-09-04
- 状态：已完成
- 关联需求：`docs/wiki/01-prd-writing-agent.md`
- 关联决策：`docs/adr/0006-workspace-artifacts-directory.md`

## 变更目的

PRD 未定义"工作目录"概念，`articles/`、`--file`、`--output-dir` 等路径解析基准悬空，且未定义各阶段产物的存储位置。本次补充三层规则：工作目录默认当前目录、全局状态目录与工作目录解耦、素材纳入后复制为快照，使任意目录启动、产物目录启动读取创作状态均有明确语义。

进一步补充"中间产物外部编辑"场景：用户可能直接打开并修改大纲/草稿文件，而非通过 Agent。故大纲与草稿主稿落盘为文件，引入外部编辑检测（mtime/hash），检测到改动后停下询问用户，不静默采用、不静默覆盖。

## 实际改动

- `docs/wiki/01-prd-writing-agent.md`：
  - 2.1 新增 `--cwd <path>` 参数；明确工作目录默认 = 启动目录；欢迎页按工作目录匹配未完成会话并提示恢复；
  - 3.3 素材确认纳入后复制为快照存入 `~/.writing-agent/materials/<sessionId>/`；
  - 3.4 大纲确认后落盘 `outlines/<slug>.outline.md`，外部编辑后进入 drafting 前触发三选确认；
  - 3.5 草稿主稿落盘 `articles/<slug>.md`，外部编辑检测触发重新进入 review/export；
  - 3.6.2 主稿外部编辑并确认重审后，事实核查针对新主稿重新执行；
  - 4.6 明确默认输出相对工作目录 `articles/<slug>.md`/`.html`，`--output-dir` 相对工作目录解析；
  - 4.7 工作目录与产物目录：工作目录解析规则、`.writing-agent/workspace.json` 标识与向上回溯、`outlines/` + `articles/` 落盘、外部编辑检测规则（文件权威、DB 存指纹）、全局状态目录结构、启动检测；
  - 5.1 本地优先补充全局数据目录说明；
  - 验收标准新增第 13、14 条（工作目录匹配恢复、大纲/主稿落盘与外部编辑衔接）。
- `docs/plan/00-plan.md`：决策表新增 D11；3.1 参数补 `--cwd`；5.3 素材快照；5.4 工作目录与产物目录（含解析、落盘、外部编辑检测）；T2/T4/T5/T8/T10/T11/T12/T13/T14/T15/V4/交付标准同步。
- `CONTEXT.md`：新增"运行与存储"组（WorkingDirectory、GlobalStateDirectory）。
- `docs/adr/0006-workspace-artifacts-directory.md`：新增；后并入 `.writing-agent/` 标识、向上回溯与外部编辑检测细化。

## 验证

- 命令：`grep -c "工作目录\|Workspace\|--cwd\|materials\|workspace.json\|向上\|外部编辑\|outlines" docs/wiki/01-prd-writing-agent.md docs/plan/00-plan.md CONTEXT.md docs/adr/0006-workspace-artifacts-directory.md`
- 结果：关键术语已按计划出现（见核对输出）；PRD、计划、术语表、ADR 引用一致。

## 未完成事项与风险

无。
