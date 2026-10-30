import { TAVILY_BASE } from "./config";
import type { Hasher } from "./hash";
import type { Store } from "./store";

export interface WebResult {
  title: string;
  url: string;
  snippet: string;
}

export interface TavilyApi {
  search(query: string): Promise<WebResult[]>;
}

export class TavilyError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "TavilyError";
  }
}

// Free plan: 1,000 credits a month. Basic search only (1 credit), cached for a day, capped per day. The cache key is
// a keyed hash of the query (the query is built from a family's favorites and city), so the query text is not stored.
export class TavilyClient implements TavilyApi {
  constructor(
    private apiKey: string,
    private store: Store,
    private creditsPerDay: number,
    private keyFor: Hasher,
    private fetchImpl: typeof fetch = fetch,
    private now: () => Date = () => new Date(),
  ) {}

  async search(query: string): Promise<WebResult[]> {
    const normalized = query.trim().toLowerCase().replace(/\s+/g, " ");
    const cacheKey = `tavily:${this.keyFor(normalized)}`;
    const cached = await this.store.getJSON<WebResult[]>(cacheKey);
    if (cached) return cached;

    const dayKey = `tavily:credits:${this.now().toISOString().slice(0, 10)}`;
    const used = await this.store.incrByFloat(dayKey, 1, 2 * 86400);
    if (used > this.creditsPerDay) throw new TavilyError(429, "Tavily daily credit budget reached");

    const response = await this.fetchImpl(`${TAVILY_BASE}/search`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, search_depth: "basic", max_results: 3, topic: "general" }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      const text = (await response.text()).replaceAll(this.apiKey, "[redacted]").slice(0, 300);
      throw new TavilyError(response.status, `Tavily ${response.status}: ${text}`);
    }
    const data = (await response.json()) as { results?: { title?: string; url?: string; content?: string }[] };
    const results = (data.results ?? [])
      .filter((r) => r.title && r.url && /^https?:\/\//i.test(r.url)) // the page links to these: plain web links only
      .map((r) => ({ title: r.title!, url: r.url!, snippet: (r.content ?? "").replace(/\s+/g, " ").slice(0, 280) }));
    await this.store.setJSON(cacheKey, results, 86400);
    return results;
  }
}
