/**
 * Markdown → 公众号内联样式 HTML。
 * 纯函数：同一份主稿 + 同一份主题必然得到同一份 HTML（无时间戳、无随机 id）。
 * 支持 PRD §4.6 的 mdast 子集；子集之外的节点保留原文并记警告，不静默丢弃。
 */
import type { Nodes, PhrasingContent, RootContent } from "mdast";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfm } from "micromark-extension-gfm";

import type { DesignerVariables, HeadingStyle, Theme } from "../config/theme.js";

export type RenderWarning = {
  /** mdast 节点类型，如 `html`、`footnoteDefinition`。 */
  nodeType: string;
  reason: string;
  /** 原样保留的 Markdown 片段。 */
  source: string;
};

export type RenderResult = {
  html: string;
  warnings: RenderWarning[];
};

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (char) => ESCAPES[char] ?? char);
}

function style(pairs: (string | null | false | undefined)[]): string {
  const parts = pairs.filter((item): item is string => typeof item === "string" && item !== "");
  return parts.length === 0 ? "" : ` style="${parts.join("; ")}"`;
}

function px(value: number): string {
  return `${value}px`;
}

/** 层级超过 4 的标题复用 h4 样式，标签本身保持真实层级。 */
function headingStyleOf(vars: DesignerVariables, depth: number): HeadingStyle {
  if (depth <= 1) return vars.h1;
  if (depth === 2) return vars.h2;
  if (depth === 3) return vars.h3;
  return vars.h4;
}

function headingHtml(vars: DesignerVariables, depth: number, inner: string): string {
  const tag = `h${Math.min(Math.max(depth, 1), 6)}`;
  const styleValue = headingStyleOf(vars, depth);
  return `<${tag}${style([
    `font-size: ${px(styleValue.fontSize)}`,
    `color: ${styleValue.color}`,
    `margin: ${px(styleValue.marginTop)} 0 ${px(styleValue.marginBottom)}`,
    `font-weight: ${styleValue.fontWeight}`,
    styleValue.centered ? "text-align: center" : null,
    styleValue.letterSpacing === 0 ? null : `letter-spacing: ${px(styleValue.letterSpacing)}`,
    "line-height: 1.4",
  ])}>${inner}</${tag}>`;
}

function paragraphStyle(vars: DesignerVariables): string {
  return style([
    `margin: ${px(vars.paragraphMargin)} 0`,
    vars.paragraphPadding === 0 ? null : `padding: ${px(vars.paragraphPadding)} 0`,
    `color: ${vars.paragraphColor}`,
    vars.textIndent ? "text-indent: 2em" : null,
    vars.textJustify ? "text-align: justify" : null,
  ]);
}

function quoteStyle(vars: DesignerVariables): string {
  const border =
    vars.quotePreset === "left-border"
      ? [`border-left: ${px(vars.quoteBorderWidth)} ${vars.quoteBorderStyle} ${vars.quoteBorderColor}`]
      : [];
  const background = vars.quotePreset === "none" ? [] : [`background: ${vars.quoteBackground}`];
  return style([
    ...border,
    ...background,
    `padding: ${px(vars.quotePaddingY)} ${px(vars.quotePaddingX)}`,
    `margin: ${px(vars.paragraphMargin)} 0`,
    `color: ${vars.quoteTextColor}`,
    `font-size: ${px(vars.quoteFontSize)}`,
    `line-height: ${vars.quoteLineHeight}`,
    vars.quoteTextCentered ? "text-align: center" : null,
  ]);
}

function listStyle(vars: DesignerVariables, ordered: boolean, depth: number): string {
  const marker = ordered ? (depth >= 2 ? vars.olStyleL2 : vars.olStyle) : depth >= 2 ? vars.ulStyleL2 : vars.ulStyle;
  return style([
    `list-style-type: ${marker}`,
    `margin: ${px(vars.listSpacing)} 0`,
    `padding-left: 1.6em`,
    `color: ${depth >= 2 ? vars.listMarkerColorL2 : vars.listMarkerColor}`,
  ]);
}

function renderInline(theme: Theme, node: PhrasingContent, warnings: RenderWarning[]): string {
  const vars = theme.designerVariables;
  switch (node.type) {
    case "text":
      return escapeHtml(node.value);
    case "emphasis":
      return `<em${style([`color: ${vars.italicColor}`, "font-style: italic"])}>${renderChildren(theme, node.children, warnings)}</em>`;
    case "strong": {
      const css =
        vars.strongStyle === "bold"
          ? ["font-weight: bold"]
          : vars.strongStyle === "color"
            ? [`color: ${vars.strongColor}`, "font-weight: bold"]
            : [`color: ${vars.strongColor}`, "font-weight: bold"];
      return `<strong${style(css)}>${renderChildren(theme, node.children, warnings)}</strong>`;
    }
    case "delete":
      return `<del${style([`color: ${vars.delColor}`])}>${renderChildren(theme, node.children, warnings)}</del>`;
    case "inlineCode":
      return `<code${style([
        `color: ${vars.inlineCodeColor}`,
        `background: ${vars.inlineCodeBackground}`,
        "padding: 2px 4px",
        vars.inlineCodeStyle === "rounded" ? "border-radius: 4px" : null,
        "font-size: 0.9em",
        "font-family: ui-monospace, SFMono-Regular, Menlo, monospace",
      ])}>${escapeHtml(node.value)}</code>`;
    case "link":
      return `<a href="${escapeHtml(node.url)}"${style([
        `color: ${vars.linkColor}`,
        vars.linkUnderline ? "text-decoration: underline" : "text-decoration: none",
      ])}>${renderChildren(theme, node.children, warnings)}</a>`;
    case "image":
      return `<img src="${escapeHtml(node.url)}" alt="${escapeHtml(node.alt ?? "")}"${style([
        "max-width: 100%",
        `border-radius: ${px(vars.imageBorderRadius)}`,
        `margin: ${px(vars.imageMargin)} 0`,
        vars.imageShadow ? "box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12)" : null,
        "display: block",
      ])}>`;
    case "break":
      return "<br>";
    default:
      warnings.push({
        nodeType: node.type,
        reason: "行内节点不在支持子集内，已保留原文",
        source: sourceOf(node),
      });
      return escapeHtml(sourceOf(node));
  }
}

function renderChildren(theme: Theme, children: PhrasingContent[], warnings: RenderWarning[]): string {
  return children.map((child) => renderInline(theme, child, warnings)).join("");
}

function renderBlock(
  theme: Theme,
  node: RootContent,
  warnings: RenderWarning[],
  markdown: string,
  listDepth: number,
): string {
  const vars = theme.designerVariables;
  switch (node.type) {
    case "heading":
      return headingHtml(vars, node.depth, renderChildren(theme, node.children, warnings));
    case "paragraph":
      return `<p${paragraphStyle(vars)}>${renderChildren(theme, node.children, warnings)}</p>`;
    case "blockquote":
      return `<blockquote${quoteStyle(vars)}>${node.children
        .map((child) => renderBlock(theme, child, warnings, markdown, listDepth))
        .join("")}</blockquote>`;
    case "code":
      return `<pre${style([
        `background: ${vars.codeBackground}`,
        `font-size: ${px(vars.codeFontSize)}`,
        "padding: 12px 16px",
        "border-radius: 6px",
        "overflow-x: auto",
        "line-height: 1.6",
        "font-family: ui-monospace, SFMono-Regular, Menlo, monospace",
      ])}><code>${escapeHtml(node.value)}</code></pre>`;
    case "list": {
      const tag = node.ordered === true ? "ol" : "ul";
      const depth = listDepth + 1;
      const items = node.children
        .map((item) => {
          const inner = item.children
            .map((child) => renderBlock(theme, child, warnings, markdown, depth))
            .join("");
          return `<li${style([`color: ${vars.paragraphColor}`, `margin: ${px(vars.listSpacing)} 0`])}>${inner}</li>`;
        })
        .join("");
      return `<${tag}${listStyle(vars, node.ordered === true, depth)}>${items}</${tag}>`;
    }
    case "table": {
      const rows = node.children.map((row, rowIndex) => {
        const cells = row.children
          .map((cell) => {
            const isHeader = rowIndex === 0;
            const tag = isHeader ? "th" : "td";
            const headerColor = vars.tableHeaderColor === "inherit" ? vars.paragraphColor : vars.tableHeaderColor;
            return `<${tag}${style([
              `border: 1px solid ${vars.tableBorderColor}`,
              "padding: 8px 12px",
              isHeader ? `background: ${vars.tableHeaderBackground}` : null,
              isHeader ? `color: ${headerColor}` : null,
              isHeader ? "font-weight: bold" : null,
              !isHeader && vars.tableZebra && rowIndex % 2 === 0 ? "background: #fafafa" : null,
            ])}>${renderChildren(theme, cell.children, warnings)}</${tag}>`;
          })
          .join("");
        return `<tr>${cells}</tr>`;
      });
      return `<table${style([
        "border-collapse: collapse",
        "width: 100%",
        `margin: ${px(vars.paragraphMargin)} 0`,
        `font-size: ${vars.fontSize}`,
      ])}>${rows.join("")}</table>`;
    }
    case "thematicBreak":
      return `<hr${style([
        `border: none`,
        `border-top: ${px(vars.hrHeight)} ${vars.hrStyle} ${vars.hrColor}`,
        `margin: ${px(vars.hrMargin)} 0`,
      ])}>`;
    default:
      warnings.push({
        nodeType: node.type,
        reason: "块级节点不在支持子集内，已保留原文",
        source: sourceOf(node, markdown),
      });
      return `<p${paragraphStyle(vars)}>${escapeHtml(sourceOf(node, markdown))}</p>`;
  }
}

/** 取原文片段用于「不支持节点」的原样保留。 */
function sourceOf(node: Nodes, markdown?: string): string {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (markdown !== undefined && start !== undefined && end !== undefined) {
    return markdown.slice(start, end);
  }
  if ("value" in node && typeof node.value === "string") {
    return node.value;
  }
  return "";
}

export function renderMarkdownToHtml(markdown: string, theme: Theme): RenderResult {
  const tree = fromMarkdown(markdown, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
  const vars = theme.designerVariables;
  const warnings: RenderWarning[] = [];

  const body = tree.children
    .map((node) => renderBlock(theme, node, warnings, markdown, 0))
    .join("\n");

  const wrapper = `<div${style([
    `font-family: ${vars.fontFamily}`,
    `font-size: ${vars.fontSize}`,
    `line-height: ${vars.lineHeight}`,
    `color: ${vars.paragraphColor}`,
    `letter-spacing: ${px(vars.baseLetterSpacing)}`,
    `padding: ${px(vars.pagePadding)}`,
    "text-align: left",
    "word-break: break-word",
  ])}>${body}</div>`;

  return { html: wrapper, warnings };
}
