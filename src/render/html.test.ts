/** Markdown → 内联样式 HTML：节点覆盖、原文保留、确定性与转义。 */
import { describe, expect, it } from "vitest";

import { DEFAULT_THEME, type Theme } from "../config/theme.js";
import { escapeHtml, renderMarkdownToHtml } from "./html.js";

function render(markdown: string, theme: Theme = DEFAULT_THEME) {
  return renderMarkdownToHtml(markdown, theme);
}

const ORANGE: Theme = {
  version: 1,
  name: "橙色",
  designerVariables: {
    ...DEFAULT_THEME.designerVariables,
    primaryColor: "#EF7534",
    h1: { ...DEFAULT_THEME.designerVariables.h1, color: "#EF7534" },
    h2: { ...DEFAULT_THEME.designerVariables.h2, color: "#EF7534" },
    paragraphColor: "#222222",
  },
};

describe("Markdown 渲染", () => {
  it("标题按层级渲染并带上主题颜色与字号", () => {
    const { html, warnings } = render("# 一级\n\n## 二级\n\n### 三级\n\n#### 四级\n\n##### 五级", ORANGE);
    expect(warnings).toEqual([]);
    expect(html).toContain("<h1");
    expect(html).toContain("<h2");
    expect(html).toContain("<h3");
    expect(html).toContain("<h4");
    expect(html).toContain("<h5");
    expect(html).toContain("color: #EF7534");
    expect(html).toContain("font-size: 24px");
    expect(html).not.toContain("## 二级");
  });

  it("段落、强调、加粗、行内代码、链接与删除线", () => {
    const { html, warnings } = render(
      "这是**加粗**和*斜体*，还有 `code` 与 [链接](https://example.com)，~~删除~~。",
      ORANGE,
    );
    expect(warnings).toEqual([]);
    expect(html).toContain("<p");
    expect(html).toContain("color: #222222");
    expect(html).toContain("<strong");
    expect(html).toContain("<em");
    expect(html).toContain("<code");
    expect(html).toContain('<a href="https://example.com"');
    expect(html).toContain("<del");
  });

  it("引用、代码块、分隔线使用主题样式", () => {
    const markdown = "> 引用一句\n\n```ts\nconst a = 1;\n```\n\n---\n";
    const { html, warnings } = render(markdown, ORANGE);
    expect(warnings).toEqual([]);
    expect(html).toContain("<blockquote");
    expect(html).toContain("border-left: 4px solid");
    expect(html).toContain("<pre");
    expect(html).toContain("const a = 1;");
    expect(html).toContain("<hr");
  });

  it("有序、无序与嵌套列表使用不同符号", () => {
    const markdown = "- 一\n- 二\n  - 二点一\n\n1. 甲\n2. 乙\n";
    const { html, warnings } = render(markdown, ORANGE);
    expect(warnings).toEqual([]);
    expect(html).toContain('<ul style="list-style-type: disc');
    expect(html).toContain("list-style-type: circle");
    expect(html).toContain('<ol style="list-style-type: decimal');
    expect(html.match(/<li/g)).toHaveLength(5);
  });

  it("GFM 表格渲染成带边框的行与单元格", () => {
    const markdown = "| 项 | 说明 |\n| --- | --- |\n| A | 第一行 |\n| B | 第二行 |\n";
    const { html, warnings } = render(markdown, ORANGE);
    expect(warnings).toEqual([]);
    expect(html).toContain("<table");
    expect(html).toContain("<th");
    expect(html).toContain("font-weight: bold");
    expect(html.match(/<td/g)).toHaveLength(4);
  });

  it("图片带圆角与宽度约束", () => {
    const { html, warnings } = render("![封面](https://example.com/a.png)", ORANGE);
    expect(warnings).toEqual([]);
    expect(html).toContain('<img src="https://example.com/a.png"');
    expect(html).toContain('alt="封面"');
    expect(html).toContain("max-width: 100%");
  });

  it("子集之外的节点保留原文并给出警告", () => {
    const markdown = "正常段落\n\n<div class=\"raw\">原始 HTML</div>\n";
    const { html, warnings } = render(markdown, ORANGE);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.nodeType).toBe("html");
    expect(warnings[0]?.source).toContain("<div class=\"raw\">");
    expect(html).toContain("&lt;div class=&quot;raw&quot;&gt;");
  });

  it("正文里的标签会被转义，不会变成可执行 HTML", () => {
    const { html } = render("警惕 <script>alert(1)</script> 这种写法", ORANGE);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(escapeHtml('<a href="x">')).toBe("&lt;a href=&quot;x&quot;&gt;");
  });

  it("同一份主稿与主题两次渲染结果完全一致", () => {
    const markdown = "# 标题\n\n段落 **加粗**\n\n- 列表\n\n| a | b |\n| - | - |\n| 1 | 2 |\n";
    expect(render(markdown, ORANGE).html).toBe(render(markdown, ORANGE).html);
  });

  it("外层容器带上字体、行高与内边距", () => {
    const { html } = render("正文", ORANGE);
    expect(html.startsWith("<div style=")).toBe(true);
    expect(html).toContain("font-family:");
    expect(html).toContain("line-height: 1.7");
    expect(html).toContain("padding: 8px");
  });
});
