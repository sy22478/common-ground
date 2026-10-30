import { describe, expect, it } from "vitest";
import { QLOO_ALLOWANCE_MESSAGE, runPlan, type AgentEvent } from "@/lib/agent";
import { limits } from "@/lib/config";
import { SAMPLE_FAMILY } from "@/lib/family";
import { keyedHasher } from "@/lib/hash";
import { QlooAllowanceUsed, QlooClient } from "@/lib/qloo";
import { forcedErrors, makeDeps } from "@/lib/server";
import { SpendGuard } from "@/lib/spend";
import { MemoryStore } from "@/lib/store";
import { FakeQloo, FakeTavily, ScriptedLLM, call } from "./helpers";

// The failure paths of the scripted run (STACK_AND_GATE.md): a forced Qloo error and a forced Tavily error. Each must
// end in plain words, never a blank screen, and a dead Qloo must not keep spending on the model.
const env = { NEBIUS_API_KEY: "n", QLOO_API_KEY: "q", TAVILY_API_KEY: "t", HASH_SECRET: "s" };
const searches = ["Pedro Infante", "Javier Solis", "Bad Bunny"].map((query) => call("qloo_search", { query, type: "artist", for: "grandparent" }));

async function run(over: { qloo?: "broken"; tavily?: "broken" }, replies: ConstructorParameters<typeof ScriptedLLM>[0]) {
  const store = new MemoryStore();
  const lim = limits({});
  const guard = new SpendGuard(store, lim);
  const forced = makeDeps(store, { ...env, FORCE_ERRORS: Object.keys(over).join(",") }, lim)!;
  const llm = new ScriptedLLM(replies, guard);
  const events: AgentEvent[] = [];
  const plan = await runPlan(
    SAMPLE_FAMILY,
    { llm, guard, limits: lim, qloo: over.qloo ? forced.qloo : new FakeQloo(), tavily: over.tavily ? forced.tavily : new FakeTavily() },
    (e) => events.push(e),
  );
  return { plan, events, llm };
}

describe("fault injection", () => {
  it("is read from FORCE_ERRORS, and production ignores it", () => {
    expect([...forcedErrors({ FORCE_ERRORS: "qloo, tavily" })]).toEqual(["qloo", "tavily"]);
    expect([...forcedErrors({ FORCE_ERRORS: "qloo", VERCEL_ENV: "preview" })]).toEqual(["qloo"]);
    expect([...forcedErrors({ FORCE_ERRORS: "qloo,tavily", VERCEL_ENV: "production" })]).toEqual([]);
    expect([...forcedErrors({})]).toEqual([]);
  });

  it("refuses every Qloo call as the site's allowance does under FORCE_ERRORS=allowance", async () => {
    const deps = makeDeps(new MemoryStore(), { ...env, FORCE_ERRORS: "allowance" })!;
    await expect(deps.qloo!.search("Pedro Infante")).rejects.toBeInstanceOf(QlooAllowanceUsed);
  });

  it("leaves the real clients in place in production, whatever FORCE_ERRORS says", () => {
    const deps = makeDeps(new MemoryStore(), { ...env, FORCE_ERRORS: "qloo,tavily,allowance", VERCEL_ENV: "production" })!;
    expect(deps.qloo?.constructor.name).toBe("QlooClient");
    expect(deps.tavily?.constructor.name).toBe("TavilyClient");
  });
});

describe("when Qloo is not answering", () => {
  it("stops after the first round of failures, says so plainly, and makes no further model call", async () => {
    // A second reply is scripted to prove it is never asked for.
    const { plan, events, llm } = await run({ qloo: "broken" }, [{ toolCalls: searches }, { toolCalls: searches }]);
    expect(plan).toBeNull();
    expect(llm.requests).toHaveLength(1);
    expect(events.filter((e) => e.type === "tool")).toEqual(searches.map(() => ({ type: "tool", name: "qloo_search", ok: false, summary: "qloo_search failed", evidence: undefined, names: undefined, by: "super" })));
    expect(events).toContainEqual({
      type: "error",
      code: "upstream",
      message: "Qloo, where the taste data comes from, is not answering right now, so no plan can be made. Please try again in a few minutes.",
    });
    expect(events.at(-1)?.type).toBe("done");
  });

  it("still says the favorites found nothing when Qloo answers with no results", async () => {
    const { events } = await run({}, [{ toolCalls: [call("qloo_search", { query: "zzzz", type: "artist", for: "grandparent" })] }, { content: "done" }]);
    expect(events).toContainEqual({ type: "error", code: "upstream", message: "Qloo returned nothing usable for these favorites. Try different ones." });
  });
});

describe("when this site's own daily Qloo allowance is used up", () => {
  // Bus 014: the real client refused the calls itself, and the page then said Qloo was not answering. Qloo was fine.
  it("says the site's allowance is used, not that Qloo failed, and never calls Qloo", async () => {
    const store = new MemoryStore();
    const lim = limits({ QLOO_CALLS_PER_DAY: "4" });
    await store.incrByFloat(`qloo:calls:${new Date().toISOString().slice(0, 10)}`, 4);
    const guard = new SpendGuard(store, lim);
    const fetched: string[] = [];
    const fetchImpl = (async (url: string) => {
      fetched.push(url);
      return new Response("{}", { status: 500 });
    }) as unknown as typeof fetch;
    const qloo = new QlooClient("q", store, lim.qlooPerDay, keyedHasher("s"), fetchImpl);
    const llm = new ScriptedLLM([{ toolCalls: searches }, { toolCalls: searches }], guard);
    const events: AgentEvent[] = [];
    const plan = await runPlan(SAMPLE_FAMILY, { llm, guard, limits: lim, qloo, tavily: new FakeTavily() }, (e) => events.push(e));
    expect(plan).toBeNull();
    expect(fetched).toEqual([]);
    expect(llm.requests).toHaveLength(1);
    expect(events).toContainEqual({ type: "error", code: "allowance", message: QLOO_ALLOWANCE_MESSAGE });
    expect(QLOO_ALLOWANCE_MESSAGE).not.toMatch(/not answering/);
    expect(events.at(-1)?.type).toBe("done");
  });
});

describe("when web search is not answering", () => {
  it("goes on to a plan without local events and says why in plain words", async () => {
    const gather = [
      { toolCalls: [call("qloo_search", { query: "Pedro Infante", type: "artist", for: "grandparent" }), call("qloo_search", { query: "Bad Bunny", type: "artist", for: "visitor" })] }, // E2, E3
      { toolCalls: [call("qloo_insights", { for: "both", type: "artist", entity_ids: ["Q-PI", "Q-BB"] }), call("web_search", { query: "bolero night san antonio" })] }, // E4, then the failure
      { content: "done" },
    ];
    const planJson = JSON.stringify({
      bridge: { title: "Natalia Lafourcade", kind: "artist", why: "Both love her.", evidence: ["E4"] },
      moments: [
        { title: "Pedro Infante", kind: "artist", what_to_do: "Listen together.", evidence: ["E2"] },
        { title: "Bad Bunny", kind: "artist", what_to_do: "Share one song.", evidence: ["E3"] },
        { title: "Tamales", kind: "dish", what_to_do: "Cook them together.", evidence: ["E1"] },
      ],
      questions: [{ text_en: "What songs filled your house growing up?" }, { text_en: "Who taught you to cook?" }, { text_en: "Where did you go dancing?" }],
    });
    const { plan, events } = await run({ tavily: "broken" }, [...gather, { content: planJson }, { content: JSON.stringify(["¿Uno?", "¿Dos?", "¿Tres?"]) }]);
    expect(plan?.bridge.title).toBe("Natalia Lafourcade");
    expect(plan?.moments.some((m) => m.kind === "event")).toBe(false);
    expect(events).toContainEqual({ type: "tool", name: "web_search", ok: false, summary: "Web search is not answering, so this plan has no local events", evidence: undefined, names: undefined, by: "super" });
  });
});

describe("the event stream", () => {
  it("carries every name an evidence item can ground, so a card can be checked outside the server", async () => {
    const { events } = await run({}, [{ toolCalls: [call("qloo_search", { query: "Pedro Infante", type: "artist", for: "grandparent" }), call("web_search", { query: "bolero night san antonio" })] }, { content: "done" }]);
    const tools = events.filter((e) => e.type === "tool");
    expect(tools[0]).toMatchObject({ evidence: "E2", names: ["Pedro Infante"] });
    expect(tools[1]).toMatchObject({ evidence: "E3", names: ["CineFestival at Guadalupe Cultural Arts Center"] });
  });
});
