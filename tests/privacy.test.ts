import { describe, expect, it, vi } from "vitest";
import { newToolContext, runPlan, type AgentDeps } from "@/lib/agent";
import { chooseBridge } from "@/lib/bridge";
import { limits, QLOO_BASE, TAVILY_BASE } from "@/lib/config";
import type { Family } from "@/lib/family";
import { keyedHasher } from "@/lib/hash";
import type { ChatRequest } from "@/lib/llm";
import { QlooClient } from "@/lib/qloo";
import { SpendGuard } from "@/lib/spend";
import { MemoryStore } from "@/lib/store";
import { TavilyClient } from "@/lib/tavily";
import { runToolCalls } from "@/lib/tools";
import { FakeQloo, FakeTavily, ScriptedLLM, call } from "./helpers";

// What a visitor types (favorites, city) must not end up in stored keys or values.
const TYPED = ["Abuela Rosa's tamales", "Monterrey"];
const keyFor = keyedHasher("test-secret");

// Lowercased on both sides: caches normalize case, and a lowercased copy of what someone typed is still theirs.
function storedText(store: MemoryStore) {
  return JSON.stringify(store.entries()).toLowerCase();
}
const notStored = (text: string, typed: string) => expect(text).not.toContain(typed.toLowerCase());

describe("stored data", () => {
  it("Qloo: keys are keyed hashes and only parsed catalogue data is kept", async () => {
    const store = new MemoryStore();
    const fetchImpl = vi.fn(async () =>
      // A raw response that echoes the query, as some APIs do: it must not be stored.
      Response.json({ query: { text: TYPED.join(" ") }, results: [{ entity_id: "Q-1", name: "Some Artist", extra: TYPED[0] }] }),
    );
    const qloo = new QlooClient("k", store, 100, keyFor, fetchImpl as unknown as typeof fetch);
    const first = await qloo.search(`${TYPED[0]} ${TYPED[1]}`, "artist");
    const again = await qloo.search(`${TYPED[0]} ${TYPED[1]}`, "artist");
    expect(again).toEqual(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // second call served from the cache
    const text = storedText(store);
    for (const t of TYPED) notStored(text, t);
    expect(text).toContain("some artist");
  });

  it("Tavily: the query is not stored", async () => {
    const store = new MemoryStore();
    const fetchImpl = vi.fn(async () => Response.json({ results: [{ title: "Film night", url: "https://example.org", content: "Saturday" }] }));
    const tavily = new TavilyClient("k", store, 30, keyFor, fetchImpl as unknown as typeof fetch);
    await tavily.search(`bolero concert near ${TYPED[1]}`);
    await tavily.search(`Bolero concert near  ${TYPED[1]}`); // same query, normalized
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    notStored(storedText(store), TYPED[1]!);
  });

  it("the hash depends on the secret", () => {
    expect(keyedHasher("a")("x")).not.toBe(keyedHasher("b")("x"));
  });
});

// The page says, field by field, what is sent where ("What is sent, and where" in app/page.tsx). These tests hold
// the code to those sentences. A model writes the searches that go to Qloo and to the web, so the promise rests on
// what that model is given to read: it cannot pass on what it never saw.
describe("what is sent where", () => {
  // Invented, and each field different from every other, so it can be looked for by itself.
  const family: Family = {
    grandparent: { birthYear: 1931, relation: "grandfather", language: "Zapotec", city: "Oaxaca", favorites: ["Singer Uno", "making mole"] },
    visitor: { favorites: ["Band Dos"] },
    history: [{ landed: [{ title: "Earlier Singer", kind: "artist" }], rest: [{ title: "Earlier Film", kind: "film" }], note: "he hummed along NOTEWORD" }],
  };
  const read = (r: ChatRequest) => JSON.stringify(r.messages);

  async function requestsOfOnePlan() {
    const lim = limits({});
    const guard = new SpendGuard(new MemoryStore(), lim);
    const llm = new ScriptedLLM(
      [
        { content: '{"more": ["music"], "avoid": []}' }, // Nano reads the visit
        { toolCalls: [call("qloo_search", { query: "Singer Uno", type: "artist", for: "grandparent" }), call("qloo_search", { query: "Band Dos", type: "artist", for: "visitor" })] },
        { content: "done" },
        { content: "not a plan" }, // Ultra, first draft
        { content: "not a plan" }, // Ultra, sent back
      ],
      guard,
    );
    const qloo = new FakeQloo();
    qloo.search = async (query) => [{ id: `Q:${query}`, name: query, kind: "artist", tags: [] }];
    await runPlan(family, { llm, guard, limits: lim, qloo, tavily: new FakeTavily() }, () => {});
    return llm.requests;
  }

  it("the model that writes the searches reads the favorites, the years of their youth and the city, and nothing else typed", async () => {
    const searcher = (await requestsOfOnePlan()).filter((r) => r.model === "super");
    expect(searcher.length).toBeGreaterThan(0);
    for (const request of searcher) {
      expect(request.tools?.length).toBeGreaterThan(0); // it is the one with the tools
      const text = read(request);
      for (const given of ["Singer Uno", "making mole", "Band Dos", "1941-1961", "Oaxaca", "Earlier Singer", "Earlier Film"]) expect(text, given).toContain(given);
      for (const kept of ["Zapotec", "grandfather", "grandmother", "NOTEWORD", "hummed", "1931"]) expect(text, kept).not.toContain(kept);
    }
  });

  it("Nemotron reads the rest: Nano the note, Ultra everything the browser sent", async () => {
    const requests = await requestsOfOnePlan();
    const nano = requests.filter((r) => r.model === "nano");
    expect(nano).toHaveLength(1);
    expect(read(nano[0]!)).toContain("he hummed along NOTEWORD");
    expect(nano[0]!.tools).toBeUndefined();
    const ultra = requests.filter((r) => r.model === "ultra");
    expect(ultra.length).toBeGreaterThan(0);
    for (const request of ultra) {
      expect(request.tools).toBeUndefined(); // no tool, so nothing it reads goes further
      for (const given of ["Singer Uno", "Band Dos", "1931", "Zapotec", "grandfather", "Oaxaca", "he hummed along NOTEWORD"]) expect(read(request), given).toContain(given);
    }
  });

  // What the code itself puts into a request to Qloo or Tavily, whatever the model asked for.
  function wired(city: string | undefined) {
    const qlooCalls: { path: string; params: Record<string, string> }[] = [];
    const webBodies: Record<string, unknown>[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.origin === TAVILY_BASE) {
        webBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return Response.json({ results: [{ title: "Bolero night", url: "https://example.org/bolero", content: "Music." }] });
      }
      expect(url.origin).toBe(QLOO_BASE);
      expect(init?.body).toBeUndefined();
      const params = Object.fromEntries(url.searchParams);
      qlooCalls.push({ path: url.pathname, params });
      if (url.pathname === "/search") return Response.json({ results: [{ entity_id: `Q:${params.query}`, name: params.query, types: [params.types] }] });
      if (url.pathname === "/v2/tags") return Response.json({ results: { tags: [{ id: "urn:tag:genre:place:example_house", name: "Example house", type: "urn:tag:genre:place", popularity: 0.9, parents: [{ type: "urn:entity:place" }] }] } });
      if (url.pathname !== "/v2/insights") return Response.json({ results: { tags: [] } });
      const ids = params["filter.results.entities"]?.split(",") ?? [1, 2].map((n) => `${params["filter.type"]}-for-${params["signal.interests.entities"]}-${n}`);
      return Response.json({ results: { entities: ids.map((id, i) => ({ entity_id: id, name: `Found ${id}`, subtype: params["filter.type"], query: { affinity: 0.9 - i * 0.1 } })) } });
    }) as typeof fetch;
    const store = new MemoryStore();
    const lim = limits({});
    const keyFor = keyedHasher("test-secret");
    const deps: AgentDeps = { llm: new ScriptedLLM([]), guard: new SpendGuard(store, lim), limits: lim, qloo: new QlooClient("k", store, 100, keyFor, fetchImpl), tavily: new TavilyClient("k", store, 30, keyFor, fetchImpl) };
    const ctx = newToolContext({ ...family, grandparent: { ...family.grandparent, city } }, deps);
    return { ctx, qlooCalls, webBodies };
  }

  const everyTool = [
    call("qloo_search", { query: "Singer Uno", type: "artist", for: "grandparent" }),
    call("qloo_search", { query: "Band Dos", type: "artist", for: "visitor" }),
    call("qloo_insights", { for: "grandparent", type: "movie", entity_ids: ["Q:Singer Uno"], release_year_min: 1941, release_year_max: 1961, age: "55_and_older" }),
    call("qloo_insights", { for: "visitor", type: "movie", entity_ids: ["Q:Band Dos"] }),
    call("qloo_tags", { query: "mole" }),
    call("qloo_insights", { for: "both", type: "place", entity_ids: ["Q:Singer Uno"] }),
    call("qloo_compare", { grandparent_ids: ["Q:Singer Uno"], visitor_ids: ["Q:Band Dos"] }),
    call("web_search", { query: "bolero night Oaxaca" }),
  ];

  it("Qloo gets search words, ids, years, an age band, a word for a food and, for places only, the city", async () => {
    const { ctx, qlooCalls } = wired("Oaxaca");
    for await (const outcome of runToolCalls(everyTool, ctx)) expect(outcome.ok, outcome.content).toBe(true);
    expect(await chooseBridge(ctx, null)).not.toBeNull(); // the bridge check: three more calls, ids only or nothing of theirs

    const sent = (path: string) => qlooCalls.filter((c) => c.path === path).map((c) => c.params);
    expect(sent("/search")).toEqual([
      { query: "Singer Uno", types: "urn:entity:artist", take: "5" },
      { query: "Band Dos", types: "urn:entity:artist", take: "5" },
    ]);
    expect(sent("/v2/insights")).toEqual([
      { "filter.type": "urn:entity:movie", "signal.interests.entities": "Q:Singer Uno", "filter.release_year.min": "1941", "filter.release_year.max": "1961", "signal.demographics.age": "55_and_older", take: "6" },
      { "filter.type": "urn:entity:movie", "signal.interests.entities": "Q:Band Dos", take: "6" },
      { "filter.type": "urn:entity:place", "signal.interests.entities": "Q:Singer Uno,Q:Band Dos", "filter.location.query": "Oaxaca", "filter.tags": "urn:tag:genre:place:example_house", take: "6" },
      { "filter.type": "urn:entity:movie", "filter.popularity.min": "0.9", take: "50" }, // what Qloo suggests to anyone: nothing of theirs at all
      { "filter.type": "urn:entity:movie", "signal.interests.entities": "Q:Band Dos", "filter.results.entities": "urn:entity:movie-for-Q:Singer Uno-1,urn:entity:movie-for-Q:Singer Uno-2", take: "2" },
    ]);
    expect(sent("/v2/analysis/compare")).toEqual([{ "a.signal.interests.entities": "Q:Singer Uno", "b.signal.interests.entities": "Q:Band Dos" }]);
    expect(sent("/v2/tags")).toEqual([{ "filter.query": "mole", take: "8" }]);
    expect(qlooCalls).toHaveLength(9); // one fewer since bus 015: the grandparent's taste is no longer asked about the visitor's films
    // Nothing else the family typed is within the tools' reach at all: only the city.
    const reach = JSON.stringify({ city: ctx.city, ids: ctx.ids });
    for (const kept of ["Zapotec", "grandfather", "NOTEWORD", "1931"]) expect(reach).not.toContain(kept);
  });

  it("Tavily gets the search the model wrote and nothing else", async () => {
    const { ctx, webBodies } = wired("Oaxaca");
    for await (const outcome of runToolCalls(everyTool.slice(-1), ctx)) expect(outcome.ok).toBe(true);
    expect(webBodies).toEqual([{ query: "bolero night Oaxaca", search_depth: "basic", max_results: 3, topic: "general" }]);
  });

  it("Qloo gets no place search when no city was given, even if the model asks", async () => {
    const { ctx, qlooCalls } = wired(undefined);
    const outcomes = [];
    for await (const outcome of runToolCalls([everyTool[0]!, everyTool[5]!], ctx)) outcomes.push(outcome);
    expect(outcomes[1]).toEqual({ ok: false, content: "error: no city was given, so there are no places to look for; continue without them", summary: "No city given, so no places nearby" });
    expect(qlooCalls.map((c) => c.path)).toEqual(["/search"]);
  });

  it("Tavily gets nothing when no city was given, even if the model asks", async () => {
    const { ctx, webBodies } = wired(undefined);
    const outcomes = [];
    for await (const outcome of runToolCalls(everyTool.slice(-1), ctx)) outcomes.push(outcome);
    expect(outcomes).toEqual([{ ok: false, content: "error: no city was given, so there is no local search; continue without it", summary: "No city given, so no local events" }]);
    expect(webBodies).toEqual([]);
  });
});
