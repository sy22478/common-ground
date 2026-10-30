import type { ChatRequest, ChatResult, LLM, ToolCall } from "@/lib/llm";
import { costOf, estimateCost } from "@/lib/llm";
import type { EntityKind, InsightsQuery, QlooApi, QlooEntity, QlooTag, SharedTrait } from "@/lib/qloo";
import type { SpendGuard } from "@/lib/spend";
import type { TavilyApi, WebResult } from "@/lib/tavily";

// A model that replays scripted replies in order and records what it was asked. It goes through the real spend
// guard, so caps are exercised exactly as in production.
export class ScriptedLLM implements LLM {
  readonly requests: ChatRequest[] = [];
  constructor(
    private replies: (Partial<ChatResult> & { content?: string; toolCalls?: ToolCall[] })[],
    private guard?: SpendGuard,
  ) {}

  async chat(request: ChatRequest): Promise<ChatResult> {
    const reservation = this.guard ? await this.guard.reserve(estimateCost(request)) : null;
    this.requests.push(structuredClone(request));
    const next = this.replies.shift();
    if (!next) throw new Error(`ScriptedLLM ran out of replies at request ${this.requests.length} (${request.model})`);
    const usage = next.usage ?? { prompt_tokens: 1000, completion_tokens: 200 };
    const costUsd = costOf(request.model, usage);
    if (this.guard && reservation) await this.guard.settle(reservation, costUsd);
    return { model: request.model, content: next.content ?? "", toolCalls: next.toolCalls ?? [], finishReason: next.toolCalls?.length ? "tool_calls" : "stop", usage, costUsd, ms: 5 };
  }
}

let callId = 0;
export const call = (name: string, args: unknown): ToolCall => ({
  id: `call_${++callId}`,
  type: "function",
  function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) },
});

// SYNTHETIC Qloo data: invented, in the form the client hands to the agent. It stays synthetic on purpose: Qloo's
// guide says "Do not store Qloo response data in a public repository". The real response shapes are pinned, with
// invented values, in tests/qloo.test.ts.
const E = (id: string, name: string, kind: string, year?: number): QlooEntity => ({ id, name, kind, year, tags: [] });
export const SYNTHETIC = {
  search: {
    "pedro infante": [E("Q-PI", "Pedro Infante", "artist")],
    "roman holiday": [E("Q-RH", "Roman Holiday", "movie", 1953)],
    "javier solis": [E("Q-JS", "Javier Solís", "artist")],
    "bad bunny": [E("Q-BB", "Bad Bunny", "artist")],
    "spirited away": [E("Q-SA", "Spirited Away", "movie", 2001)],
  } as Record<string, QlooEntity[]>,
  insightsGrandparentMovies: [E("Q-M1", "Nosotros los pobres", "movie", 1948), E("Q-M2", "Sabrina", "movie", 1954), E("Q-M3", "A toda máquina", "movie", 1951)],
  insightsVisitor: [E("Q-V1", "Kiki's Delivery Service", "movie", 1989), E("Q-V2", "Natalia Lafourcade", "artist")],
  insightsBoth: [E("Q-B1", "Natalia Lafourcade", "artist"), E("Q-B2", "Coco", "movie", 2017)],
  // What /v2/tags gives for a food word: Qloo's own tags, most of them for places. Invented ids and names.
  tags: [
    { id: "urn:tag:specialty_dish:place:example_tamales", name: "Example Tamales", type: "urn:tag:specialty_dish:place", places: true },
    { id: "urn:tag:genre:music:example", name: "Example Genre", type: "urn:tag:genre:music", places: false },
    { id: "urn:tag:genre:place:example_tamale_house", name: "Tamale house", type: "urn:tag:genre:place", places: true },
  ] as QlooTag[],
  places: [
    { id: "Q-P1", name: "Example Tamale House", kind: "place", note: "12 Example St Example City, TX 00000", tags: [] },
    { id: "Q-P2", name: "Second Example Kitchen", kind: "place", note: "34 Sample Ave Example City, TX 00000", tags: [] },
  ] as QlooEntity[],
  // What /v2/analysis/compare gives once read: shared traits, strongest first. Invented ids, names and scores.
  compare: [
    { id: "urn:tag:genre:music:example_ballad", name: "Example Ballad", kind: "genre:music", score: 0.73 },
    { id: "urn:tag:theme:qloo:example_theme", name: "Example Theme", kind: "theme", score: 0.72 },
    { id: "urn:tag:instrument:music:example_strings", name: "Example Strings", kind: "instrument:music", score: 0.6 },
  ] as SharedTrait[],
};

export class FakeQloo implements QlooApi {
  readonly calls: string[] = [];
  async search(query: string, kind?: EntityKind): Promise<QlooEntity[]> {
    this.calls.push(`search:${query}:${kind}`);
    const key = query.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    return SYNTHETIC.search[key] ?? [];
  }
  async insights(q: InsightsQuery): Promise<QlooEntity[]> {
    this.calls.push(`insights:${q.kind}:${q.signalIds.join("+")}${q.tagIds?.length ? `:tags=${q.tagIds.join("+")}` : ""}${q.location ? `:near=${q.location}` : ""}`);
    if (q.kind === "place") return SYNTHETIC.places;
    if (q.signalIds.some((id) => ["Q-PI", "Q-RH", "Q-JS"].includes(id)) && q.signalIds.some((id) => ["Q-BB", "Q-SA"].includes(id))) return SYNTHETIC.insightsBoth;
    if (q.signalIds.some((id) => ["Q-BB", "Q-SA"].includes(id))) return SYNTHETIC.insightsVisitor;
    return SYNTHETIC.insightsGrandparentMovies;
  }
  async compare(a: string[], b: string[]): Promise<SharedTrait[]> {
    this.calls.push(`compare:${a.join("+")}|${b.join("+")}`);
    return SYNTHETIC.compare;
  }
  // Synthetic: each item is liked a little less than the one before it, and the other person's taste likes
  // "Natalia Lafourcade" and "Coco" most. Enough to give the bridge check something to choose between.
  async affinity(signalIds: string[], itemIds: string[]): Promise<QlooEntity[]> {
    this.calls.push(`affinity:${signalIds.join("+")}|${itemIds.join("+")}`);
    const known = [...Object.values(SYNTHETIC.search).flat(), ...SYNTHETIC.insightsGrandparentMovies, ...SYNTHETIC.insightsVisitor, ...SYNTHETIC.insightsBoth];
    const liked: Record<string, number> = { "Q-V2": 0.9, "Q-B1": 0.9, "Q-B2": 0.88 };
    return itemIds.map((id, i) => ({ ...(known.find((e) => e.id === id) ?? { id, name: id, tags: [] }), affinity: liked[id] ?? 0.7 - i * 0.02 }));
  }
  // What Qloo suggests to anyone. Empty unless a test fills it: with no list there is no comparison, and the bridge
  // is chosen as it was before the comparison existed.
  famousList: QlooEntity[] = [];
  async famous(kind: EntityKind): Promise<QlooEntity[]> {
    this.calls.push(`famous:${kind}`);
    return this.famousList;
  }
  async tags(query: string): Promise<QlooTag[]> {
    this.calls.push(`tags:${query}`);
    return /tamal/i.test(query) ? SYNTHETIC.tags : [];
  }
}

export class FakeTavily implements TavilyApi {
  readonly queries: string[] = [];
  async search(query: string): Promise<WebResult[]> {
    this.queries.push(query);
    return [{ title: "CineFestival at Guadalupe Cultural Arts Center", url: "https://example.org/cinefestival", snippet: "A festival of classic Mexican films in San Antonio." }];
  }
}
