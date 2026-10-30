/** 主题载入：校验、补齐、回退与原始 JSON 保留。 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { DEFAULT_THEME, loadTheme } from "./theme.js";

const SAMPLE_PATH = fileURLToPath(new URL("../../archive/my-theme.json", import.meta.url));

function readSample(): string {
  return readFileSync(SAMPLE_PATH, "utf8");
}

function inlineTheme(value: unknown): (path: string) => string {
  return () => JSON.stringify(value);
}

describe("主题载入", () => {
  it("不传路径时使用内置默认主题", () => {
    const loaded = loadTheme();
    expect(loaded.source).toBe("default");
    expect(loaded.theme).toEqual(DEFAULT_THEME);
    expect(loaded.raw).toBeNull();
    expect(loaded.warnings).toEqual([]);
  });

  it("能读取 archive/my-theme.json 并保留原始 JSON", () => {
    const loaded = loadTheme({ path: SAMPLE_PATH });
    expect(loaded.source).toBe("file");
    expect(loaded.theme.name).toBe("橙色");
    expect(loaded.theme.designerVariables.primaryColor).toBe("#EF7534");
    expect(loaded.raw).toBe(readSample());
    expect(loaded.warnings).toEqual([]);
  });

  it("缺字段用内置默认补齐，其余字段保持用户值", () => {
    const loaded = loadTheme({
      path: "custom.json",
      readFile: inlineTheme({ version: 1, designerVariables: { paragraphColor: "#111111" } }),
    });
    expect(loaded.source).toBe("file");
    expect(loaded.theme.designerVariables.paragraphColor).toBe("#111111");
    expect(loaded.theme.designerVariables.fontFamily).toBe(
      DEFAULT_THEME.designerVariables.fontFamily,
    );
    expect(loaded.theme.designerVariables.h1).toEqual(DEFAULT_THEME.designerVariables.h1);
    expect(loaded.theme.name).toBe("自定义");
  });

  it("只接受 version 1，其他版本回退并给出提示", () => {
    const loaded = loadTheme({
      path: "v2.json",
      readFile: inlineTheme({ version: 2, designerVariables: {} }),
    });
    expect(loaded.theme).toEqual(DEFAULT_THEME);
    expect(loaded.source).toBe("default");
    expect(loaded.warnings.join()).toContain("版本只接受 1");
  });

  it("字段类型或取值非法时回退并指出字段", () => {
    const loaded = loadTheme({
      path: "bad-color.json",
      readFile: inlineTheme({ version: 1, designerVariables: { primaryColor: "orange" } }),
    });
    expect(loaded.theme).toEqual(DEFAULT_THEME);
    expect(loaded.warnings.join()).toContain("designerVariables.primaryColor");
  });

  it("非法 JSON 与文件不存在都会回退", () => {
    const brokenJson = loadTheme({ path: "broken.json", readFile: () => "{oops" });
    expect(brokenJson.warnings.join()).toContain("不是合法 JSON");

    const missing = loadTheme({
      path: "missing.json",
      readFile: () => {
        throw new Error("ENOENT: no such file");
      },
    });
    expect(missing.warnings.join()).toContain("读取失败");
    expect(missing.theme).toEqual(DEFAULT_THEME);
  });

  it("提供了上一份有效主题时，非法配置回退到它而不是内置默认", () => {
    const previous = {
      ...DEFAULT_THEME,
      name: "上一份",
      designerVariables: { ...DEFAULT_THEME.designerVariables, primaryColor: "#123456" },
    };
    const loaded = loadTheme({
      path: "bad.json",
      previous,
      readFile: inlineTheme({ version: 9 }),
    });
    expect(loaded.theme.name).toBe("上一份");
    expect(loaded.theme.designerVariables.primaryColor).toBe("#123456");
    expect(loaded.source).toBe("fallback");
  });

  it("行高既接受数字也接受样例里的字符串写法", () => {
    const numeric = loadTheme({
      path: "n.json",
      readFile: inlineTheme({ version: 1, designerVariables: { lineHeight: 1.8 } }),
    });
    expect(numeric.warnings).toEqual([]);
    expect(numeric.theme.designerVariables.lineHeight).toBe(1.8);

    const text = loadTheme({
      path: "s.json",
      readFile: inlineTheme({ version: 1, designerVariables: { lineHeight: "1.9" } }),
    });
    expect(text.warnings).toEqual([]);
    expect(text.theme.designerVariables.lineHeight).toBe("1.9");
  });
});
