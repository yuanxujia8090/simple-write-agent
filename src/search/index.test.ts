/** 搜索结果的素材格式化：保证 URL 在、摘要截断、把「未核实」写进文本。 */
import { describe, expect, it } from "vitest";

import { formatHitsForMaterials } from "./index.js";

const hits = [
  {
    title: "第一篇",
    url: "https://example.com/a",
    description: "很短的摘要",
    position: 1,
  },
  {
    title: "第二篇",
    url: "https://example.com/b",
    description: "长".repeat(300),
    position: 2,
  },
];

describe("formatHitsForMaterials", () => {
  it("带上话题、来源声明与每条链接", () => {
    const text = formatHitsForMaterials("本地写作 Agent", hits);
    expect(text).toContain("[外部搜索] 话题：本地写作 Agent");
    expect(text).toContain("Bing RSS");
    expect(text).toContain("未经核实");
    expect(text).toContain("https://example.com/a");
    expect(text).toContain("https://example.com/b");
  });

  it("长摘要截断到 200 字以内并加省略号", () => {
    const text = formatHitsForMaterials("t", hits);
    expect(text).toContain("长".repeat(200) + "…");
    expect(text).not.toContain("长".repeat(201));
  });

  it("摘要为空时不留空行", () => {
    const text = formatHitsForMaterials("t", [
      { title: "只有标题", url: "https://example.com/c", description: "", position: 1 },
    ]);
    expect(text).not.toContain("摘要：\n");
  });
});
