# 阶段方案：多风格本地加载

- 日期：2026-11-03
- 状态：设计中（未编码）
- 关联计划：`hermes-out/CEO-复盘/plans/2026-11-03-my-write-agent.md` §2.2 / §2.3 / §3
- 关联需求：本地多套写作风格可切换；风格正文私有不进 git
- 关联后续：T2 gitignore + styles/README；T3 实现 `--style` / `WRITING_AGENT_STYLE`
- 对照：风格真源 Obsidian《创作风格指南 3.0》；v7 `references/style-guide-3.0.md` 仅为副本；批注归同级 `yxj-writing-feedback`

## 1. 目标

阶段结束后，用户能用 **本地风格包路径或 id** 指定一套写作风格；运行时只**读取**包内 `profile.md`（或 `SKILL.md`）等文件注入创作链路；**真人风格全文不进入本仓 git**。

## 2. 范围

### 包含

- 本地风格包根约定：`~/.writing-agent/styles/<style-id>/`
- 包最小内容：`profile.md` **或** `SKILL.md`（二选一优先 `profile.md`，缺则读 `SKILL.md`）；可选 `banned-words.txt`、`samples/`（本阶段可不强制解析 samples）
- CLI：`--style <id|path>`；环境变量 `WRITING_AGENT_STYLE`（CLI 优先于 env）
- 解析顺序与失败提示（中文可读）
- 仓内仅允许说明与骨架：`styles/README.md`、`styles/_example/`（无私人语气）
- `.gitignore` 约定（实现落在 T2）：`styles/*` 保留 `!styles/README.md`、`!styles/_example/`；可选忽略工作树内误拷的 `**/style-guide*.md`

### 不包含

- 把 Obsidian 风格指南全文或 v7 `references/` 拷进本仓
- 内嵌 v7 skill 树 / 批注回流（归 `yxj-writing-feedback`）
- 多风格视觉主题与 HTML 主题合并（可延后）
- 云端同步、多用户风格市场
- 本阶段编码实现（T1 只写设计）

### 已知简化

| 事项 | 本阶段做法 | 后续 |
| --- | --- | --- |
| 风格内容结构 | 先整文件读入字符串，交给模型提示；不做复杂 frontmatter schema | 需要时再加字段校验 |
| 默认风格 | 未指定 `--style` / env 时：不注入私人风格包（沿用现有固定/真实模型行为）；文档写清如何安装默认 id | 可选 `config.json` defaultStyle |
| 仓内 styles/ | 实现前可不存在；T2 才加 README/_example + gitignore | T2 |

## 3. 数据流

```text
CLI --style <id|path>  或  env WRITING_AGENT_STYLE
  → resolveStyleRef(ref, { homeDir, cwd })
       id  →  ~/.writing-agent/styles/<id>/
       绝对/相对 path → 规范化为目录
  → 读 profile.md（优先）或 SKILL.md
  → StyleProfile { id, rootDir, entryPath, bodyText }
  → 注入 GraphRunner / 模型调用上下文（system 或阶段 prompt 附加段）
  → 创作产出仍落 articles/；风格正文不写回仓内 styles/
```

冲突规则：文风条款冲突时以用户本机 Obsidian 真源为准；本加载器**不**自动去读 Obsidian 绝对路径，除非用户把该文件（或指向它的包）装进 `~/.writing-agent/styles/<id>/`。推荐：风格包装一份**精简 profile**（指向真源路径说明 + 本包禁词/侧重），避免把 3.0 全文复制进包后再误提交。

## 4. 关键规则

1. `--style` 与 `WRITING_AGENT_STYLE` 都缺：不报错，风格注入为空（可打 debug 日志「未指定风格包」）。
2. 指定了但目录不存在 / 无 `profile.md` 且无 `SKILL.md`：用法级错误退出，提示目录应含哪个文件、建议路径示例。
3. id 含路径分隔或 `..`：拒绝，要求用 path 形式给目录。
4. 读文件失败（权限/编码）：明确错误，不静默回退到「假装有风格」。
5. 永不把风格正文写入 git 跟踪路径；导出主稿不含「请把风格指南提交到仓库」类指引。

## 5. 验证方法（可复现；编码后执行）

| 验证 | 命令 / 步骤 | 通过标准 |
| --- | --- | --- |
| 单元：解析 id | Vitest：`resolveStyleRef("demo", { homeDir })` | 得到 `homeDir/.writing-agent/styles/demo` |
| 单元：解析 path | 临时目录含 `profile.md` | `StyleProfile.bodyText` 含文件内容 |
| 单元：缺入口 | 空目录 | 抛出可读 USAGE/IO 错误 |
| 单元：CLI 优先 | args `--style a` + env `b` | 选用 `a` |
| gitignore（T2） | 在 `styles/private.md` 试加后 `git status` | 不被跟踪；`styles/README.md` 仍可加 |
| 行为：注入 | 固定模型或 mock：指定 style 后 prompt/上下文含 profile 片段 | 断言行为（读到包），不断言全文匹配实现细节 |
| 回归 | `npm run typecheck` && `npm test` | 0 失败 |

**环境注意（Important）**：box 当前 Node v20 且缺 `make`，`better-sqlite3` 的 `npm install` 失败；编码验证优先在 Mac（Node >=22 + build-essential/Xcode CLT）或先装齐原生构建链再跑。

## 6. 任务拆分（编码阶段，非本 commit）

| 编号 | 任务 | 产出 | commit 示例 |
| --- | --- | --- | --- |
| S0 | gitignore + styles/README + _example | T2 | `feat: 风格包本地路径约定与 gitignore` |
| S1 | `resolveStyleRef` + 读入口文件 | `src/style/` + 测试 | `feat: 风格包本地路径加载` |
| S2 | CLI `--style` + env | `args.ts` `help.ts` + 测试 | `feat: CLI 支持 --style 指定风格` |
| S3 | 注入 runner/model 上下文 | 最小接线 | 可并入 S2 或单独中文 commit |

## 7. 实际结果

（收尾时补：真实改动、测试数、与方案偏差、未验证项。本文件提交时尚未编码。）

## 8. 与 v7 / 真源边界（Subtract）

- **不**在本仓再嵌一份会漂移的风格指南全文。
- **不**把 v7 `SKILL.md` / `references/` 当运行时依赖。
- 需要条款对照时：读 Obsidian 真源或用户安装的本地风格包；§5A.7 / §5A.8 等增补由 T5 人工抽检，不在本加载器内做全量自动化检测。
