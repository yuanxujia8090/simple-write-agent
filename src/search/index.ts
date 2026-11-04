/**
 * 搜索能力的对外入口：目前只有 Bing RSS 一个兜底实现。
 * 以后加 Tavily 时，在这里按配置挑实现，上层（CLI/编排）不改。
 */
import type { SearchHit } from "./types.js";

export { createBingRssSearch, parseBingRss } from "./bing-rss.js";
export { DEFAULT_SEARCH_LIMIT } from "./types.js";
export type { SearchHit, SearchOutcome, SearchPort } from "./types.js";

const SNIPPET_LIMIT = 200;

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

/**
 * 把搜索结果拼成一段素材文本，交给 research 阶段。
 * 明确写「未经核实」：模型容易把搜索结果摘要当成事实，形态上先挡住。
 */
export function formatHitsForMaterials(topic: string, hits: readonly SearchHit[]): string {
  const lines = [
    `[外部搜索] 话题：${topic}`,
    "以下结果来自 Bing RSS，只有标题、链接和摘要，未经核实。",
    "引用时保留链接；摘要只能当线索，不能当已证实的事实；拿不到原文就按未核实处理。",
  ];
  for (const hit of hits) {
    lines.push(`${hit.position}. ${hit.title}`);
    lines.push(`   链接：${hit.url}`);
    if (hit.description !== "") {
      lines.push(`   摘要：${truncate(hit.description, SNIPPET_LIMIT)}`);
    }
  }
  return lines.join("\n");
}
