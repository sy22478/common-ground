import { describe, expect, it } from "vitest";
import { runPlan, type AgentEvent } from "@/lib/agent";
import { limits } from "@/lib/config";
import { SAMPLE_FAMILY } from "@/lib/family";
import { SpendGuard } from "@/lib/spend";
import { MemoryStore } from "@/lib/store";
import { FakeQloo, FakeTavily, ScriptedLLM, call } from "./helpers";


// Evidence ids follow the ledger order: E1 is the family's own words, then one id per successful tool call.
const gatherRounds = [
  {
    toolCalls: [
      call("qloo_search", { query: "Pedro Infante", types: "artist", for: "grandparent" }), // wrong name: rejected, no evidence id
      call("qloo_search", { query: "Roman Holiday", type: "movie", for: "grandparent" }), // E2
      call("qloo_search", { query: "Bad Bunny", type: "artist", for: "visitor" }), // E3
      call("qloo_search", { query: "Spirited Away", type: "movie", for: "visitor" }), // E4
    ],
  },
  {
    toolCalls: [
      call("qloo_search", { query: "Pedro Infante", type: "artist", for: "grandparent" }), // E5
      call("qloo_insights", { for: "grandparent", type: "movie", entity_ids: ["Q-PI", "Q-RH"], release_year_min: 1950, release_year_max: 1970, age: "55_and_older" }), // E6
      call("qloo_insights", { for: "visitor", type: "movie", entity_ids: ["Q-BB", "Q-SA"] }), // E7
      call("qloo_compare", { grandparent_ids: ["Q-PI", "Q-RH"], visitor_ids: ["Q-BB", "Q-SA"] }), // E8
      call("qloo_insights", { for: "both", type: "artist", entity_ids: ["Q-PI", "Q-BB"] }), // E9
      call("web_search", { query: "classic Mexican film screening San Antonio October" }), // E10
    ],
  },
  { content: "done" },
];

const groundedPlan = JSON.stringify({
  bridge: { title: "Natalia Lafourcade", kind: "artist", why: "Her boleros sound like Rosa's youth and Leo's playlists.", evidence: ["E9", "E8"] },
  moments: [
    { title: "Nosotros los pobres", kind: "film", what_to_do: "Watch the first half together.", evidence: ["E6"] },
    { title: "Kiki's Delivery Service", kind: "film", what_to_do: "Leo's pick for the next visit.", evidence: ["E7"] },
    { title: "Tamales", kind: "dish", what_to_do: "Cook them together.", evidence: ["E1"] },
    { title: "CineFestival", kind: "event", what_to_do: "A festival of classic Mexican films; check its page for dates.", evidence: ["E10"] },
  ],
  questions: [{ text_en: "What songs were playing when you were sixteen?" }, { text_en: "Who taught you to make tamales?" }, { text_en: "Where did you go to the movies back then?" }],
});

const CAP_FOR_ONE_PLANNING_CALL = "0.01";

const spanish = JSON.stringify(["¿Qué canciones sonaban cuando tenías dieciséis?", "¿Quién te enseñó a hacer tamales?", "¿A dónde ibas al cine en ese entonces?"]);

function deps(replies: ConstructorParameters<typeof ScriptedLLM>[0], over: Record<string, string> = {}) {
  const store = new MemoryStore();
  const lim = limits({ PLAN_CAP_USD: "0.06", ...over });
  const guard = new SpendGuard(store, lim);
  const llm = new ScriptedLLM(replies, guard);
  return { llm, store, guard, qloo: new FakeQloo(), tavily: new FakeTavily(), limits: lim };
}

// Ultra both writes the plan and puts the questions into the grandparent's language. The two calls are told apart by
// what they are asked.
const isTranslation = (r: { messages: { content: unknown }[] }) => String(r.messages[0]?.content).startsWith("Translate each question");
const isPlanner = (r: { model: string; messages: { content: unknown }[] }) => r.model === "ultra" && !isTranslation(r);
const translator = (d: ReturnType<typeof deps>) => d.llm.requests.find(isTranslation)!;

async function run(d: ReturnType<typeof deps>) {
  const events: AgentEvent[] = [];
  const plan = await runPlan(SAMPLE_FAMILY, d, (e) => events.push(e));
  return { plan, events };
}

describe("runPlan", () => {
  it("gathers evidence, corrects a bad tool call, writes a grounded plan and translates the questions", async () => {
    const d = deps([...gatherRounds, { content: groundedPlan }, { content: spanish }]);
    const { plan, events } = await run(d);

    expect(plan?.bridge.title).toBe("Natalia Lafourcade");
    expect(plan?.questions[0]).toEqual({ native: "¿Qué canciones sonaban cuando tenías dieciséis?", english: "What songs were playing when you were sixteen?" });
    const tools = events.filter((e) => e.type === "tool");
    expect(tools[0]).toMatchObject({ name: "qloo_search", ok: false, summary: "Corrected arguments for qloo_search" });
    expect(tools.filter((e) => e.ok)).toHaveLength(9);

    // Routing: Super gathers with thinking off, Ultra plans with thinking on, Nano translates with thinking off.
    expect(d.llm.requests.map((r) => [r.model, r.thinking])).toEqual([
      ["super", false],
      ["super", false],
      ["super", false],
      ["ultra", false], // the first draft is written without thinking
      ["ultra", false], // and the questions are put into her language by the best writer of the three
    ]);
    const done = events.at(-1);
    expect(done).toMatchObject({ type: "done" });
    expect(done && "costUsd" in done ? done.costUsd : 0).toBeGreaterThan(0);
    expect(events.findIndex((e) => e.type === "plan")).toBeLessThan(events.length - 1);
  });

  it("sends an ungrounded plan back once with the problems, and accepts the fixed one", async () => {
    const invented = JSON.parse(groundedPlan);
    invented.bridge = { title: "What a Wonderful World", kind: "song", why: "Everyone loves it.", evidence: ["E9"] };
    const d = deps([...gatherRounds, { content: JSON.stringify(invented) }, { content: groundedPlan }, { content: spanish }]);
    const { plan } = await run(d);
    expect(plan?.bridge.title).toBe("Natalia Lafourcade");
    const retry = d.llm.requests[4]!;
    expect(retry).toMatchObject({ model: "ultra", thinking: true });
    expect(JSON.stringify(retry.messages.at(-1))).toContain('bridge \\"What a Wonderful World\\" is not named in its evidence E9');
  });

  it("tells the planner today's date and that an event card never carries one", async () => {
    const d = { ...deps([...gatherRounds, { content: groundedPlan }, { content: spanish }]), now: () => new Date("2026-10-11T01:00:00Z") };
    await run(d);
    const planner = d.llm.requests.find((r) => r.model === "ultra")!;
    expect(planner.messages[1]!.content).toMatch(/^Today is 2026-10-11\./);
    expect(planner.messages[0]!.content).toContain("Never give a date, a day, a time, a price, a street address or a performer for an event.");
  });

  // A draft with one moment that fails the checks. With four moments it can simply be left out; with three it cannot,
  // because three must remain.
  const withBadMoment = (moments: number) => {
    const plan = JSON.parse(groundedPlan);
    plan.moments = plan.moments.slice(0, moments);
    plan.moments[moments - 1] = { title: "Bolero night at the Majestic", kind: "event", what_to_do: "Go together.", evidence: ["E10"] };
    return JSON.stringify(plan);
  };

  it("leaves out a moment that fails the checks, without a second call, when three remain", async () => {
    const d = deps([...gatherRounds, { content: withBadMoment(4) }, { content: spanish }]);
    const { plan, events } = await run(d);
    expect(d.llm.requests.map((r) => r.model)).toEqual(["super", "super", "super", "ultra", "ultra"]);
    expect(plan?.moments.map((m) => m.title)).toEqual(["Nosotros los pobres", "Kiki's Delivery Service", "Tamales"]);
    expect(events).toContainEqual({ type: "step", text: "Left out one suggestion that did not pass the checks", by: "rule" });
  });

  it("shows four moments when the planner writes five, and still four when one of the five fails a check", async () => {
    const fiveMoments = (last: object) => {
      const plan = JSON.parse(groundedPlan);
      plan.moments = [...plan.moments, last];
      return JSON.stringify(plan);
    };
    const fine = await run(deps([...gatherRounds, { content: fiveMoments({ title: "baking", kind: "activity", what_to_do: "Bake together.", evidence: ["E1"] }) }, { content: spanish }]));
    expect(fine.plan?.moments.map((m) => m.title)).toEqual(["Nosotros los pobres", "Kiki's Delivery Service", "Tamales", "CineFestival"]);

    const d = deps([...gatherRounds, { content: fiveMoments({ title: "Bolero night at the Majestic", kind: "event", what_to_do: "Go together.", evidence: ["E10"] }) }, { content: spanish }]);
    const oneBad = await run(d);
    expect(oneBad.plan?.moments).toHaveLength(4);
    expect(d.llm.requests.filter(isPlanner)).toHaveLength(1);
  });

  it("sends the draft back to a planner that thinks when too little would remain, and then keeps what it can", async () => {
    const d = deps([...gatherRounds, { content: withBadMoment(3) }, { content: withBadMoment(3) }, { content: spanish }]);
    const { plan, events } = await run(d);
    expect(d.llm.requests.filter(isPlanner).map((r) => [r.thinking, r.maxTokens])).toEqual([
      [false, 1200],
      [true, 3500],
    ]);
    expect(plan?.bridge.title).toBe("Natalia Lafourcade");
    expect(plan?.moments.map((m) => m.title)).toEqual(["Nosotros los pobres", "Kiki's Delivery Service"]);
    expect(events).toContainEqual({ type: "step", text: "Left out one suggestion that did not pass the checks", by: "rule" });
  });

  it("keeps what the first draft can give when the cost cap leaves no room for a correction", async () => {
    // Room for the gathering and the fast draft, not for a planner that thinks.
    const d = deps([...gatherRounds, { content: withBadMoment(3) }, { content: spanish }], { PLAN_CAP_USD: CAP_FOR_ONE_PLANNING_CALL });
    const { plan, events } = await run(d);
    expect(d.llm.requests.map((r) => r.model)).toEqual(["super", "super", "super", "ultra", "ultra"]);
    expect(plan?.moments.map((m) => m.title)).toEqual(["Nosotros los pobres", "Kiki's Delivery Service"]);
    expect(events).toContainEqual({ type: "step", text: "Left out one suggestion that did not pass the checks", by: "rule" });
    expect(d.guard.planSpent).toBeLessThanOrEqual(Number(CAP_FOR_ONE_PLANNING_CALL));
  });

  it("replaces a date on an event card instead of sending the plan back", async () => {
    const dated = JSON.parse(groundedPlan);
    dated.moments[3].what_to_do = "Go on Saturday 24 October at 7 pm.";
    const d = deps([...gatherRounds, { content: JSON.stringify(dated) }, { content: spanish }]);
    const { plan } = await run(d);
    expect(d.llm.requests.filter(isPlanner)).toHaveLength(1);
    expect(plan?.moments[3]).toMatchObject({ title: "CineFestival", what_to_do: "Found on the web and not checked. Look at its page for what is on, and when, before you go." });
  });

  it("stops cleanly at the plan's cost cap, with no plan and a human message", async () => {
    const d = deps([...gatherRounds, { content: groundedPlan }, { content: spanish }], { PLAN_CAP_USD: "0.004" });
    const { plan, events } = await run(d);
    expect(plan).toBeNull();
    expect(events).toContainEqual({ type: "error", code: "cap", message: "This plan reached its cost limit before it finished." });
    expect(d.guard.planSpent).toBeLessThanOrEqual(0.004);
    expect(events.at(-1)?.type).toBe("done");
  });

  it("says so plainly when Qloo finds nothing", async () => {
    const d = deps([{ toolCalls: [call("qloo_search", { query: "zzzz", type: "artist", for: "grandparent" })] }, { content: "done" }]);
    const { plan, events } = await run(d);
    expect(plan).toBeNull();
    expect(events).toContainEqual({ type: "error", code: "upstream", message: "Qloo returned nothing usable for these favorites. Try different ones." });
  });
});

// The gate's step 7 (STACK_AND_GATE.md): after "the music was a hit, the film was too long", the next plan has more
// music and no film.
describe("after a visit", () => {
  const family = {
    ...SAMPLE_FAMILY,
    history: [
      {
        landed: [{ title: "Natalia Lafourcade", kind: "artist" as const }],
        rest: [
          { title: "Nosotros los pobres", kind: "film" as const },
          { title: "Kiki's Delivery Service", kind: "film" as const },
        ],
        note: "the music was a hit, the film was too long",
      },
    ],
  };
  const reading = { content: '{"more": ["music"], "avoid": ["film"]}' };
  const obeying = {
    bridge: { title: "Pedro Infante", kind: "artist", why: "His boleros are where their tastes meet.", evidence: ["E5"] },
    moments: [
      { title: "Bad Bunny", kind: "artist", what_to_do: "Leo plays one song and says why he loves it.", evidence: ["E3"] },
      { title: "Tamales", kind: "dish", what_to_do: "Cook them together.", evidence: ["E1"] },
      { title: "CineFestival", kind: "event", what_to_do: "A festival of classic Mexican films; check its page for dates.", evidence: ["E10"] },
    ],
    questions: JSON.parse(groundedPlan).questions,
  };
  const again = async (replies: ConstructorParameters<typeof ScriptedLLM>[0]) => {
    const d = deps(replies);
    const events: AgentEvent[] = [];
    const plan = await runPlan(family, d, (e) => events.push(e));
    return { plan, events, d };
  };
  const kinds = (plan: { bridge: { kind: string }; moments: { kind: string }[] } | null) => [plan!.bridge.kind, ...plan!.moments.map((m) => m.kind)];

  it("reads the feedback first, briefs both models, sends a plan with films back, and accepts the corrected one", async () => {
    // The first draft is the plan from before: two films, one music item, titles already suggested.
    const { plan, events, d } = await again([reading, ...gatherRounds, { content: groundedPlan }, { content: JSON.stringify(obeying) }, { content: spanish }]);

    expect(d.llm.requests.map((r) => r.model)).toEqual(["nano", "super", "super", "super", "ultra", "ultra", "ultra"]);
    expect(events.slice(0, 3)).toEqual([
      { type: "step", text: "Reading how the last visit went", by: "nano" },
      { type: "step", text: "From the last visit: more music, no films this time", by: "nano" },
      { type: "step", text: "Looking up their favorites in Qloo", by: "super" },
    ]);
    const gatherer = d.llm.requests[1]!.messages[0]!.content as string;
    expect(gatherer).toContain("From the last visit: more music, no films this time. That is why the types below are what they are.");
    expect(gatherer).toContain("Also qloo_search what landed last time, for the grandparent: Natalia Lafourcade (artist).");
    expect(gatherer).toContain("- qloo_insights for the grandparent, once for each of these types: artist. Signal ids: the grandparent's, plus the ids of what landed last time.");
    expect(gatherer).toContain("- qloo_insights for the visitor from their ids, once for each of these types: artist.");
    expect(gatherer).toContain("Never call qloo_insights with type movie: that did not suit them last time.");
    expect(gatherer).not.toContain("type movie, and type artist"); // the first visit's types are gone, not just overruled
    const planner = d.llm.requests[4]!.messages[1]!.content as string;
    expect(planner).toContain("After the last visit (this comes before the general rules):\n- music landed: include at least 2 music items");
    expect(planner).toContain("- films went badly: include no film, not as the bridge and not as a moment.");
    expect(planner).toContain("Visit 1: landed: Natalia Lafourcade (artist); not marked as landed: Nosotros los pobres (film), Kiki's Delivery Service (film); note: the music was a hit, the film was too long");
    const sentBack = JSON.stringify(d.llm.requests[5]!.messages.at(-1));
    expect(sentBack).toContain("is a film; after the last visit the family asked for no film this time");
    expect(sentBack).toContain("was already suggested for an earlier visit; suggest something new");
    expect(sentBack).toContain("the plan has 1 music item; music landed last time, so include at least 2");

    expect(plan?.bridge.title).toBe("Pedro Infante");
    // More music where there was one item, and no film. The last artist is one of Qloo's own finds, put in by rule:
    // the corrected draft held none beyond the bridge.
    expect(kinds(plan)).toEqual(["artist", "artist", "dish", "event", "artist"]);
    // The first artist's own sentence said what he loves and was taken out, so that card says the plain line for
    // music. The find put in below it is music too, and takes the next plain line: the same sentence twice in one
    // plan was the fault seen on 2026-10-12.
    expect(plan?.moments[0]).toMatchObject({ what_to_do: "Play a little of this music together and see what you each make of it." });
    expect(plan?.moments.at(-1)).toMatchObject({ what_to_do: "Put on a song or two while you sit together, and say what you each hear in it." });
  });

  it("leaves a film out of a draft that is otherwise fine", async () => {
    const stubborn = { ...obeying, moments: [...obeying.moments, { title: "Sabrina", kind: "film", what_to_do: "Watch it together.", evidence: ["E6"] }] };
    const { plan, events, d } = await again([reading, ...gatherRounds, { content: JSON.stringify(stubborn) }, { content: spanish }]);
    expect(kinds(plan)).toEqual(["artist", "artist", "dish", "event", "artist"]); // the last is a find put in by rule
    expect(events).toContainEqual({ type: "step", text: "Left out one suggestion that did not pass the checks", by: "rule" });
    expect(d.llm.requests.filter(isPlanner)).toHaveLength(1); // a film among four moments is simply left out
  });

  it("keeps a grounded plan, and says so, when a wish cannot be met", async () => {
    const oneSinger = { ...obeying, moments: [{ title: "baking", kind: "activity", what_to_do: "Bake together.", evidence: ["E1"] }, ...obeying.moments.slice(1)] };
    // They asked for books as well. Qloo was not asked for any, so no find can stand in: that wish stays unmet.
    // (More music is met: the code puts in an artist Qloo found.)
    const wantsBooks = { content: '{"more": ["book"], "avoid": ["film"]}' };
    const { plan, events } = await again([wantsBooks, ...gatherRounds, { content: JSON.stringify(oneSinger) }, { content: JSON.stringify(oneSinger) }, { content: spanish }]);
    expect(kinds(plan)).toEqual(["artist", "activity", "dish", "event", "artist"]);
    expect(events).toContainEqual({ type: "step", text: "This plan could not follow everything from the last visit", by: "rule" });
    expect(events.some((e) => e.type === "error")).toBe(false);
  });

  // The find is put in before the wishes are counted. So "more music" is met by an artist Qloo found, the draft is
  // not sent back for it, and the page is not told that a wish went unmet.
  it("counts a find the code puts in towards what the last visit asked for", async () => {
    const oneSinger = { ...obeying, moments: [{ title: "baking", kind: "activity", what_to_do: "Bake together.", evidence: ["E1"] }, ...obeying.moments.slice(1)] };
    const { plan, events, d } = await again([reading, ...gatherRounds, { content: JSON.stringify(oneSinger) }, { content: spanish }]);
    expect(d.llm.requests.filter(isPlanner)).toHaveLength(1);
    expect(kinds(plan)).toEqual(["artist", "activity", "dish", "event", "artist"]);
    expect(events.some((e) => e.type === "step" && e.text === "This plan could not follow everything from the last visit")).toBe(false);
    expect(events).toContainEqual({ type: "step", text: "Put in one of Qloo's own finds: the draft leaned on what they had listed themselves", by: "rule" });
  });

  it("does not read feedback, or change a prompt, when there was no earlier visit", async () => {
    const d = deps([...gatherRounds, { content: groundedPlan }, { content: spanish }]);
    await run(d);
    expect(d.llm.requests.map((r) => r.model)).toEqual(["super", "super", "super", "ultra", "ultra"]);
    expect(d.llm.requests[0]!.messages[0]!.content).toContain("- qloo_insights for the visitor from their ids, twice: type movie, and type artist.");
    expect(d.llm.requests[0]!.messages[0]!.content).not.toContain("From the last visit");
    expect(d.llm.requests[3]!.messages[1]!.content).not.toContain("After the last visit");
  });
});

describe("question translation", () => {
  it("retries on Super when a translation adds a name, and keeps English if that fails too", async () => {
    const withExtra = JSON.stringify(["¿Qué canciones sonaban cuando tenías dieciséis?", "¿Quién te enseñó a hacer tamales, {grandparent}?", "¿A dónde ibas al cine?"]);
    const stillBad = JSON.stringify(["¿Qué canciones sonaban cuando tenías dieciséis?", "¿Quién te enseñó, {visitor}?", "¿A dónde ibas al cine?"]);
    const d = deps([...gatherRounds, { content: groundedPlan }, { content: withExtra }, { content: stillBad }]);
    const { plan } = await run(d);
    expect(d.llm.requests.slice(-2).map((r) => r.model)).toEqual(["ultra", "super"]);
    expect(plan?.questions.map((q) => q.native)).toEqual([
      "¿Qué canciones sonaban cuando tenías dieciséis?",
      "Who taught you to make tamales?",
      "¿A dónde ibas al cine?",
    ]);
  });
});

// Four things real plans did on 2026-10-11 that the checks let through. Each is now set right by rule, with no second
// call to the planner (lib/plan.ts tidied, lib/wording.ts).
describe("the wording rules, on a whole run", () => {
  const draftWith = (change: (plan: ReturnType<typeof JSON.parse>) => void) => {
    const plan = JSON.parse(groundedPlan);
    change(plan);
    return JSON.stringify(plan);
  };

  it("sets right a draft with a claim, a web lead called a place and a question about her abuela", async () => {
    const draft = draftWith((plan) => {
      plan.bridge.why = "Her boleros may speak to them both. They echo the classic cinema she adores.";
      plan.moments[3] = { title: "CineFestival", kind: "place", what_to_do: "Visit the CineFestival at 12 Example St.", evidence: ["E10"] };
      plan.questions = ["What songs were playing when you were sixteen?", "What is a story your abuela told that you still carry?", "Who taught you to make tamales?", "Where did you go to the movies back then?", "What song would you want playing the first time you held me?"];
    });
    const d = deps([...gatherRounds, { content: draft }, { content: spanish }]);
    const { plan, events } = await run(d);

    expect(d.llm.requests.filter(isPlanner)).toHaveLength(1);
    expect(plan?.bridge.why).toBe("Her boleros may speak to them both.");
    expect(plan?.moments[3]).toEqual({ title: "CineFestival", kind: "event", what_to_do: "Found on the web and not checked. Look at its page for what is on, and when, before you go.", evidence: ["E10"] });
    expect(plan?.questions.map((q) => q.english)).toEqual(["What songs were playing when you were sixteen?", "Who taught you to make tamales?", "Where did you go to the movies back then?"]);
    // The questions that were left out never reach the model that translates.
    expect(JSON.parse(translator(d).messages[1]!.content as string)).toHaveLength(3);
    const steps = events.flatMap((e) => (e.type === "step" ? [e.text] : []));
    expect(steps).toContain("Took out a sentence that said more about them than the family told us");
    expect(steps).toContain("Left out 2 questions that assumed something about their life");
  });

  // Real, 2026-10-12, in the plan recorded for the video: three sentences were taken out, and two cards of one kind
  // were left saying the same plain line. The sentences here are invented.
  it("leaves no two cards with the same sentence when a rule has taken the planner's own out of both", async () => {
    const draft = draftWith((plan) => {
      plan.moments[0].what_to_do = "The classic cinema {grandparent} adores.";
      plan.moments[1].what_to_do = "A film in the style {visitor} loves.";
    });
    const { plan, events } = await run(deps([...gatherRounds, { content: draft }, { content: spanish }]));
    expect(events).toContainEqual({ type: "step", text: "Took out 2 sentences that said more about them than the family told us", by: "rule" });
    expect(plan?.moments.slice(0, 2).map((m) => m.kind)).toEqual(["film", "film"]);
    expect(plan?.moments[0]!.what_to_do).toBe("Watch it together, and stop whenever there is something to talk about.");
    expect(plan?.moments[1]!.what_to_do).toBe("Put it on one evening and watch as much of it as feels right.");
    expect(new Set(plan?.moments.map((m) => m.what_to_do)).size).toBe(plan?.moments.length);
  });

  it("tells the planner the rules it will be held to, and asks for five questions", async () => {
    const d = deps([...gatherRounds, { content: groundedPlan }, { content: spanish }]);
    await run(d);
    const rules = d.llm.requests.find(isPlanner)!.messages[0]!.content as string;
    expect(rules).toContain("Anything found only by a web search is kind event, never place");
    expect(rules).toContain("Never state what either of them loves, likes, enjoys, knows, remembers or grew up with");
    expect(rules).toContain("questions: exactly 5 open questions");
    expect(rules).toContain("no mother,\nfather, grandmother or other relative");
    // What the family said themselves is in the evidence the planner reads, and a question may use it.
    expect(d.llm.requests.find(isPlanner)!.messages[1]!.content).toContain("E1 [family:input] In the family's own words: Pedro Infante; Roman Holiday; Javier Solis; making tamales at Christmas; Bad Bunny; Spirited Away; baking\n   Language: Spanish. City: San Antonio, Texas.");
  });

  // The real slip: "felt like" put word for word. A spare question takes its place, so the family still gets three
  // in Spanish and no second model is asked.
  it("shows a spare question when a translation has a slip a rule can see", async () => {
    const english = ["What songs were playing when you were sixteen?", "What was a song that felt like it was written just for you?", "Who taught you to make tamales?", "Where did you go to the movies back then?", "Which film would you watch again tonight?"];
    const translated = ["¿Qué canciones sonaban cuando tenías dieciséis?", "¿Cuál fue una canción que sintió como si hubiera sido escrita solo para ti?", "¿Quién te enseñó a hacer tamales?", "¿A dónde ibas al cine en ese entonces?", "¿Qué película volverías a ver esta noche?"];
    const d = deps([...gatherRounds, { content: draftWith((plan) => (plan.questions = english)) }, { content: JSON.stringify(translated) }]);
    const { plan } = await run(d);
    expect(plan?.questions).toEqual([
      { native: translated[0], english: english[0] },
      { native: translated[2], english: english[2] },
      { native: translated[3], english: english[3] },
    ]);
    expect(d.llm.requests.at(-1)).toMatchObject({ model: "ultra" });
    expect(d.llm.requests.filter(isTranslation)).toHaveLength(1);
  });

  it("asks the second translator only for want of three clean questions, and then prefers its clean one to English", async () => {
    const slip = JSON.stringify(["¿Qué canciones sonaban cuando tenías dieciséis?", "¿Quién te enseñó a hacer tamales de niño?", "¿A dónde ibas al cine en ese entonces?"]);
    const d = deps([...gatherRounds, { content: groundedPlan }, { content: slip }, { content: spanish }]);
    const { plan } = await run(d);
    expect(d.llm.requests.filter(isTranslation).map((r) => r.model)).toEqual(["ultra", "super"]);
    expect(plan?.questions[1]).toEqual({ native: "¿Quién te enseñó a hacer tamales?", english: "Who taught you to make tamales?" }); // "de niño" to a grandmother was refused
  });
});

// Real, 2026-10-11: a plan for a family typed into the form was all their own favorites beyond the bridge. The
// instruction that allows one listed work or artist is now a rule in code, and so is "at least two of Qloo's finds".
describe("a plan is more than their own lists read back", () => {
  const allTheirOwn = JSON.stringify({
    bridge: { title: "Natalia Lafourcade", kind: "artist", why: "Her songs may speak to them both.", evidence: ["E9"] },
    moments: [
      { title: "Pedro Infante", kind: "artist", what_to_do: "Play a few of his songs together.", evidence: ["E1", "E5"] },
      { title: "Roman Holiday", kind: "film", what_to_do: "Watch it together.", evidence: ["E1", "E2"] },
      { title: "Bad Bunny", kind: "artist", what_to_do: "Play one song.", evidence: ["E1", "E3"] },
      { title: "Tamales", kind: "dish", what_to_do: "Cook them together.", evidence: ["E1"] },
      { title: "baking", kind: "activity", what_to_do: "Bake together.", evidence: ["E1"] },
    ],
    questions: JSON.parse(groundedPlan).questions,
  });

  it("names Qloo's finds to the planner and asks for two of them", async () => {
    const d = deps([...gatherRounds, { content: groundedPlan }, { content: spanish }]);
    await run(d);
    const message = d.llm.requests.find(isPlanner)!.messages[1]!.content as string;
    expect(message.split("\n").find((line) => line.startsWith("Qloo's own finds"))).toBe('Qloo\'s own finds, best first (none is on their lists): "Nosotros los pobres" (film, E6); "Kiki\'s Delivery Service" (film, E7); "Natalia Lafourcade" (artist, E9, E7); "Sabrina" (film, E6); "Coco" (artist, E9); "A toda máquina" (film, E6). At least 2 of the moments must be from these.');
    expect(d.llm.requests.find(isPlanner)!.messages[0]!.content).toContain("at most one moment may be a work or artist\nthey listed themselves, and at least two moments must be from the list headed \"Qloo's own finds\" in the message.");
  });

  it("gives two of their own works' places to Qloo's finds, says so, and asks the planner nothing more", async () => {
    const d = deps([...gatherRounds, { content: allTheirOwn }, { content: spanish }]);
    const { plan, events } = await run(d);
    expect(d.llm.requests.filter(isPlanner)).toHaveLength(1);
    expect(plan?.moments.map((m) => [m.title, m.kind])).toEqual([
      ["Pedro Infante", "artist"],
      ["Nosotros los pobres", "film"],
      ["Kiki's Delivery Service", "film"],
      ["Tamales", "dish"],
    ]);
    expect(plan?.moments[1]).toMatchObject({ what_to_do: "Watch it together, and stop whenever there is something to talk about.", evidence: ["E6"] });
    // Two finds of one kind, both put in by the code: the second does not say the first one's sentence again.
    expect(plan?.moments[2]).toMatchObject({ what_to_do: "Put it on one evening and watch as much of it as feels right.", evidence: ["E7"] });
    expect(events).toContainEqual({ type: "step", text: "Put in 2 of Qloo's own finds: the draft leaned on what they had listed themselves", by: "rule" });
  });

  it("says nothing and changes nothing when the draft already holds two finds", async () => {
    const { plan, events } = await run(deps([...gatherRounds, { content: groundedPlan }, { content: spanish }]));
    expect(plan?.moments.map((m) => m.title)).toEqual(["Nosotros los pobres", "Kiki's Delivery Service", "Tamales", "CineFestival"]);
    expect(events.some((e) => e.type === "step" && e.text.startsWith("Put in"))).toBe(false);
  });
});

// Rubric item 1: Qloo's fourth endpoint in the demo path, where it helps: a dish the family named becomes somewhere
// near the grandparent to eat it. The address on the card is Qloo's, copied in code.
describe("an outing from Qloo's tags", () => {
  const rounds = [
    { toolCalls: [...gatherRounds[0]!.toolCalls!.slice(1), call("qloo_tags", { query: "tamales" })] }, // E2, E3, E4, then E5: the tags
    {
      toolCalls: [
        call("qloo_insights", { for: "visitor", type: "movie", entity_ids: ["Q-BB", "Q-SA"] }), // E6
        call("qloo_compare", { grandparent_ids: ["Q-RH"], visitor_ids: ["Q-BB", "Q-SA"] }), // E7
        call("qloo_insights", { for: "both", type: "place", entity_ids: ["Q-RH", "Q-BB"] }), // E8
      ],
    },
    { content: "done" },
  ];
  const draft = JSON.stringify({
    bridge: { title: "Kiki's Delivery Service", kind: "film", why: "Its gentle story may speak to them both.", evidence: ["E6"] },
    moments: [
      { title: "Example Tamale House", kind: "activity", what_to_do: "Go for a plate of tamales and compare them with the ones made at home.", evidence: ["E8", "E5"] },
      { title: "Tamales", kind: "dish", what_to_do: "Cook them together.", evidence: ["E1"] },
      { title: "baking", kind: "activity", what_to_do: "Bake together.", evidence: ["E1"] },
    ],
    questions: JSON.parse(groundedPlan).questions,
  });

  it("asks the gathering model for a tag search and a place search, only when a city was given", async () => {
    const d = deps([...rounds, { content: draft }, { content: spanish }]);
    await run(d);
    const gatherer = d.llm.requests[0]!.messages[0]!.content as string;
    expect(gatherer).toContain("In the same reply, if a favorite names a dish or a food, call qloo_tags once with the one word that names the food.");
    expect(gatherer).toContain('- if qloo_tags found a kind of place: one qloo_insights with type place and "for": "both", with ids of both of them. It finds such places near San Antonio, Texas.');

    const noCity = deps([...rounds, { content: draft }, { content: spanish }]);
    await runPlan({ ...SAMPLE_FAMILY, grandparent: { ...SAMPLE_FAMILY.grandparent, city: undefined } }, noCity, () => {});
    expect(noCity.llm.requests[0]!.messages[0]!.content).not.toContain("qloo_tags");
  });

  it("makes the place a place whatever the planner called it, and gives the card Qloo's address", async () => {
    const d = deps([...rounds, { content: draft }, { content: spanish }]);
    const { plan, events } = await run(d);
    expect((d.qloo as FakeQloo).calls).toContain("tags:tamales");
    expect((d.qloo as FakeQloo).calls).toContain("insights:place:Q-RH+Q-BB+Q-SA:tags=urn:tag:genre:place:example_tamale_house:near=San Antonio, Texas");
    expect(plan?.moments[0]).toEqual({
      title: "Example Tamale House",
      kind: "place",
      what_to_do: "Go for a plate of tamales and compare them with the ones made at home.",
      evidence: ["E8", "E5"],
      where: "12 Example St Example City, TX 00000",
    });
    expect(plan?.moments[1]).not.toHaveProperty("where");
    const tools = events.flatMap((e) => (e.type === "tool" && e.ok ? [e.name] : []));
    for (const endpoint of ["qloo_search", "qloo_tags", "qloo_insights", "qloo_compare"]) expect(tools).toContain(endpoint);
    // The planner reads the kinds of place as context, and the places with Qloo's address for each.
    const evidence = d.llm.requests.find(isPlanner)!.messages[1]!.content as string;
    expect(evidence).toContain('E5 [qloo:tags] Qloo tags for "tamales": \n   The kind of place Qloo knows for "tamales": Tamale house');
    expect(evidence).toContain('E8 [qloo:insights] Qloo place insights for both of them near San Antonio, of the kind "Tamale house": Example Tamale House (12 Example St Example City, TX 00000); Second Example Kitchen (34 Sample Ave Example City, TX 00000)');
  });
});

// Rubric item 5: the trace shows the routing between the three models. Every step and every tool call says who did it.
describe("who did each step", () => {
  const doers = (events: AgentEvent[]) => events.flatMap((e) => (e.type === "step" ? [[e.by, e.text]] : e.type === "tool" ? [[e.by, e.name]] : []));

  it("marks gathering as Super's, writing and the questions as Ultra's", async () => {
    const { events } = await run(deps([...gatherRounds, { content: groundedPlan }, { content: spanish }]));
    const seen = doers(events);
    expect(seen[0]).toEqual(["super", "Looking up their favorites in Qloo"]);
    expect(seen.filter(([, what]) => what === "qloo_search" || what === "qloo_insights" || what === "qloo_compare" || what === "web_search").every(([by]) => by === "super")).toBe(true);
    expect(seen.slice(-2)).toEqual([["ultra", "Writing the visit plan"], ["ultra", "Putting the questions in Spanish"]]);
    expect(events.every((e) => (e.type !== "step" && e.type !== "tool") || Boolean(e.by))).toBe(true);
  });

  it("marks a draft sent back, a rule's work and a second translator", async () => {
    const invented = JSON.parse(groundedPlan);
    invented.bridge = { title: "What a Wonderful World", kind: "song", why: "A song for both.", evidence: ["E9"] };
    invented.questions = [...invented.questions, "What is a story your abuela told that you still carry?"];
    const fixed = JSON.parse(groundedPlan);
    fixed.questions = invented.questions;
    const withName = JSON.stringify(["¿Qué canciones sonaban cuando tenías dieciséis?", "¿Quién te enseñó, {visitor}?", "¿A dónde ibas al cine en ese entonces?"]);
    const { events } = await run(deps([...gatherRounds, { content: JSON.stringify(invented) }, { content: JSON.stringify(fixed) }, { content: withName }, { content: spanish }]));
    const seen = doers(events);
    expect(seen).toContainEqual(["ultra", "The checks sent the draft back, so it is written again, with more thought"]);
    expect(seen).toContainEqual(["rule", "Left out a question that assumed something about their life"]);
    expect(seen).toContainEqual(["super", "Asking a second model for the questions whose wording did not pass"]);
  });
});

// The gate's step 3: the bridge card comes first, within 25 seconds.
describe("speed", () => {
  it("asks the gathering model for three replies, with every call of a step in one reply", async () => {
    const d = deps([...gatherRounds, { content: groundedPlan }, { content: spanish }]);
    await run(d);
    const gatherer = d.llm.requests[0]!.messages[0]!.content as string;
    expect(gatherer).toContain("You have three replies. The calls of one reply run at the same\ntime, so put every call of a step in that one reply.");
    expect(gatherer).toContain("Reply 1: qloo_search each favorite of both people");
    expect(gatherer).toContain("- qloo_insights for the visitor from their ids, twice: type movie, and type artist.");
    expect(gatherer).not.toContain("for both"); // the bridge check asks Qloo that question, each way, in code
    expect(gatherer).toContain("Reply 3: the single word done.");
  });

  it("reminds the model once, after a first reply with a single call, and never later", async () => {
    const one = (query: string) => ({ toolCalls: [call("qloo_search", { query, type: "artist", for: "grandparent" })] });
    const d = deps([one("Pedro Infante"), one("Bad Bunny"), { toolCalls: [call("qloo_insights", { for: "both", type: "artist", entity_ids: ["Q-PI", "Q-BB"] })] }, { content: "done" }, { content: groundedPlan }, { content: spanish }]);
    await run(d);
    const reminders = (i: number) => d.llm.requests[i]!.messages.filter((m) => m.role === "user" && String(m.content).startsWith("Put all the other searches in your next reply")).length;
    expect([reminders(0), reminders(1), reminders(2), reminders(3)]).toEqual([0, 1, 1, 1]);
    expect(d.llm.requests[0]).toMatchObject({ model: "super", temperature: 0 });
  });

  it("sends the bridge as soon as it is settled, before the questions are translated", async () => {
    const d = deps([...gatherRounds, { content: groundedPlan }, { content: spanish }]);
    const { events } = await run(d);
    const at = (type: string, text?: string) => events.findIndex((e) => e.type === type && (!text || ("text" in e && e.text === text)));
    expect(events[at("bridge")]).toMatchObject({ type: "bridge", bridge: { title: "Natalia Lafourcade", evidence: ["E9", "E8"] } });
    expect(at("bridge")).toBeLessThan(at("step", "Putting the questions in Spanish"));
    expect(at("bridge")).toBeLessThan(at("plan"));
    const bridge = events[at("bridge")] as Extract<AgentEvent, { type: "bridge" }>;
    expect(bridge.evidence.map((e) => e.id)).toContain("E9"); // the page needs the labels for the bridge's chips
  });

  it("sends no bridge when there is no plan", async () => {
    const d = deps([{ toolCalls: [call("qloo_search", { query: "zzzz", type: "artist", for: "grandparent" })] }, { content: "done" }]);
    const { events } = await run(d);
    expect(events.some((e) => e.type === "bridge")).toBe(false);
  });
});

describe("gendered languages", () => {
  const translatorPrompt = async (family: typeof SAMPLE_FAMILY) => {
    const d = deps([...gatherRounds, { content: groundedPlan }, { content: spanish }]);
    await runPlan(family, d, () => {});
    return translator(d).messages[0]!.content as string;
  };

  it("gives the questions to Nemotron 3 Ultra, thinking off, and asks for the respect an elder is owed", async () => {
    const d = deps([...gatherRounds, { content: groundedPlan }, { content: spanish }]);
    await runPlan(SAMPLE_FAMILY, d, () => {});
    expect(translator(d)).toMatchObject({ model: "ultra", thinking: false });
    expect(translator(d).messages[0]!.content).toContain("Address them the way that language shows respect to an elder (in Hindi आप, never तुम or तू); in Spanish keep the familiar tú.");
  });

  it("tells the translator the questions are for a grandmother, so Spanish says niña and not niño", async () => {
    expect(SAMPLE_FAMILY.grandparent.relation).toBe("grandmother");
    expect(await translatorPrompt(SAMPLE_FAMILY)).toContain("their grandmother. She is a woman: use feminine forms for her");
  });

  it("asks for wording that fits either when the family did not say", async () => {
    const unknown = { ...SAMPLE_FAMILY, grandparent: { ...SAMPLE_FAMILY.grandparent, relation: undefined } };
    expect(await translatorPrompt(unknown)).toContain("Their gender is not known: choose wording that fits either");
  });
});

describe("without Qloo", () => {
  it("stops before any model call", async () => {
    const d = { ...deps([]), qloo: null };
    const events: AgentEvent[] = [];
    const plan = await runPlan(SAMPLE_FAMILY, d, (e) => events.push(e));
    expect(plan).toBeNull();
    expect(d.llm.requests).toHaveLength(0);
    expect(events[0]).toEqual({ type: "error", code: "upstream", message: "Taste data is not connected yet, so no plan can be made right now." });
  });
});
