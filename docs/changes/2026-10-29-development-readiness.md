# 变更：开发准备、资料导航与实现后学习

- 日期：2026-10-29
- 状态：已完成（限本次文档准备；软件实现和关键机制实验待执行）
- 关联需求：用户要求检查需求、技术方案和实施计划，解除先学习后开发的限制，阶段记录技术方案与决策，完成后再学习；同时评估并整理较多资料。
- 关联决策：[0011：先实现、阶段留证、完成后学习](../adr/0011-implementation-first-learning-after.md)

## 变更目的

给开发建立清楚的当前入口和执行顺序，解除学习证明对开发的阻塞，并保留后续学习所需的真实方案、决策、代码与验证证据。

## 实际改动

- `README.md`、`docs/README.md`：项目入口、阅读顺序、有效决策、历史研究与学习材料的用途、阶段记录位置。
- `agents.md`：当前协作方式调整为先实现、阶段留证、实现后学习；在既定授权内采用推荐方案，只对不可逆、费用、发布、范围变化暂停确认。
- `docs/adr/0011-implementation-first-learning-after.md`：记录新工作流与学习边界；原 `0010-learning-first-incremental-validation.md` 标记为已取代，历史正文保留。
- `docs/wiki/01-prd-writing-agent.md`：学习证明与软件验收分离；按已有决策统一目录解析、目录身份和外部编辑后大纲确认的描述；保留 23 项产品验收。
- `docs/plan/00-plan.md`：新增按用户路径推进的实际阶段；保留原 17 项任务，新增 T0 暂停重放与提交一致性实验；11 项验证保留，最后一项改为工程记录可追溯；各组件组的学习内容后置为回看材料。
- `docs/design/2026-09-05-agent-technical-design.md`：标明总体方案与待实验边界；统一状态写入者，标注表结构草图、保存器接法与历史接口的验证前提；修正文档目录、端口路径与代码围栏。
- `docs/design/2026-10-29-development-readiness-review.md`：集中本次核对依据、已处理矛盾、实施风险及对应任务，明确下一步的脚手架与实验范围。
- `docs/learning/2026-10-19-review-loop.md`：实施阶段即时记录工程证据，学习复盘后置；分清方案、决策、变更和学习记录的位置。
- `CONTEXT.md`：工作目录术语与既有解析/搬移规则对齐。
- `docs/DECISIONS.md`：记录统一入口、保留任务编号、资料不搬移和一般取舍的保存位置。
- `docs/changes/02-changelog.md`：追加本次摘要与本记录入口。

## 验证

- 逐段交叉核对：需求、有效决策、总体设计、主计划、协作规则、复盘规则与新增入口；已确认学习前置条件解除、工程验证保留、阶段记录位置统一，以及风险进入对应实施阶段。
- 内容静态检查：7 项通过，覆盖新旧决策状态、实际执行顺序、原任务与新增实验任务、11 项验证、23 项产品验收、阶段记录替代学习放行。
- 全范围文档检查：14 份文档、53 条本地文件链接与代码围栏通过；`git diff --check` 退出码 0。原 17 项实施任务与新增实验、11 项验证及 23 项产品验收逐项保留。根入口、协作规则、需求、计划与复盘规则已对齐当前决策。
- 命令：在项目根目录运行以下只读检查，核对本次改动文档的文件链接和代码围栏，并运行 Git 差异格式检查。

```bash
python3 - <<'PY'
from pathlib import Path
import re
import subprocess

root = Path.cwd()
tracked = subprocess.check_output(
    ['git', 'diff', '--name-only'], text=True
).splitlines()
untracked = subprocess.check_output(
    ['git', 'ls-files', '--others', '--exclude-standard'], text=True
).splitlines()
files = sorted({f for f in tracked + untracked
                if f.endswith('.md') and not f.startswith('.pi/')})
links = 0
for name in files:
    file = root / name
    text = file.read_text()
    assert len(re.findall(r'^\s*```', text, re.M)) % 2 == 0, name
    text = re.sub(r'```[\s\S]*?```', '', text)
    for target in re.findall(r'\]\(([^)]+)\)', text):
        target = target.split('#')[0]
        if not target or re.match(r'^(https?:|mailto:|app:)', target):
            continue
        assert (file.parent / target).exists(), (name, target)
        links += 1
subprocess.run(['git', 'diff', '--check'], check=True)
print(f'{len(files)} 份文档、{links} 条本地文件链接与代码围栏通过；差异格式检查通过')
PY
```

- 命令：`git diff --check`；已运行，退出码 0。
- 验证过程错误：首个 JavaScript 检查脚本因数组括号配对错误报 `Expected "]" but found ")"`，未执行检查；改用 Python 实现并实际运行，7 项内容检查及首轮文件链接/围栏检查通过。该错误来自临时检查脚本，不是项目业务程序。
- 功能测试、类型检查、依赖安装、真实模型/搜索调用、暂停恢复与提交一致性实验：未运行，本次交付为文档准备。

## 未完成事项与风险

- 实际保存器事务、暂停/取消重放、模型接口版本、逐节点上下文、工具安全与运行恢复方案仍需按主计划实施和验证；本轮不宣称软件可运行或生产可用。
- 原有未跟踪 `.pi/` 保留；本次修改限上列项目文档，未提交或推送。
- 外部学习工作区只读检查；课程、分数和掌握状态仍由真实学习证据更新。
