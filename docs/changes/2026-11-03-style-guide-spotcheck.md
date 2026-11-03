# 变更记录：风格指南 3.0 抽检（T5）

- 日期：2026-11-03
- 关联计划：`hermes-out/CEO-复盘/plans/2026-11-03-my-write-agent.md` §5 T5
- 关联设计：`docs/design/2026-11-03-multi-style-loader.md`（§8：§5A.7 / §5A.8 由 T5 人工抽检，加载器不做全量自动化检测）
- 真源（只读，**未**复制进本仓）：  
  `/Users/yuanxj/Documents/github/my-notebook/obsidian-wiki/自媒体/00 定位/袁旭佳-创作风格指南3.0.md`  
  文首 2026-11-03 / 本次增补指向 §5A.8、§5A.7；正文抽检范围：§5A.7、§5A.8（含批注记录约定与写后自检）。
- 对照实现 tip（Mac，抽检时）：`8786a2f463afcce188f823939dc8fa39b1b540b5`（本记录 commit 之前）

## 1. 抽检清单与结论

| # | 检查项 | 方法 | 结果 | 证据 / 备注 |
|---|--------|------|------|-------------|
| 1 | 真源路径只读，风格全文不进本仓 git | `git ls-files` 无风格指南正文；design 明确不嵌全文；工作树未添加 Obsidian 文件 | **通过** | 仓内仅有 `styles/README.md`、`styles/_example/profile.md`（通用骨架）。真源仍在 Obsidian 绝对路径。 |
| 2 | 本地风格包 / 误拷指南不进 git | `git check-ignore -v styles/secret-spotcheck.md` → `.gitignore:styles/*`；`style-guide-spotcheck-tmp.md` → `**/style-guide*.md`；`styles/README.md` 与 `_example` 不被忽略 | **通过** | `.gitignore` 保留 `!styles/README.md`、`!styles/_example/**`。 |
| 3 | `--style` 能加载 `profile.md`（优先于 `SKILL.md`） | Mac：`npm test -- --run src/style/resolve.test.ts`（11 passed）；实现 `src/style/resolve.ts` `ENTRY_FILES = ["profile.md","SKILL.md"]` | **通过** | CLI 侧 T3/T4 已接线；无 API Key 时固定模型亦可带 `--style` 启动。 |
| 4 | design 是否引用 §5A.7 / §5A.8 与抽检边界 | 读 `multi-style-loader.md` §8 | **通过** | 明文：增补由 T5 人工抽检；**不在加载器内做全量自动化检测**。 |
| 5 | loader 是否对 §5A.7 / §5A.8 做自动条款检测 | 检索 `src/style/` | **缺口（预期）** | 加载器只读包入口正文并注入 system；**无**按条款 ID 的规则引擎。不假装已全自动检测。 |
| 6 | `_example` / README 是否有验收钩子 | 抽检前 example 仅有通用「禁止黑话」骨架，未点名 §5A.7/§5A.8；README 仍写「`--style` 属后续任务」（过时） | **部分缺口 → 本 commit 补钩子** | 本变更在 `_example/profile.md` 增加可选「写后对照 §5A.7/§5A.8」钩子（只点名、不粘全文）；README 改为描述已实现的 `--style`。 |
| 7 | §5A.7 关键条款（人工读真源） | 对照真源 7 条：常用说法、自然短句、小标题点名对象、开头先问题、体感归属、解释贴用途、结尾不强派任务 | **记录在案** | 实现侧：靠用户装入的 `profile.md` 摘要承载；本仓 example 不复制条款正文。创作后质量仍依赖人工/批注（yxj-writing-feedback），非 CLI 断言。 |
| 8 | §5A.8 关键条款（人工读真源） | 对照真源 7 条：小标题具体、少写软件「不能」、删重复解释、体感带时间范围、建议给条件、限制讲成体验、结尾停在自己判断；批注独立文件约定 | **记录在案** | 批注目录约定属 Obsidian/笔记侧工作流，**本仓不实现**批注文件写入；与 T0 职责分离一致。 |

## 2. 缺口汇总（不夸大、不伪装）

1. **无自动化 §5A 检测**：loader / 测试不会扫描成稿是否违反 §5A.7/§5A.8。若要产品化，应另票（可能挂在 feedback skill 或导出后清单），不在本短计划编码段硬塞。
2. **`banned-words.txt` 未解析**：design / README 标为可选；当前 resolve 只读入口 md。
3. **批注记录路径**（§5A.8）在笔记库，不在 my-write-agent 运行时。

## 3. 结论

T5 抽检完成：真源只读、gitignore、`--style`→`profile.md`、design 边界均对齐；§5A.7/§5A.8 以 **人工清单 + example 可选钩子 + design 声明** 验收，**未**做全自动条款检测。本短计划 §5 T0–T5 编码/文档项可勾完；是否推远程由 Aaron/CEO 决定。

## 4. 验证命令摘录（Mac，Asia/Shanghai）

```bash
cd /Users/yuanxj/Documents/working/my-write-agent
git check-ignore -v styles/secret-spotcheck.md   # styles/*
npm test -- --run src/style/resolve.test.ts      # 11 passed
# 真源只读打开（不复制）：
# …/袁旭佳-创作风格指南3.0.md  §5A.7 / §5A.8
```
