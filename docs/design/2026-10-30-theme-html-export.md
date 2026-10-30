# 阶段方案：主题配置与确定性 HTML 导出

- 日期：2026-10-30
- 状态：已完成
- 关联需求：[需求](../wiki/01-prd-writing-agent.md) §4.5、§4.6
- 关联决策：D6（Markdown 主稿 + 确定性 HTML）、[0006](../adr/0006-workspace-artifacts-directory.md)
- 主计划：[00-plan.md §6 T3、T12](../plan/00-plan.md)
- 上一阶段：[持久化与文件保护闭环](2026-10-30-persistence-file-protection.md)

## 1. 目标

导出时同时得到两份文件：可编辑的 Markdown 主稿，和由同一份主稿确定性生成的公众号内联样式 HTML。样式来自主题 JSON；主题缺失字段用内置默认补齐，写错的主题不会把程序打挂，只提示并沿用上一份有效主题。

## 2. 范围

### 包含

1. **主题加载与校验**：`--theme <path>` 或内置默认；`version` 只接受 `1`；字段类型与取值范围校验；缺失字段递归补齐；保留用户原始 JSON 与补全后的运行时对象；非法配置返回上一份有效主题并给出可读提示。
2. **mdast 渲染器**：Markdown → mdast（GFM 扩展）→ 内联样式 HTML；覆盖标题、段落、引用、代码（围栏与行内）、列表（有序/无序/嵌套）、表格、图片、强调、链接、删除线、分隔线、换行。
3. **不支持的节点**：保留原文片段并记一条警告，不静默丢弃。
4. **双文件导出**：`articles/<slug>.md` + `articles/<slug>.html`，同一 slug；HTML 写失败时保留 Markdown，标记部分成功并给出重试入口（本次以 `RunOutput.htmlError` 表达，留 T14 做交互）。
5. **重放接线**：`npm run replay -- --theme <path>` 使用指定主题；输出里多一行 HTML 路径。
6. **测试**：主题合法/缺字段/非法版本/非法字段/保留旧主题；每个节点类型的渲染；不支持节点警告；端到端两份文件同源。

### 不包含

- `/export --copy` 复制到剪贴板、主题可视化编辑器、主题导入/导出命令。
- 主题变更后重新导出已有文件的交互（T13/T14）。
- 大纲转 HTML、作者档案内容写入导出。
- 图片下载、代码高亮着色（MVP 只做背景与字号）。

### 已知边界

- **样式变量只覆盖 PRD 样例里用得到的字段**：字号、颜色、间距、列表符号、表格边框与斑马纹、引用块、代码块、图片圆角、链接与强调色。未在样例中出现的字段不引入。
- **HTML 是片段而非完整网页**：一个外层 `div` 承载字体与行高，便于贴进公众号编辑器；不写 `<html>`、`<head>`。
- **渲染器不做 HTML 清洗**：输入是本程序自己生成的主稿，不接外部不可信 HTML；原文里的 `<script>` 会被转义为文本。

## 3. 数据流

```text
--theme <path>（可选）
   └─ loadTheme()  → { theme, raw, warnings }
                      ├─ 文件不存在/JSON 损坏 → 用默认 + 警告
                      └─ 校验失败 → 用上一份有效主题 + 警告

export 节点
   ├─ files.exportMarkdown() → articles/<slug>.md（已有）
   ├─ renderMarkdownToHtml(markdown, theme) → { html, warnings }
   │      └─ mdast 遍历：支持节点→内联样式；不支持→原文 + 警告
   └─ files.writeHtml() → articles/<slug>.html
```

## 4. 关键规则

- HTML 与 Markdown 必须来自同一份主稿文本；不允许模型另写一份 HTML。
- 同一份主稿 + 同一份主题必须得到完全相同的 HTML（纯函数，无时间戳、无随机 id）。
- 主题校验失败不抛到用户脸上中断流程：返回上一份有效主题，并把原因放进 `warnings`。
- 支持节点集合之外的节点（如原始 HTML、脚注）保留原文，用户能看见被略过了什么。
- 文件命名与冲突规则复用 Markdown 导出：同名换 `slug-2`，不覆盖既有文件；`.md` 与 `.html` 同 slug。

## 5. 验证方法

- `npm run typecheck`、`npm test`。
- `npm run replay -- --theme archive/my-theme.json`：观察是否产出 `.html`，与 `.md` 同目录同 slug。
- 直接对比两份文件：`.html` 中的正文文字应与 `.md` 一致（去掉标记符号后）。
- 非法主题（版本 2、颜色写错、文件不存在）各跑一次，确认回退到默认主题并给警告。
- `git diff --check`。

## 6. 任务拆分

| 序 | 内容 | 产物 |
| --- | --- | --- |
| 1 | 主题类型、默认值、校验、补齐 | `src/config/theme.ts` |
| 2 | mdast → 内联样式 HTML | `src/render/html.ts` |
| 3 | 写 HTML 文件 | `src/domain/files.ts`、`src/artifacts/files.ts` |
| 4 | 导出节点接双文件与部分成功 | `src/agent/graph.ts`、`src/agent/runner.ts` |
| 5 | 重放与输出 | `src/cli/replay.ts`、`src/cli/replay-main.ts` |
| 6 | 测试 | `src/config/theme.test.ts`、`src/render/html.test.ts`、重放测试补充 |

## 7. 实际结果

### 7.1 已交付

- `src/config/theme.ts`：主题 schema（zod）、内置默认主题、`loadTheme()`；校验版本、颜色、字号/间距范围与枚举；缺字段递归补齐；保留原始 JSON；非法配置回退「上一份有效主题 / 内置默认」并给警告。
- `src/render/html.ts`：mdast（GFM）→ 内联样式 HTML；覆盖 PRD 子集全部节点；子集外节点保留原文并记 `RenderWarning`；所有文本与属性转义。
- 双文件导出：`ARTICLES/<slug>.md` + `<slug>.html` 同目录同 slug；重新导出时替换本会话自己的 HTML。
- 部分成功：HTML 渲染/写入失败不影响 Markdown 导出，`RunOutput.htmlError` 带原因。
- 接线：`GraphRunner`/`PersistentRuntime` 接受 `theme`；`npm run replay -- --theme <path>` 可用，输出多一行 HTML 路径与主题来源。

### 7.2 实测

- `npm run typecheck`：通过。
- `npm test`：`Test Files 16 passed (16)`、`Tests 202 passed (202)`（上一阶段 182，新增 20：主题 8、渲染 10、重放主题接线 2）。
- `npm run replay -- --theme archive/my-theme.json`：`exported`，主题显示「橙色」，生成 `articles/<标题>.html`。
- 生成的 HTML 实测：5212 字符，`h1=1 h2=6 p=28 ul=1 li=3 strong=1`，无裸 Markdown 标记；外层 `div` 带字体、行高 1.7、内边距 8px。
- 非法主题（`version: 2`）：重放仍 `exported`，主题回退「默认」，警告含「版本只接受 1」。

### 7.3 与方案的偏差

- **主题 `lineHeight` 必须是字符串**：样例 `archive/my-theme.json` 里是 `"1.7"`，方案按数字设计会误判合法样例为非法。改为「数字或数字字符串」都接受，默认主题也用字符串以保持结构一致。
- **代码块的 `showMacBar` / `codeTheme` 未生效**：本阶段只做背景与字号；这两个字段留到需要高亮时再实现，已在边界里写明。

### 7.4 未验证与限制

- `/export --copy` 复制到剪贴板、HTML 单独重试的交互入口（`htmlError` 只到数据层）。
- 浏览器里粘贴进公众号编辑器的实际效果（PRD T12 验收项，留到有交互界面后验证）。
- 主题变更后重新导出已有文件、`/reload` 重载主题。
- 大纲转 HTML。
