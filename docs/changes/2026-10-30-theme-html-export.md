# 变更：主题配置与确定性 HTML 导出

- 日期：2026-10-30
- 状态：已完成（限制见文末）
- 关联需求：[需求](../wiki/01-prd-writing-agent.md) §4.5、§4.6
- 关联决策：D6（Markdown 主稿 + 确定性 HTML）
- 阶段方案：[主题配置与确定性 HTML 导出](../design/2026-10-30-theme-html-export.md)

## 变更目的

导出现在会同时产出两份文件：可编辑的 Markdown 主稿，和由同一份主稿按主题生成的公众号内联样式 HTML。主题写错不会把程序打挂，只回退并提示。

## 实际改动

- `src/config/theme.ts`（新增）：zod 主题 schema、内置默认主题、`loadTheme()`（校验/补齐/保留原始 JSON/回退上一份有效主题）。
- `src/render/html.ts`（新增）：mdast（GFM）→ 内联样式 HTML；支持标题、段落、引用、代码、行内代码、列表（含嵌套）、表格、图片、强调/加粗/删除、链接、分隔线、换行；子集外节点保留原文并记警告；文本与属性全部转义。
- `src/domain/files.ts`：新增 `WriteHtmlInput` 与 `FileWriter.writeHtml`。
- `src/artifacts/files.ts`：写 `<slug>.html`，与 Markdown 同目录同 slug；重新导出时按 `replacePath` 替换本会话自己的 HTML。
- `src/agent/graph.ts`：导出节点渲染 HTML 并写盘；HTML 失败只记 `htmlError`，Markdown 已导出（部分成功）。
- `src/domain/service.ts`：`RunOutput` 增加 `htmlPath`、`htmlError`。
- `src/agent/runner.ts`、`src/runtime.ts`：接受 `theme` 选项并透传。
- `src/cli/replay.ts`、`src/cli/replay-main.ts`：新增 `--theme <路径>`；输出多一行 HTML 路径与主题来源/警告。
- `package.json`：新增依赖 `mdast-util-from-markdown@2.1.0`、`mdast-util-gfm@3.1.0`、`micromark-extension-gfm@3.0.0`，开发依赖 `@types/mdast@4.0.4`（与总体技术方案 §6.6 的 mdast 选型一致）。
- 测试：`src/config/theme.test.ts`（8 个）、`src/render/html.test.ts`（10 个）、`src/cli/replay.test.ts` 新增 2 个。

## 验证

- 命令：`npm run typecheck`
  结果：通过，无输出。

- 命令：`npm test`
  结果：`Test Files 16 passed (16)`，`Tests 202 passed (202)`（上一阶段 182，新增 20）。

- 命令：`npm run build`
  结果：构建成功。

- 命令：`npm run replay -- --workspace /tmp/wa-html --theme archive/my-theme.json`
  结果：`exported`；目录内同时有 `articles/把知识库从收藏夹变成工作台.md` 与 `.html`；主题显示「橙色」。

- HTML 内容核对：5212 字符；`h1=1`、`h2=6`、`p=28`、`ul=1`、`li=3`、`strong=1`；无裸 Markdown 标记；外层容器带字体、`line-height: 1.7`、`padding: 8px`。

- 非法主题：`{"version": 2}` → 重放仍 `exported`，主题回退「默认」，警告含「版本只接受 1」。

- 命令：`git diff --check`
  结果：无输出（通过）。

## 未完成事项与风险

- **`/export --copy` 与 HTML 单独重试**：数据层已有 `htmlError`，交互入口等 T13/T14。
- **公众号编辑器粘贴效果未验证**：需要交互界面与人工粘贴；PRD T12 的浏览器验收项仍开放。
- **`showMacBar` / `codeTheme` 未生效**：代码块只应用背景与字号，不做高亮。
- **大纲不生成 HTML**：只有终稿双输出。
- **风险：主题字段校验与样例结构绑定**：`lineHeight` 在样例里是字符串，schema 两种都接受；若将来样例改结构，需要同步 schema 与测试。
- **风险：渲染器不做 HTML 清洗**：只处理本程序生成的主稿，外部不可信 Markdown 里的 HTML 节点会被当作「不支持节点」转义输出，而不是执行。
