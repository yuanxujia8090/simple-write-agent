import { describe, expect, it } from "vitest";

import { validateArtifact } from "./contracts.js";
import { gateForStage, gatesForMode, rollbackStageFor, stageAfterApprove } from "./gates.js";
import type { ArtifactContent, FactReportContent, ThesisContent } from "./types.js";

const brief = { topic: "跨端同步", audience: "前端工程师", purpose: "少踩坑" };

function thesisWith(count: number): ThesisContent {
  return {
    candidates: Array.from({ length: count }, (_, index) => ({
      id: `c${index + 1}`,
      claim: `主张${index + 1}`,
      reasoning: `理由${index + 1}`,
      relationToBrief: `关系${index + 1}`,
    })),
    recommendedId: "c1",
    rationale: "最贴近读者痛点",
    risks: ["可能需要更多案例"],
  };
}

describe("validateArtifact 创作简报", () => {
  it("字段齐全时通过", () => {
    expect(validateArtifact("creative_brief", brief).ok).toBe(true);
  });

  it("缺目标读者和目的时逐项报错", () => {
    const result = validateArtifact("creative_brief", { topic: "x", audience: " ", purpose: "" });
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(["brief.audience", "brief.purpose"]);
  });
});

describe("validateArtifact 素材批次", () => {
  it("空批次被拒", () => {
    const result = validateArtifact("material_batch", { items: [] });
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe("materials.empty");
  });

  it("素材缺名称被拒", () => {
    const result = validateArtifact("material_batch", {
      items: [{ name: "", sourcePath: null, note: "笔记" }],
    });
    expect(result.ok).toBe(false);
  });
});

describe("validateArtifact 论点", () => {
  it("3 个候选且推荐存在时通过", () => {
    expect(validateArtifact("thesis", thesisWith(3)).ok).toBe(true);
  });

  it("少于 3 个候选被拒", () => {
    const result = validateArtifact("thesis", thesisWith(2));
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.code === "thesis.count")).toBe(true);
  });

  it("超过 5 个候选被拒", () => {
    expect(validateArtifact("thesis", thesisWith(6)).ok).toBe(false);
  });

  it("推荐指向不存在的候选被拒", () => {
    const content = { ...thesisWith(3), recommendedId: "missing" };
    const result = validateArtifact("thesis", content);
    expect(result.issues.some((issue) => issue.code === "thesis.recommended")).toBe(true);
  });

  it("id 重复被拒", () => {
    const content = thesisWith(3);
    content.candidates[1]!.id = "c1";
    const result = validateArtifact("thesis", content);
    expect(result.issues.some((issue) => issue.code === "thesis.duplicate_id")).toBe(true);
  });

  it("缺推荐依据被拒", () => {
    const result = validateArtifact("thesis", { ...thesisWith(3), rationale: "  " });
    expect(result.issues.some((issue) => issue.code === "thesis.rationale")).toBe(true);
  });

  it("没有风险时只给提醒，不阻止确认", () => {
    const result = validateArtifact("thesis", { ...thesisWith(3), risks: [] });
    expect(result.ok).toBe(true);
    expect(result.warnings).toContain("确认卡没有列出主要风险；确认前建议补充");
  });
});

describe("validateArtifact 大纲", () => {
  it("有标题和章节时通过", () => {
    const result = validateArtifact("outline", {
      title: "标题",
      chapters: [{ heading: "一", goal: "讲清楚问题" }],
    });
    expect(result.ok).toBe(true);
  });

  it("空章节列表被拒", () => {
    const result = validateArtifact("outline", { title: "标题", chapters: [] });
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe("outline.chapters");
  });

  it("章节缺写作目标被拒", () => {
    const result = validateArtifact("outline", {
      title: "标题",
      chapters: [{ heading: "一", goal: "" }],
    });
    expect(result.issues.some((issue) => issue.code === "outline.goal")).toBe(true);
  });
});

describe("validateArtifact 草稿", () => {
  it("空草稿被拒", () => {
    expect(validateArtifact("draft", { title: "t", markdown: "  " }).ok).toBe(false);
  });

  it("长度偏离目标只提醒，不阻止导出", () => {
    const result = validateArtifact("draft", { title: "t", markdown: "短草稿" });
    expect(result.ok).toBe(true);
    expect(result.warnings[0]).toContain("超出目标区间");
  });
});

describe("validateArtifact 事实核查报告", () => {
  const base: FactReportContent = {
    items: [
      {
        fact: "某库 2025 年发布 2.0",
        source: "https://example.com/release",
        kind: "external_fact",
        verifyStatus: "verified",
        reasonCode: null,
      },
    ],
    downgrades: [],
  };

  it("外部事实有来源时通过", () => {
    expect(validateArtifact("fact_report", base).ok).toBe(true);
  });

  it("外部事实无来源且未降级时被拒", () => {
    const content: FactReportContent = {
      items: [{ ...base.items[0]!, source: null, verifyStatus: "unverified" }],
      downgrades: [],
    };
    const result = validateArtifact("fact_report", content);
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe("fact.unsupported");
  });

  it("外部事实无来源但列入降级清单时通过", () => {
    const content: FactReportContent = {
      items: [{ ...base.items[0]!, source: null, verifyStatus: "unverified" }],
      downgrades: [{ fact: "某库 2025 年发布 2.0", reasonCode: "missing_source" }],
    };
    expect(validateArtifact("fact_report", content).ok).toBe(true);
  });

  it("个人经验不算外部硬事实，不要求来源", () => {
    const content: FactReportContent = {
      items: [
        {
          fact: "我在项目里踩过这个坑",
          source: null,
          kind: "personal_experience",
          verifyStatus: "unverified",
          reasonCode: null,
        },
      ],
      downgrades: [],
    };
    expect(validateArtifact("fact_report", content).ok).toBe(true);
  });
});

describe("validateArtifact 终稿", () => {
  it("缺事实报告关联被拒", () => {
    const content: ArtifactContent = {
      title: "标题",
      markdown: "正文",
      factReportArtifactId: "",
    };
    const result = validateArtifact("final", content);
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe("final.fact_report");
  });
});

describe("门禁定义", () => {
  it("普通模式 5 个门禁，快速模式只剩论点和终稿", () => {
    expect(gatesForMode("normal").map((gate) => gate.id)).toEqual([
      "materials",
      "thesis",
      "outline",
      "fact_report",
      "final",
    ]);
    expect(gatesForMode("fast").map((gate) => gate.id)).toEqual(["thesis", "final"]);
  });

  it("拒绝回退目标符合 PRD 对照表", () => {
    expect(rollbackStageFor("thesis")).toBe("thesis");
    expect(rollbackStageFor("outline")).toBe("outline");
    expect(rollbackStageFor("fact_report")).toBe("research");
    expect(rollbackStageFor("final")).toBe("drafting");
  });

  it("批准后的阶段：普通模式逐阶段推进，快速模式论点直接进草稿", () => {
    expect(stageAfterApprove("thesis", "normal")).toBe("outline");
    expect(stageAfterApprove("outline", "normal")).toBe("drafting");
    expect(stageAfterApprove("final", "normal")).toBe("exported");
    expect(stageAfterApprove("thesis", "fast")).toBe("drafting");
  });

  it("review 阶段先展示事实核查门禁", () => {
    expect(gateForStage("review", "normal")?.id).toBe("fact_report");
    expect(gateForStage("exported", "normal")).toBeNull();
  });
});
