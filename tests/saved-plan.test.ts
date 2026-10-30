import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@/lib/agent";
import { SAMPLE_FAMILY } from "@/lib/family";
import type { FinalPlan } from "@/lib/plan";
import { eventsFromStream, isShowableSavedPlan, savedPlanProblems, toSavedPlan } from "@/lib/saved";

describe("saved plan", () => {
  it("refuses a plan that was not made with real Qloo data", () => {
    const recording = JSON.parse(readFileSync("tests/fixtures/engine-synthetic.json", "utf8"));
    const plan = recording.events.find((e: { type: string }) => e.type === "plan").plan;
    expect(isShowableSavedPlan({ recordedAt: "2026-10-05", qlooData: "synthetic", steps: [], plan })).toBe(false);
    expect(isShowableSavedPlan({ recordedAt: "2026-10-05", qlooData: "real", steps: [], plan })).toBe(true);
  });

  // Sonu, 2026-10-11 (bus 003): an event card is an unchecked lead, so it stays out of the recording.
  const plan = (kinds: string[]): FinalPlan => ({
    bridge: { title: "A film", kind: "film", why: "Both love it.", evidence: ["E2"] },
    moments: kinds.map((kind, i) => ({ title: `Moment ${i + 1}`, kind: kind as "artist", what_to_do: `Do thing ${i + 1} together.`, evidence: ["E3"] })),
    questions: [{ native: "¿Qué?", english: "What?" }],
    language: "Spanish",
    evidence: [],
    costUsd: 0.02,
  });
  const run = (kinds: string[]): AgentEvent[] => [
    { type: "step", text: "Looking up their favorites in Qloo", by: "super" },
    { type: "tool", name: "qloo_search", ok: true, summary: "Qloo search: found", evidence: "E2", by: "super" },
    { type: "tool", name: "qloo_insights", ok: false, summary: "Corrected arguments for qloo_insights", by: "super" },
    { type: "tool", name: "web_search", ok: true, summary: "Web: a festival page", evidence: "E3", by: "super" },
    { type: "step", text: "Writing the visit plan", by: "ultra" },
    { type: "plan", plan: plan(kinds) },
    { type: "done", costUsd: 0.02, ms: 30000 },
  ];

  it("leaves an event card out of the recording, says how many, and changes nothing else", () => {
    const saved = toSavedPlan(run(["artist", "film", "activity", "event"]), "2026-10-11T03:00:00.000Z")!;
    expect(saved.plan.moments.map((m) => m.title)).toEqual(["Moment 1", "Moment 2", "Moment 3"]);
    expect(saved.leftOut).toBe(1);
    expect(saved.plan.bridge).toEqual(plan([]).bridge);
    expect(saved.plan.questions).toEqual(plan([]).questions);
    expect(saved.steps).toEqual(["Looking up their favorites in Qloo", "Qloo search: found", "Web: a festival page", "Writing the visit plan"]);
    expect(saved.by).toEqual(["super", "super", "super", "ultra"]); // who did each step, for the page
    expect(saved).toMatchObject({ recordedAt: "2026-10-11T03:00:00.000Z", qlooData: "real" });
    expect(isShowableSavedPlan(saved)).toBe(true);
  });

  // A recording made on 2026-10-11 held a festival found on the web as a "place". What a card cites decides.
  it("leaves out a card that cites a web search, whatever kind it was given", () => {
    const events = run(["artist", "film", "activity", "place"]);
    const made = events.find((e) => e.type === "plan") as Extract<AgentEvent, { type: "plan" }>;
    made.plan.evidence = [{ id: "E3", source: "qloo", label: "Qloo", urls: [] }, { id: "E4", source: "tavily", label: "Web search", urls: ["https://example.org"] }];
    made.plan.moments[3]!.evidence = ["E4"];
    const saved = toSavedPlan(events, "2026-10-11T17:00:00.000Z")!;
    expect(saved.plan.moments.map((m) => m.title)).toEqual(["Moment 1", "Moment 2", "Moment 3"]);
    expect(saved.leftOut).toBe(1);
  });

  // The plan that went public on 2026-10-11 said what cinema she "adores". A recording is now held to the wording
  // rules whatever engine made it. The sentences here have the real shape, with invented values.
  it("names what a recording says about them that the family never told us", () => {
    const saved = toSavedPlan(run(["artist", "film", "activity"]), "2026-10-11T17:00:00.000Z")!;
    expect(savedPlanProblems(saved, SAMPLE_FAMILY)).toEqual([]);
    saved.plan.bridge.why = "{grandparent} will love its story, with themes that echo the old studio musicals she adores.";
    saved.plan.moments[0]!.what_to_do = "Play the music {grandparent} grew up with.";
    saved.plan.questions = [{ native: "¿Qué historia te contó tu abuela?", english: "What is a story your abuela told that you still carry?" }];
    expect(savedPlanProblems(saved, SAMPLE_FAMILY)).toEqual([
      '"A film" says what they already love or lived ("she adores")',
      '"Moment 1" says what they already love or lived ("{grandparent} grew up")',
      'the question "What is a story your abuela told that you still carry?" assumes a relative ("abuela") that the family did not mention; ask about the plan or their tastes instead',
    ]);
  });

  // Seen on 2026-10-12 in a live plan: two cards, one sentence. A recording with that fault is not shown either.
  it("names a card that says the same sentence as a card above it", () => {
    const saved = toSavedPlan(run(["artist", "artist", "activity"]), "2026-10-12T22:30:00.000Z")!;
    expect(savedPlanProblems(saved, SAMPLE_FAMILY)).toEqual([]);
    saved.plan.moments[1]!.what_to_do = saved.plan.moments[0]!.what_to_do;
    expect(savedPlanProblems(saved, SAMPLE_FAMILY)).toEqual([`"${saved.plan.moments[1]!.title}" says the same sentence as a card above it`]);
  });

  it("says nothing about who did what for a stream recorded before steps carried it", () => {
    const old = run(["artist", "film", "activity"]).map((e) => (e.type === "step" || e.type === "tool" ? ({ ...e, by: undefined } as unknown as AgentEvent) : e));
    const saved = toSavedPlan(old, "2026-10-11T03:00:00.000Z")!;
    expect(saved.steps).toHaveLength(4);
    expect("by" in saved).toBe(false);
  });

  it("marks nothing as left out when the plan has no event card", () => {
    const saved = toSavedPlan(run(["artist", "film", "activity"]), "2026-10-11T03:00:00.000Z")!;
    expect(saved.plan.moments).toHaveLength(3);
    expect("leftOut" in saved).toBe(false);
  });

  it("saves nothing from a run without a plan, or when too little would remain", () => {
    expect(toSavedPlan([{ type: "error", code: "no_plan", message: "x" }, { type: "done", costUsd: 0.01, ms: 1 }], "2026-10-11T03:00:00.000Z")).toBeNull();
    expect(toSavedPlan(run(["artist", "event", "event"]), "2026-10-11T03:00:00.000Z")).toBeNull();
  });

  it("reads the events of a plan from the stream a deployed route sends", () => {
    const text = `data: ${JSON.stringify({ type: "step", text: "Looking up", by: "super" })}\n\n: keep-alive\n\ndata: ${JSON.stringify({ type: "done", costUsd: 0.02, ms: 5 })}\n\n`;
    expect(eventsFromStream(text)).toEqual([
      { type: "step", text: "Looking up", by: "super" },
      { type: "done", costUsd: 0.02, ms: 5 },
    ]);
  });

  it("if a saved plan is published, it is a showable real one", () => {
    if (!existsSync("public/saved-plan.json")) return; // none recorded yet: the page then shows only the pause notice
    const saved = JSON.parse(readFileSync("public/saved-plan.json", "utf8"));
    expect(isShowableSavedPlan(saved)).toBe(true);
    expect(saved.plan.moments.filter((m: { kind: string }) => m.kind === "event")).toEqual([]); // no unchecked web lead in a recording
    expect(savedPlanProblems(saved, SAMPLE_FAMILY), "the published recording passes the wording rules").toEqual([]);
  });
});
