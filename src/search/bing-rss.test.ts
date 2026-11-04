/**
 * Bing RSS 解析与请求的离线测试：不发真实网络请求，用固定 XML 与注入的 fetch。
 * 在线验证只在手动命令里做（见 docs/design/2026-11-04-search-provider.md §6）。
 */
import { describe, expect, it } from "vitest";

import { createBingRssSearch, parseBingRss } from "./bing-rss.js";

const RSS = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"><channel>
  <title>agent writing - 搜索</title>
  <item>
    <title>本地写作 Agent 的第一个闭环</title>
    <link>https://example.com/a</link>
    <description>讲素材怎么进命令行 &amp; 怎么导出。</description>
  </item>
  <item>
    <title><![CDATA[第二篇 <b>带标签</b> 的标题]]></title>
    <link>https://example.com/b?x=1&amp;y=2</link>
    <description><![CDATA[摘要里有 <b>HTML</b> 和 &#39;引号&#39;。]]></description>
  </item>
  <item>
    <title>缺链接的结果</title>
    <description>应该被跳过</description>
  </item>
</channel></rss>`;

describe("parseBingRss", () => {
  it("解析标题、链接、摘要与序号", () => {
    const hits = parseBingRss(RSS);
    expect(hits).toHaveLength(2);
    expect(hits[0]).toEqual({
      title: "本地写作 Agent 的第一个闭环",
      url: "https://example.com/a",
      description: "讲素材怎么进命令行 & 怎么导出。",
      position: 1,
    });
  });

  it("剥掉 CDATA、HTML 标签并解码实体", () => {
    const hits = parseBingRss(RSS);
    expect(hits[1]?.title).toBe("第二篇 带标签 的标题");
    expect(hits[1]?.url).toBe("https://example.com/b?x=1&y=2");
    expect(hits[1]?.description).toBe("摘要里有 HTML 和 '引号'。");
  });

  it("缺 title 或 link 的条目跳过，不产生空结果", () => {
    const hits = parseBingRss(RSS);
    expect(hits.map((hit) => hit.title)).not.toContain("缺链接的结果");
  });

  it("按 limit 截断，序号仍从 1 连续", () => {
    expect(parseBingRss(RSS, 1)).toHaveLength(1);
  });

  it("不是 RSS 时返回空数组，不抛异常", () => {
    expect(parseBingRss("<html><body>验证码</body></html>")).toEqual([]);
    expect(parseBingRss("")).toEqual([]);
  });
});

describe("createBingRssSearch", () => {
  it("请求地址带 format=rss，且不带 mkt/cc/setlang", async () => {
    const urls: string[] = [];
    const search = createBingRssSearch({
      fetchImpl: async (input) => {
        urls.push(String(input));
        return new Response(RSS, { status: 200 });
      },
    });
    const outcome = await search.search("本地写作 Agent");
    expect(outcome.ok).toBe(true);
    expect(urls[0]).toContain("format=rss");
    expect(urls[0]).toContain(encodeURIComponent("本地写作 Agent"));
    expect(urls[0]).not.toMatch(/[?&](mkt|cc|setlang)=/);
  });

  it("HTTP 非 2xx 时返回可读失败，不抛异常", async () => {
    const search = createBingRssSearch({
      fetchImpl: async () => new Response("nope", { status: 503 }),
    });
    const outcome = await search.search("x");
    expect(outcome).toEqual({ ok: false, error: "Bing 返回 HTTP 503" });
  });

  it("0 条结果按失败处理，避免把空块塞进素材", async () => {
    const search = createBingRssSearch({
      fetchImpl: async () => new Response("<rss><channel></channel></rss>", { status: 200 }),
    });
    const outcome = await search.search("x");
    expect(outcome.ok).toBe(false);
  });

  it("网络异常时返回可读失败", async () => {
    const search = createBingRssSearch({
      fetchImpl: async () => {
        throw new Error("getaddrinfo ENOTFOUND www.bing.com");
      },
    });
    const outcome = await search.search("x");
    expect(outcome).toEqual({ ok: false, error: "搜索请求失败：getaddrinfo ENOTFOUND www.bing.com" });
  });

  it("命中条数受 limit 限制", async () => {
    const search = createBingRssSearch({
      fetchImpl: async () => new Response(RSS, { status: 200 }),
    });
    const outcome = await search.search("x", 1);
    expect(outcome.ok && outcome.hits).toHaveLength(1);
  });
});
