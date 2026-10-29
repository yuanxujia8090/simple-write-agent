import type {
  ArtifactContent,
  ArtifactKind,
  CreativeBriefContent,
  DraftContent,
  FactReportContent,
  FinalContent,
  MaterialBatchContent,
  OutlineContent,
  ThesisContent,
} from "./types.js";

export type ValidationIssue = { code: string; message: string };

export type ValidationResult = {
  ok: boolean;
  issues: ValidationIssue[];
  warnings: string[];
};

const DRAFT_TARGET_MIN = 2000;
const DRAFT_TARGET_MAX = 5000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function issue(code: string, message: string): ValidationIssue {
  return { code, message };
}

function validateBrief(content: CreativeBriefContent, issues: ValidationIssue[]): void {
  if (text(content.topic) === "") {
    issues.push(issue("brief.topic", "创作简报缺少主题"));
  }
  if (text(content.audience) === "") {
    issues.push(issue("brief.audience", "创作简报缺少目标读者"));
  }
  if (text(content.purpose) === "") {
    issues.push(issue("brief.purpose", "创作简报缺少写作目的"));
  }
}

function validateMaterials(content: MaterialBatchContent, issues: ValidationIssue[]): void {
  if (!Array.isArray(content.items) || content.items.length === 0) {
    issues.push(issue("materials.empty", "素材批次为空，无法提交采纳确认"));
    return;
  }
  content.items.forEach((item, index) => {
    if (text(item.name) === "") {
      issues.push(issue("materials.name", `第 ${index + 1} 条素材缺少名称`));
    }
  });
}

function validateThesis(content: ThesisContent, issues: ValidationIssue[], warnings: string[]): void {
  const candidates = Array.isArray(content.candidates) ? content.candidates : [];
  if (candidates.length < 3 || candidates.length > 5) {
    issues.push(
      issue("thesis.count", `论点候选必须是 3–5 个，当前 ${candidates.length} 个`),
    );
  }
  const ids = new Set<string>();
  candidates.forEach((candidate, index) => {
    const id = text(candidate.id);
    if (id === "") {
      issues.push(issue("thesis.id", `第 ${index + 1} 个论点缺少 id`));
    } else if (ids.has(id)) {
      issues.push(issue("thesis.duplicate_id", `论点 id 重复：${id}`));
    } else {
      ids.add(id);
    }
    if (text(candidate.claim) === "") {
      issues.push(issue("thesis.claim", `第 ${index + 1} 个论点缺少核心主张`));
    }
    if (text(candidate.reasoning) === "") {
      issues.push(issue("thesis.reasoning", `第 ${index + 1} 个论点缺少论证思路`));
    }
    if (text(candidate.relationToBrief) === "") {
      issues.push(issue("thesis.relation", `第 ${index + 1} 个论点缺少与简报的关系`));
    }
  });
  if (text(content.recommendedId) === "" || !ids.has(content.recommendedId)) {
    issues.push(issue("thesis.recommended", "推荐论点必须指向一个存在的候选"));
  }
  if (text(content.rationale) === "") {
    issues.push(issue("thesis.rationale", "缺少推荐依据"));
  }
  if (!Array.isArray(content.risks) || content.risks.length === 0) {
    warnings.push("确认卡没有列出主要风险；确认前建议补充");
  }
}

function validateOutline(content: OutlineContent, issues: ValidationIssue[]): void {
  if (text(content.title) === "") {
    issues.push(issue("outline.title", "大纲缺少标题"));
  }
  const chapters = Array.isArray(content.chapters) ? content.chapters : [];
  if (chapters.length === 0) {
    issues.push(issue("outline.chapters", "大纲至少需要一个章节"));
    return;
  }
  chapters.forEach((chapter, index) => {
    if (text(chapter.heading) === "") {
      issues.push(issue("outline.heading", `第 ${index + 1} 章缺少标题`));
    }
    if (text(chapter.goal) === "") {
      issues.push(issue("outline.goal", `第 ${index + 1} 章缺少写作目标`));
    }
  });
}

function validateDraft(content: DraftContent, issues: ValidationIssue[], warnings: string[]): void {
  const markdown = typeof content.markdown === "string" ? content.markdown : "";
  if (markdown.trim() === "") {
    issues.push(issue("draft.empty", "草稿内容为空"));
    return;
  }
  if (markdown.length < DRAFT_TARGET_MIN || markdown.length > DRAFT_TARGET_MAX) {
    warnings.push(
      `草稿长度 ${markdown.length} 字，超出目标区间 ${DRAFT_TARGET_MIN}–${DRAFT_TARGET_MAX}，不阻止导出`,
    );
  }
}

function validateFactReport(
  content: FactReportContent,
  issues: ValidationIssue[],
): void {
  const items = Array.isArray(content.items) ? content.items : [];
  if (items.length === 0) {
    issues.push(issue("fact.empty", "事实核查报告为空"));
    return;
  }
  const downgrades = Array.isArray(content.downgrades) ? content.downgrades : [];
  items.forEach((item, index) => {
    if (text(item.fact) === "") {
      issues.push(issue("fact.text", `第 ${index + 1} 条事实缺少内容`));
      return;
    }
    if (item.kind === "external_fact" && item.verifyStatus !== "verified") {
      const downgraded = downgrades.some((entry) => entry.fact === item.fact);
      if (!downgraded) {
        issues.push(
          issue(
            "fact.unsupported",
            `外部事实“${item.fact}”没有可验证来源，也没有列入降级改写清单`,
          ),
        );
      }
    }
  });
}

function validateFinal(content: FinalContent, issues: ValidationIssue[]): void {
  if (text(content.title) === "") {
    issues.push(issue("final.title", "终稿缺少标题"));
  }
  if (typeof content.markdown !== "string" || content.markdown.trim() === "") {
    issues.push(issue("final.markdown", "终稿内容为空"));
  }
  if (text(content.factReportArtifactId) === "") {
    issues.push(issue("final.fact_report", "终稿没有关联事实核查报告版本"));
  }
}

/**
 * 阶段产物契约校验。节点只能把通过校验的产物交给门禁；
 * 校验只看结构与必需信息，不做内容质量判断。
 */
export function validateArtifact(kind: ArtifactKind, content: ArtifactContent): ValidationResult {
  const issues: ValidationIssue[] = [];
  const warnings: string[] = [];

  if (!isRecord(content)) {
    return { ok: false, issues: [issue("content.shape", "产物内容必须是对象")], warnings };
  }

  switch (kind) {
    case "creative_brief":
      validateBrief(content as CreativeBriefContent, issues);
      break;
    case "material_batch":
      validateMaterials(content as MaterialBatchContent, issues);
      break;
    case "thesis":
      validateThesis(content as ThesisContent, issues, warnings);
      break;
    case "outline":
      validateOutline(content as OutlineContent, issues);
      break;
    case "draft":
      validateDraft(content as DraftContent, issues, warnings);
      break;
    case "fact_report":
      validateFactReport(content as FactReportContent, issues);
      break;
    case "final":
      validateFinal(content as FinalContent, issues);
      break;
  }

  return { ok: issues.length === 0, issues, warnings };
}
