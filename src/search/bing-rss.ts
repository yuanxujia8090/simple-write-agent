/**
 * Bing RSS 搜索：零配置兜底。
 *
 * 为什么是 RSS 而不是抓 HTML：
 * 2026-11-04 实测（同一 UA、同一网络）——Google 对 curl 返回 JS 壳（无结果节点），
 * DuckDuckGo HTML/lite 返回 202 + 反爬页，Mojeek 直接给验证码；Bing 的 `?format=rss`
 * 返回 10 条结构化 `<item>`，无跳转链接、无需解析页面结构。
 *
 * 两个实测约束写进代码：
 * 1. 不能带 `mkt` / `cc` / `setlang`——带上之后 RSS 返回 0 条（878 字节空壳）。
 * 2. 结果语言由出口 IP 猜，英文查询可能拿到非中文结果；这是引擎行为，不在这里纠正。
 */
import { DEFAULT_SEARCH_LIMIT, type SearchHit, type SearchOutcome, type SearchPort } from "./types.js";

const ENDPOINT = "https://www.bing.com/search";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const DEFAULT_TIMEOUT_MS = 8_000;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#")) {
      const code = body.startsWith("#x") || body.startsWith("#X")
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

function stripTags(text: string): string {
  return text.replace(/<[^>]*>/g, "");
}

function readTag(item: string, tag: string): string {
  const matched = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i").exec(item);
  if (!matched?.[1]) {
    return "";
  }
  const raw = matched[1].trim().replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, "$1");
  return stripTags(decodeEntities(raw)).replace(/\s+/g, " ").trim();
}

/**
 * 解析 Bing RSS 的 XML。只认 `<item>` 里的 title / link / description，
 * 其它字段（pubDate 等）不要——兜底搜索用不上。
 */
export function parseBingRss(xml: string, limit: number = DEFAULT_SEARCH_LIMIT): SearchHit[] {
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
  const hits: SearchHit[] = [];
  for (const item of items) {
    const title = readTag(item, "title");
    const url = readTag(item, "link");
    if (title === "" || url === "") {
      continue;
    }
    hits.push({
      title,
      url,
      description: readTag(item, "description"),
      position: hits.length + 1,
    });
    if (hits.length >= limit) {
      break;
    }
  }
  return hits;
}

export type BingRssOptions = {
  /** 测试注入；默认用全局 fetch。 */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  endpoint?: string;
};

export function createBingRssSearch(options: BingRssOptions = {}): SearchPort {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const endpoint = options.endpoint ?? ENDPOINT;

  return {
    name: "bing-rss",
    async search(query: string, limit: number = DEFAULT_SEARCH_LIMIT): Promise<SearchOutcome> {
      const url = `${endpoint}?q=${encodeURIComponent(query)}&format=rss`;
      let response: Response;
      try {
        response = await fetchImpl(url, {
          headers: {
            "user-agent": USER_AGENT,
            accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
          },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return { ok: false, error: `搜索请求失败：${detail}` };
      }

      if (!response.ok) {
        return { ok: false, error: `Bing 返回 HTTP ${response.status}` };
      }

      let xml: string;
      try {
        xml = await response.text();
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return { ok: false, error: `读取搜索结果失败：${detail}` };
      }

      const hits = parseBingRss(xml, limit);
      if (hits.length === 0) {
        return { ok: false, error: "Bing 没有返回可用结果（可能被限流或改版）" };
      }
      return { ok: true, hits };
    },
  };
}
