import { describe, expect, it } from "vitest";
import { runPlan, type AgentEvent } from "@/lib/agent";
import { chooseBridge } from "@/lib/bridge";
import { limits } from "@/lib/config";
import { Ledger } from "@/lib/evidence";
import { SAMPLE_FAMILY } from "@/lib/family";
import type { InsightsQuery, QlooEntity } from "@/lib/qloo";
import { SpendGuard } from "@/lib/spend";
import { MemoryStore } from "@/lib/store";
import type { ToolContext } from "@/lib/tools";
import { FakeQloo, FakeTavily, ScriptedLLM, call } from "./helpers";

// The bridge is chosen by Qloo's numbers: of what was suggested for the grandparent, the item whose lower affinity is
// highest. Since bus 015 (2026-10-28) nothing suggested for the visitor can be the bridge. All names and numbers here
// are invented.
type Row = [id: string, name: string, affinity: number | undefined];

class CrossQloo extends FakeQloo {
  constructor(private liked: Record<string, number>) {
    super();
  }
  override async affinity(signalIds: string[], itemIds: string[]): Promise<QlooEntity[]> {
    this.calls.push(`affinity:${signalIds.join("+")}|${itemIds.join("+")}`);
    return itemIds.flatMap((id) => (this.liked[id] === undefined ? [] : [{ id, name: id, tags: [], affinity: this.liked[id] }]));
  }
}

function context(qloo: FakeQloo): ToolContext {
  return { qloo, tavily: null, ledger: new Ledger(), limits: limits({}), webSearches: 0, placeTags: [], ids: { grandparent: [], visitor: [] }, qlooAnswers: 0, qlooFailures: 0 };
}

function suggest(ctx: ToolContext, who: "grandparent" | "visitor" | "both", kind: string, rows: Row[]) {
  return ctx.ledger.add({
    source: "qloo",
    tool: "insights",
    label: `${kind} for ${who}`,
    names: rows.map((r) => r[1]),
    entityIds: rows.map((r) => r[0]),
    urls: [],
    detail: null,
    asked: { who, kind, signalIds: who === "visitor" ? ["V1"] : ["G1", "G2"], entities: rows.map(([id, name, affinity]) => ({ id, name, affinity })) },
  });
}

// What the other person's taste makes of each item. The visitor's films A and B would score high with the
// grandparent's taste too, if anyone asked.
const liked = { A: 0.9, B: 0.88, C: 0.6, D: 0.8, E: 0.84 };
function films(qloo = new CrossQloo(liked)) {
  const ctx = context(qloo);
  suggest(ctx, "visitor", "movie", [["A", "Film A", 0.95], ["B", "Film B", 0.93]]); // E1
  suggest(ctx, "grandparent", "movie", [["C", "Film C", 0.92], ["D", "Film D", 0.85], ["E", "Film E", 0.86]]); // E2
  return { ctx, qloo };
}

describe("choosing the bridge", () => {
  it("takes the bridge from what was suggested for the grandparent, even when one of the visitor's scores higher with both", async () => {
    const { ctx, qloo } = films();
    const choice = await chooseBridge(ctx, null);
    // Film A has 0.95 and 0.90, more than anything of the grandparent's, but it was suggested for the visitor.
    expect(choice?.bridge.title).toBe("Film E");
    expect(choice?.candidates.map((c) => c.from)).toEqual(["grandparent", "grandparent", "grandparent"]);
    expect(qloo.calls.filter((c) => c.includes("A+B"))).toEqual([]); // the visitor's films are not even asked about
  });

  it("takes the item neither of them is lukewarm about, not the one a single taste likes most", async () => {
    const { ctx, qloo } = films();
    const choice = await chooseBridge(ctx, null);
    // Film C has the grandparent's highest affinity (0.92), but the visitor's taste gives it 0.60.
    expect(choice?.bridge).toEqual({ id: "E", title: "Film E", kind: "film", note: undefined, from: "grandparent", grandparent: 0.86, visitor: 0.84, evidence: ["E3", "E2"] });
    expect(choice?.candidates.map((c) => [c.title, Math.min(c.grandparent, c.visitor)])).toEqual([
      ["Film E", 0.84],
      ["Film D", 0.8],
      ["Film C", 0.6],
    ]);
    // One question to Qloo: the visitor's signals on the grandparent's films. (And one for what it suggests to
    // anyone, which here is nothing, so there is no comparison with it.)
    expect(qloo.calls).toEqual(["famous:movie", "affinity:V1|C+D+E"]);
    expect(ctx.qlooAnswers).toBe(2);
    expect(choice?.beyondFame).toBeUndefined();
    expect(choice?.fameMissed).toBeUndefined();
  });

  it("records the comparison as evidence the page and the planner can read", async () => {
    const { ctx } = films();
    const choice = await chooseBridge(ctx, null);
    expect(ctx.ledger.get(choice!.checkId)).toMatchObject({
      id: "E3",
      source: "qloo",
      tool: "bridge_check",
      label: "Qloo bridge check: how much the visitor's taste likes what was suggested for the grandparent",
      names: ["Film E", "Film D", "Film C"],
      display: ["Film E (film): grandparent 0.86, visitor 0.84", "Film D (film): grandparent 0.85, visitor 0.80", "Film C (film): grandparent 0.92, visitor 0.60"],
    });
    expect(choice?.summary).toBe("Qloo bridge check: of what Qloo suggested for the grandparent, Film E is closest to both (affinity 0.86 with the grandparent's favorites, 0.84 with the visitor's)");
  });

  it("compares across types, and ignores what was suggested for the visitor or for both at once", async () => {
    const qloo = new CrossQloo({ ...liked, S: 0.95, T: 0.88 });
    const { ctx } = films(qloo);
    suggest(ctx, "visitor", "artist", [["S", "A Singer", 0.99]]); // the grandparent's taste would like it too
    suggest(ctx, "grandparent", "artist", [["T", "A Trio", 0.97]]);
    suggest(ctx, "both", "movie", [["Z", "A Famous Film", 0.99]]);
    const choice = await chooseBridge(ctx, null);
    expect(choice?.bridge).toMatchObject({ title: "A Trio", kind: "artist", grandparent: 0.97, visitor: 0.88 });
    expect(choice?.candidates.map((c) => c.title)).not.toContain("A Famous Film");
    expect(choice?.candidates.map((c) => c.title)).not.toContain("A Singer");
  });

  it("follows the last visit: no kind that went badly, nothing already suggested", async () => {
    const qloo = new CrossQloo({ ...liked, T: 0.4, U: 0.5 });
    const { ctx } = films(qloo);
    suggest(ctx, "grandparent", "artist", [["T", "A Trio", 0.97], ["U", "A Singer", 0.9]]);
    const noFilms = await chooseBridge(ctx, { more: [], avoid: ["film"], noRepeat: ["a singer"] });
    expect(noFilms?.bridge.title).toBe("A Trio"); // films are out, and the singer was suggested before
    expect(qloo.calls.filter((c) => c.includes("C+D+E"))).toEqual([]); // and Qloo is not asked about films at all
  });

  it("leaves the choice to the planner when Qloo's answers do not allow one", async () => {
    const visitorOnly = context(new CrossQloo(liked));
    suggest(visitorOnly, "visitor", "movie", [["A", "Film A", 0.95]]);
    expect(await chooseBridge(visitorOnly, null)).toBeNull();

    const grandparentOnly = context(new CrossQloo(liked)); // no signals for the visitor to score with
    suggest(grandparentOnly, "grandparent", "movie", [["E", "Film E", 0.86]]);
    expect(await chooseBridge(grandparentOnly, null)).toBeNull();

    const noScores = context(new CrossQloo(liked));
    suggest(noScores, "visitor", "movie", [["A", "Film A", undefined]]);
    suggest(noScores, "grandparent", "movie", [["C", "Film C", undefined]]);
    expect(await chooseBridge(noScores, null)).toBeNull();

    const down = new CrossQloo(liked);
    down.affinity = async () => {
      throw new Error("Qloo 503");
    };
    const { ctx } = films(down);
    expect(await chooseBridge(ctx, null)).toBeNull();
    expect(ctx.qlooFailures).toBe(1);
    expect(ctx.ledger.items).toHaveLength(2); // no bridge check is recorded
  });
});

// Rubric item 3: the bridge is more than famous. Qloo's affinity is high for famous things whatever the taste
// (measured on 2026-10-11: each of its 50 most popular films scored high with the sample family's two tastes),
// so the bridge is held against that list. The list and the numbers here are invented.
describe("more than famous", () => {
  // Ten films anyone is offered. Both tastes give each of them the same affinity: 0.70, 0.72 ... 0.88.
  const offeredToAnyone = Array.from({ length: 10 }, (_, i) => ({ id: `P${i}`, name: `Popular Film ${i}`, tags: [] }));
  const anyoneLikes = Object.fromEntries(offeredToAnyone.map((f, i) => [f.id, Number((0.7 + i * 0.02).toFixed(2))]));
  function measured(likedByOther: Record<string, number>, famous = offeredToAnyone) {
    const qloo = new CrossQloo({ ...anyoneLikes, ...likedByOther });
    qloo.famousList = famous;
    const ctx = context(qloo);
    suggest(ctx, "visitor", "movie", [["A", "Film A", 0.95]]); // gives the visitor's signals
    return { ctx, qloo };
  }

  it("says how the bridge stands against what Qloo suggests to anyone, for the card and the planner", async () => {
    const { ctx, qloo } = measured({ C: 0.6, D: 0.82, E: 0.84 });
    suggest(ctx, "grandparent", "movie", [["C", "Film C", 0.88], ["D", "Film D", 0.85], ["E", "Film E", 0.9]]);
    const choice = await chooseBridge(ctx, null);
    // The middle of the ten is 0.80 on each side. Film E has 0.90 and 0.84, and is not one of the ten.
    expect(choice?.bridge).toMatchObject({ title: "Film E", beyondFame: true });
    expect(choice?.beyondFame).toEqual({ of: 10, grandparent: 0.8, visitor: 0.8 });
    expect(choice?.fameMissed).toBeUndefined();
    expect(choice?.summary).toBe("Qloo bridge check: of what Qloo suggested for the grandparent, Film E is closest to both (affinity 0.90 with the grandparent's favorites, 0.84 with the visitor's), and not one of the 10 films Qloo suggests to anyone");
    expect(ctx.ledger.get(choice!.checkId)?.context).toBe("For scale: the 10 films Qloo suggests to anyone score 0.80 with the grandparent's favorites and 0.80 with the visitor's at the middle. Film E is not one of them.");
    // One list for the type, then each taste's view of it: ids only.
    expect(qloo.calls.filter((c) => c.startsWith("famous") || c.includes("P0"))).toEqual(["famous:movie", `affinity:G1+G2|${offeredToAnyone.map((f) => f.id).join("+")}`, `affinity:V1|${offeredToAnyone.map((f) => f.id).join("+")}`]);
  });

  it("passes over a candidate that is on the list, though both tastes like it most", async () => {
    const { ctx } = measured({ P9: 0.95, E: 0.84 });
    suggest(ctx, "grandparent", "movie", [["P9", "Popular Film 9", 0.96], ["E", "Film E", 0.9]]);
    const choice = await chooseBridge(ctx, null);
    expect(choice?.candidates.map((c) => [c.title, c.beyondFame])).toEqual([["Film E", true], ["Popular Film 9", false]]);
    expect(choice?.bridge.title).toBe("Film E");
  });

  it("passes over a candidate that either taste likes no more than the middle of the list", async () => {
    // Film C: 0.88 with the grandparent's favorites but only 0.79 with the visitor's, under the list's 0.80.
    const { ctx } = measured({ C: 0.79, D: 0.82 });
    suggest(ctx, "grandparent", "movie", [["C", "Film C", 0.88], ["D", "Film D", 0.85]]);
    const choice = await chooseBridge(ctx, null);
    expect(choice?.bridge).toMatchObject({ title: "Film D", grandparent: 0.85, visitor: 0.82, beyondFame: true });
  });

  it("still gives a bridge when none is more than famous, and says plainly why it did not pass, with the numbers", async () => {
    const { ctx } = measured({ C: 0.6, D: 0.72 });
    suggest(ctx, "grandparent", "movie", [["C", "Film C", 0.88], ["D", "Film D", 0.85]]);
    const choice = await chooseBridge(ctx, null);
    expect(choice?.bridge).toMatchObject({ title: "Film D", beyondFame: false });
    expect(choice?.beyondFame).toBeUndefined(); // no pass is claimed
    expect(choice?.fameMissed).toEqual({ of: 10, grandparent: 0.8, visitor: 0.8, listed: false });
    expect(choice?.summary).toBe("Qloo bridge check: of what Qloo suggested for the grandparent, Film D is closest to both (affinity 0.85 with the grandparent's favorites, 0.72 with the visitor's), though not above the middle of the 10 films Qloo suggests to anyone");
    expect(ctx.ledger.get(choice!.checkId)?.context).toBe("For scale: the 10 films Qloo suggests to anyone score 0.80 with the grandparent's favorites and 0.80 with the visitor's at the middle. Film D is not one of them, but its 0.72 with the visitor's is not above that middle.");
  });

  it("says so when the only candidate is one of what Qloo suggests to anyone", async () => {
    const { ctx } = measured({ P9: 0.95 });
    suggest(ctx, "grandparent", "movie", [["P9", "Popular Film 9", 0.96]]);
    const choice = await chooseBridge(ctx, null);
    expect(choice?.bridge.title).toBe("Popular Film 9");
    expect(choice?.fameMissed).toEqual({ of: 10, grandparent: 0.8, visitor: 0.8, listed: true });
    expect(choice?.summary).toContain(", though it is one of the 10 films Qloo suggests to anyone");
    expect(ctx.ledger.get(choice!.checkId)?.context).toBe("For scale: the 10 films Qloo suggests to anyone score 0.80 with the grandparent's favorites and 0.80 with the visitor's at the middle. Popular Film 9 is one of them.");
  });

  it("chooses as before when Qloo cannot say what it suggests to anyone", async () => {
    const { ctx, qloo } = measured({ C: 0.6, E: 0.84 });
    qloo.famous = async () => {
      throw new Error("Qloo 503");
    };
    suggest(ctx, "grandparent", "movie", [["C", "Film C", 0.88], ["E", "Film E", 0.9]]);
    const choice = await chooseBridge(ctx, null);
    expect(choice?.bridge.title).toBe("Film E");
    expect(choice?.bridge.beyondFame).toBeUndefined();
    expect(choice?.beyondFame).toBeUndefined();
    expect(choice?.fameMissed).toBeUndefined();
  });
});

// The whole agent, with Qloo results that carry affinities (the usual test double has none, so the tests elsewhere
// run with a bridge chosen by the planner).
class ScoredQloo extends FakeQloo {
  override async insights(q: InsightsQuery): Promise<QlooEntity[]> {
    return (await super.insights(q)).map((e, i) => ({ ...e, affinity: 0.9 - i * 0.03 }));
  }
}

// What anyone is offered scores 0.80 with each taste here: above the visitor's 0.70 for the grandparent's first film.
class FamousQloo extends ScoredQloo {
  override async affinity(signalIds: string[], itemIds: string[]): Promise<QlooEntity[]> {
    if (!itemIds[0]?.startsWith("P")) return super.affinity(signalIds, itemIds);
    this.calls.push(`affinity:${signalIds.join("+")}|${itemIds.join("+")}`);
    return itemIds.map((id) => ({ id, name: id, tags: [], affinity: 0.8 }));
  }
}

describe("the bridge in a plan", () => {
  const gather = [
    { toolCalls: [call("qloo_search", { query: "Roman Holiday", type: "movie", for: "grandparent" }), call("qloo_search", { query: "Spirited Away", type: "movie", for: "visitor" })] }, // E2, E3
    {
      toolCalls: [
        call("qloo_insights", { for: "grandparent", type: "movie", entity_ids: ["Q-RH"] }), // E4
        call("qloo_insights", { for: "visitor", type: "movie", entity_ids: ["Q-SA"] }), // E5
        call("qloo_compare", { grandparent_ids: ["Q-RH"], visitor_ids: ["Q-SA"] }), // E6
      ],
    },
    { content: "done" },
  ];
  // The planner names another bridge, gives it the wrong kind, and uses the chosen one as a moment as well.
  const draft = JSON.stringify({
    bridge: { title: "Sabrina", kind: "artist", why: "Its songs may speak to {grandparent}, and its warmth to {visitor}.", evidence: ["E4"] },
    moments: [
      { title: "Natalia Lafourcade", kind: "artist", what_to_do: "Listen together.", evidence: ["E5"] },
      { title: "Nosotros los pobres", kind: "film", what_to_do: "Watch the first half together.", evidence: ["E4"] },
      { title: "Kiki's Delivery Service", kind: "film", what_to_do: "The visitor's pick.", evidence: ["E5"] },
      { title: "Tamales", kind: "dish", what_to_do: "Cook them together.", evidence: ["E1"] },
    ],
    questions: ["What songs were playing when you were sixteen?", "Who taught you to make tamales?", "Where did you go to the movies back then?"],
  });
  async function planWith(qloo: ScoredQloo) {
    const store = new MemoryStore();
    const lim = limits({});
    const guard = new SpendGuard(store, lim);
    const llm = new ScriptedLLM([...gather, { content: draft }, { content: JSON.stringify(["¿Uno?", "¿Dos?", "¿Tres?"]) }], guard);
    const events: AgentEvent[] = [];
    const plan = await runPlan(SAMPLE_FAMILY, { llm, qloo, tavily: new FakeTavily(), guard, limits: lim }, (e) => events.push(e));
    const bridges = events.filter((e): e is Extract<AgentEvent, { type: "bridge" }> => e.type === "bridge");
    const planner = llm.requests.find((r) => r.model === "ultra")!.messages[1]!.content as string;
    return { plan, events, bridges, planner, llm };
  }

  it("carries the comparison with what Qloo suggests to anyone to the card, from the first sight of the bridge", async () => {
    const qloo = new ScoredQloo();
    qloo.famousList = Array.from({ length: 10 }, (_, i) => ({ id: `P${i}`, name: `Popular Film ${i}`, tags: [] })); // each taste gives them 0.70 down to 0.52: 0.62 at the middle
    const { plan, bridges, planner } = await planWith(qloo);
    expect(plan?.bridge).toMatchObject({ title: "Nosotros los pobres", affinity: { grandparent: 0.9, visitor: 0.7 }, beyondFame: { of: 10, grandparent: 0.62, visitor: 0.62 } });
    expect(plan?.bridge.fameMissed).toBeUndefined();
    expect(bridges.map((b) => b.bridge.beyondFame)).toEqual([{ of: 10, grandparent: 0.62, visitor: 0.62 }, { of: 10, grandparent: 0.62, visitor: 0.62 }]);
    expect(planner).toContain("For scale: the 10 films Qloo suggests to anyone score 0.62 with the grandparent's favorites and 0.62 with the visitor's at the middle. Nosotros los pobres is not one of them.");
  });

  it("carries a failed comparison too, with its numbers, and claims no pass", async () => {
    const qloo = new FamousQloo();
    qloo.famousList = Array.from({ length: 10 }, (_, i) => ({ id: `P${i}`, name: `Popular Film ${i}`, tags: [] }));
    const { plan, bridges, planner } = await planWith(qloo);
    expect(plan?.bridge).toMatchObject({ title: "Nosotros los pobres", affinity: { grandparent: 0.9, visitor: 0.7 }, fameMissed: { of: 10, grandparent: 0.8, visitor: 0.8, listed: false } });
    expect(plan?.bridge.beyondFame).toBeUndefined();
    expect(bridges.map((b) => b.bridge.fameMissed)).toEqual([{ of: 10, grandparent: 0.8, visitor: 0.8, listed: false }, { of: 10, grandparent: 0.8, visitor: 0.8, listed: false }]);
    expect(planner).toContain("For scale: the 10 films Qloo suggests to anyone score 0.80 with the grandparent's favorites and 0.80 with the visitor's at the middle. Nosotros los pobres is not one of them, but its 0.70 with the visitor's is not above that middle.");
  });

  it("is Qloo's choice whatever the planner writes, arrives before the plan, and carries both affinities", async () => {
    const qloo = new ScoredQloo();
    const { plan, events, bridges, planner, llm } = await planWith(qloo);

    // Of the grandparent's three films the visitor's taste gives the first 0.70, the others less (tests/helpers.ts).
    expect(plan?.bridge).toEqual({
      title: "Nosotros los pobres",
      kind: "film",
      why: "Its songs may speak to {grandparent}, and its warmth to {visitor}.",
      evidence: ["E7", "E4"],
      affinity: { grandparent: 0.9, visitor: 0.7 },
    });
    // The planner used the bridge as a moment too: that moment is left out, with no second call.
    expect(plan?.moments.map((m) => m.evidence[0])).toEqual(["E5", "E5", "E1"]); // the three other moments, in order
    expect(plan?.moments.map((m) => m.title)).not.toContain("Nosotros los pobres");
    expect(llm.requests.filter((r) => r.model === "ultra").map((r) => String(r.messages[0]!.content).slice(0, 9))).toEqual(["You write", "Translate"]); // one draft, no correction

    const types = events.map((e) => (e.type === "tool" ? e.name : e.type));
    const check = types.indexOf("qloo_bridge_check");
    expect(types.slice(check, check + 3)).toEqual(["qloo_bridge_check", "bridge", "step"]); // checked, shown, and only then "Writing the visit plan"
    expect(bridges.map((b) => [b.bridge.title, b.bridge.affinity])).toEqual([
      ["Nosotros los pobres", { grandparent: 0.9, visitor: 0.7 }],
      ["Nosotros los pobres", { grandparent: 0.9, visitor: 0.7 }],
    ]);
    expect(bridges[0]!.bridge.why).toBe("Found from {grandparent}'s favorites, this is what both of their tastes come closest on.");

    expect(plan?.bridge.beyondFame).toBeUndefined(); // Qloo named nothing it suggests to anyone, so no claim is made
    expect(plan?.bridge.fameMissed).toBeUndefined();
    expect(planner).toContain('The bridge is already chosen, by Qloo\'s affinity with each of them: "Nosotros los pobres" (kind film, evidence E7, E4).');
    expect(planner).toContain("E7 [qloo:bridge_check] Qloo bridge check: how much the visitor's taste likes what was suggested for the grandparent: Nosotros los pobres (film, 1948): grandparent 0.90, visitor 0.70");
    expect(qloo.calls.filter((c) => c.startsWith("affinity:"))).toEqual(["affinity:Q-SA|Q-M1+Q-M2+Q-M3"]);
  });
});
