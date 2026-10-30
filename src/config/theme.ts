/**
 * 主题：`archive/my-theme.json` 的结构 + 内置默认色值。
 * 载入时校验、补齐缺失字段、保留原始 JSON；非法配置回退到上一份有效主题并给出提示。
 */
import { readFileSync } from "node:fs";

import { z } from "zod";

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const color = z.string().regex(HEX, "颜色必须是 #RGB 或 #RRGGBB");
const colorOrInherit = z.union([color, z.literal("inherit")]);
const size = (min: number, max: number) => z.number().min(min).max(max);

const headingSchema = z.object({
  fontSize: size(8, 48),
  color,
  marginTop: size(0, 200),
  marginBottom: size(0, 200),
  centered: z.boolean(),
  fontWeight: z.enum(["normal", "bold", "bolder", "lighter", "100", "200", "300", "400", "500", "600", "700", "800", "900"]),
  letterSpacing: size(-5, 20),
});

const designerVariablesSchema = z.object({
  fontFamily: z.string().min(1),
  fontSize: z.string().min(1),
  primaryColor: color,
  /** 样例里是字符串 `"1.7"`：保持原结构，数字也接受。 */
  lineHeight: z.union([size(1, 3), z.string().regex(/^\d+(?:\.\d+)?$/, "行高应为数字或数字字符串")]),
  pagePadding: size(0, 100),
  baseLetterSpacing: size(-5, 20),
  h1: headingSchema,
  h2: headingSchema,
  h3: headingSchema,
  h4: headingSchema,
  paragraphMargin: size(0, 100),
  paragraphPadding: size(0, 100),
  paragraphColor: color,
  textIndent: z.boolean(),
  textJustify: z.boolean(),
  quoteBackground: color,
  quoteBorderColor: color,
  quoteTextColor: color,
  quotePreset: z.enum(["left-border", "background", "none"]),
  quoteBorderStyle: z.enum(["solid", "dashed", "dotted", "none"]),
  quoteBorderWidth: size(0, 20),
  quotePaddingX: size(0, 60),
  quotePaddingY: size(0, 60),
  quoteFontSize: size(8, 32),
  quoteLineHeight: size(1, 3),
  quoteTextCentered: z.boolean(),
  codeBackground: color,
  codeFontSize: size(8, 32),
  inlineCodeColor: color,
  inlineCodeBackground: color,
  inlineCodeStyle: z.enum(["simple", "rounded", "none"]),
  showMacBar: z.boolean(),
  codeTheme: z.string().min(1),
  imageMargin: size(0, 100),
  imageBorderRadius: size(0, 50),
  imageShadow: z.boolean(),
  imageCaptionColor: color,
  imageCaptionFontSize: size(8, 32),
  imageCaptionTextAlign: z.enum(["left", "center", "right"]),
  linkColor: color,
  linkUnderline: z.boolean(),
  italicColor: color,
  delColor: color,
  markBackground: color,
  markColor: color,
  underlineStyle: z.enum(["solid", "dashed", "dotted", "none"]),
  underlineColor: color,
  strongStyle: z.enum(["color", "bold", "both"]),
  strongColor: color,
  tableHeaderBackground: color,
  tableHeaderColor: colorOrInherit,
  tableBorderColor: color,
  tableZebra: z.boolean(),
  hrColor: color,
  hrHeight: size(0, 10),
  hrMargin: size(0, 100),
  hrStyle: z.enum(["solid", "dashed", "dotted", "none"]),
  ulStyle: z.enum(["disc", "circle", "square", "none"]),
  ulStyleL2: z.enum(["disc", "circle", "square", "none"]),
  olStyle: z.enum(["decimal", "lower-alpha", "upper-alpha", "lower-roman"]),
  olStyleL2: z.enum(["decimal", "lower-alpha", "upper-alpha", "lower-roman"]),
  listSpacing: size(0, 60),
  listMarkerColor: color,
  listMarkerColorL2: color,
  ulFontSize: z.string().min(1),
  olFontSize: z.string().min(1),
  footnoteColor: color,
  footnoteFontSize: size(8, 32),
  footnoteHeader: z.string(),
  footnoteHeaderColor: color,
  footnoteHeaderStyle: z.enum(["left-border", "background", "none"]),
  calloutStyle: z.string().min(1),
  mermaidTheme: z.string().min(1),
});

const themeFileSchema = z.object({
  version: z.literal(1, { message: "版本只接受 1；其他版本不做迁移" }),
  name: z.string().optional(),
  editorMode: z.string().optional(),
  designerVariables: designerVariablesSchema.partial(),
});

export type DesignerVariables = z.infer<typeof designerVariablesSchema>;
export type HeadingStyle = z.infer<typeof headingSchema>;

export type Theme = {
  version: 1;
  name: string;
  designerVariables: DesignerVariables;
};

/** 内置默认主题：字段结构与 `archive/my-theme.json` 一致，色值取中性蓝。 */
export const DEFAULT_THEME: Theme = {
  version: 1,
  name: "默认",
  designerVariables: {
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif",
    fontSize: "16px",
    primaryColor: "#2F6BFF",
    lineHeight: "1.7",
    pagePadding: 8,
    baseLetterSpacing: 0,
    h1: {
      fontSize: 24,
      color: "#2F6BFF",
      marginTop: 40,
      marginBottom: 30,
      centered: false,
      fontWeight: "bold",
      letterSpacing: 0,
    },
    h2: {
      fontSize: 20,
      color: "#2F6BFF",
      marginTop: 30,
      marginBottom: 20,
      centered: false,
      fontWeight: "bold",
      letterSpacing: 0,
    },
    h3: {
      fontSize: 18,
      color: "#2F6BFF",
      marginTop: 25,
      marginBottom: 15,
      centered: false,
      fontWeight: "bold",
      letterSpacing: 0,
    },
    h4: {
      fontSize: 16,
      color: "#2F6BFF",
      marginTop: 20,
      marginBottom: 10,
      centered: false,
      fontWeight: "bold",
      letterSpacing: 0,
    },
    paragraphMargin: 16,
    paragraphPadding: 0,
    paragraphColor: "#333",
    textIndent: false,
    textJustify: true,
    quoteBackground: "#f5f5f5",
    quoteBorderColor: "#2F6BFF",
    quoteTextColor: "#666",
    quotePreset: "left-border",
    quoteBorderStyle: "solid",
    quoteBorderWidth: 4,
    quotePaddingX: 16,
    quotePaddingY: 12,
    quoteFontSize: 16,
    quoteLineHeight: 1.6,
    quoteTextCentered: false,
    codeBackground: "#f5f5f5",
    codeFontSize: 13,
    inlineCodeColor: "#2F6BFF",
    inlineCodeBackground: "#eef3ff",
    inlineCodeStyle: "simple",
    showMacBar: true,
    codeTheme: "github",
    imageMargin: 20,
    imageBorderRadius: 4,
    imageShadow: false,
    imageCaptionColor: "#4a4a4a",
    imageCaptionFontSize: 14,
    imageCaptionTextAlign: "center",
    linkColor: "#2F6BFF",
    linkUnderline: true,
    italicColor: "#2F6BFF",
    delColor: "#2F6BFF",
    markBackground: "#fff3bf",
    markColor: "#2F6BFF",
    underlineStyle: "solid",
    underlineColor: "#2F6BFF",
    strongStyle: "color",
    strongColor: "#1a3f99",
    tableHeaderBackground: "#f8f8f8",
    tableHeaderColor: "inherit",
    tableBorderColor: "#dfe2e5",
    tableZebra: true,
    hrColor: "#2F6BFF",
    hrHeight: 1,
    hrMargin: 20,
    hrStyle: "solid",
    ulStyle: "disc",
    ulStyleL2: "circle",
    olStyle: "decimal",
    olStyleL2: "lower-alpha",
    listSpacing: 4,
    listMarkerColor: "#2F6BFF",
    listMarkerColorL2: "#2F6BFF",
    ulFontSize: "inherit",
    olFontSize: "inherit",
    footnoteColor: "#2F6BFF",
    footnoteFontSize: 12,
    footnoteHeader: "参考资料",
    footnoteHeaderColor: "#2F6BFF",
    footnoteHeaderStyle: "left-border",
    calloutStyle: "default",
    mermaidTheme: "base",
  },
};

export type LoadedTheme = {
  /** 补齐后的运行时主题。 */
  theme: Theme;
  /** 用户提供的原始 JSON 文本；使用内置默认时为 null。 */
  raw: string | null;
  /** 实际来源：内置默认、指定文件、回退到上一份有效主题。 */
  source: "default" | "file" | "fallback";
  warnings: string[];
};

export type LoadThemeOptions = {
  /** 主题文件路径；不传则用内置默认主题。 */
  path?: string | undefined;
  /** 上一份有效主题：本次配置非法时回退使用。 */
  previous?: Theme | undefined;
  /** 测试注入的文件读取，默认读磁盘。 */
  readFile?: (path: string) => string;
};

function mergeVariables(base: DesignerVariables, patch: Partial<DesignerVariables>): DesignerVariables {
  return { ...base, ...patch };
}

/**
 * 载入主题。任何错误都退化为「上一份有效主题 / 内置默认 + 警告」，
 * 不把用户挡在写作流程外面（PRD §4.5：非法配置保留旧主题并提示错误）。
 */
export function loadTheme(options: LoadThemeOptions = {}): LoadedTheme {
  const fallback = options.previous ?? DEFAULT_THEME;
  const fallbackResult = (warning: string): LoadedTheme => ({
    theme: fallback,
    raw: null,
    source: options.previous === undefined ? "default" : "fallback",
    warnings: [warning],
  });

  if (options.path === undefined) {
    return { theme: DEFAULT_THEME, raw: null, source: "default", warnings: [] };
  }

  const readFile = options.readFile ?? ((path: string) => readFileSync(path, "utf8"));
  let raw: string;
  try {
    raw = readFile(options.path);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return fallbackResult(`主题文件读取失败，已使用${options.previous ? "上一份有效主题" : "内置默认主题"}：${detail}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return fallbackResult(`主题文件不是合法 JSON，已使用${options.previous ? "上一份有效主题" : "内置默认主题"}：${detail}`);
  }

  const result = themeFileSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join(".") || "(根)"}：${issue.message}`)
      .join("；");
    return fallbackResult(
      `主题配置不合法，已使用${options.previous ? "上一份有效主题" : "内置默认主题"}：${issues}`,
    );
  }

  const variables = mergeVariables(
    DEFAULT_THEME.designerVariables,
    result.data.designerVariables as Partial<DesignerVariables>,
  );
  return {
    theme: {
      version: 1,
      name: result.data.name ?? "自定义",
      designerVariables: variables,
    },
    raw,
    source: "file",
    warnings: [],
  };
}
