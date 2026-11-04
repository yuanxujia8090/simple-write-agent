/**
 * 搜索端口：编排层只依赖这里，不关心用的是哪家引擎。
 * 失败用判别联合回传，不抛异常——搜索是兜底能力，断网不该让创作起不来。
 * 字段沿用 Hermes Agent 的结果形状（title/url/description/position），便于以后换 provider。
 */
export type SearchHit = {
  title: string;
  url: string;
  description: string;
  /** 结果序号，从 1 开始；给模型看顺序，也方便日志核对。 */
  position: number;
};

export type SearchOutcome =
  | { ok: true; hits: SearchHit[] }
  | { ok: false; error: string };

export interface SearchPort {
  /** 引擎名，用于日志与启动检查展示。 */
  readonly name: string;
  search(query: string, limit?: number): Promise<SearchOutcome>;
}

/** 默认最多取几条：兜底搜索，不是调研工具，条数多了只会灌满 prompt。 */
export const DEFAULT_SEARCH_LIMIT = 5;
