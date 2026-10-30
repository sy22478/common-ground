import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { runPlan, type AgentEvent } from "@/lib/agent";
import { limits } from "@/lib/config";
import { SAMPLE_FAMILY } from "@/lib/family";
import type { ChatResult } from "@/lib/llm";
import { withoutEventDates, type DraftPlan, type FinalPlan } from "@/lib/plan";
import { PLAIN_WHY } from "@/lib/wording";
import { SpendGuard } from "@/lib/spend";
import { MemoryStore } from "@/lib/store";
import { FakeQloo, FakeTavily, ScriptedLLM } from "./helpers";

// Replays real Nemotron replies recorded by tests/engine.live.test.ts. Offline and free. If the agent changes how it
// talks to the models, this fails and the recording must be made again (npm run test:live, about $0.02).
const recording = JSON.parse(readFileSync("tests/fixtures/engine-synthetic.json", "utf8")) as {
  calls: { request: { model: string; thinking: boolean }; result: ChatResult }[];
  events: AgentEvent[];
};

it("reproduces the recorded plan from the recorded model replies", async () => {
  const store = new MemoryStore();
  const lim = limits({});
  const guard = new SpendGuard(store, lim);
  const llm = new ScriptedLLM(
    recording.calls.map((c) => ({ content: c.result.content, toolCalls: c.result.toolCalls, usage: c.result.usage })),
    guard,
  );
  const events: AgentEvent[] = [];
  const plan = await runPlan(SAMPLE_FAMILY, { llm, qloo: new FakeQloo(), tavily: new FakeTavily(), guard, limits: lim }, (e) => events.push(e));

  const recorded = recording.events.find((e): e is { type: "plan"; plan: FinalPlan } => e.type === "plan")!.plan;
  expect(llm.requests.map((r) => [r.model, r.thinking])).toEqual(recording.calls.map((c) => [c.request.model, c.request.thinking]));
  // The bridge as the models chose it, under today's wording rules: the recorded sentence said what she "treasures",
  // which nobody told us, so the plain line stands in its place.
  expect(recorded.bridge.why).toContain("{grandparent} treasures");
  expect(plan?.bridge).toEqual({ ...recorded.bridge, why: PLAIN_WHY });
  // The moments as the models wrote them, under today's guards. An event card's date gives way to a plain caution.
  // And the recording held one of Qloo's finds beyond the bridge where today's rule wants two: the next find is put
  // in with its plain line, and of the five cards the last one in the family's own words is not shown.
  const written = withoutEventDates(recorded as unknown as DraftPlan).moments;
  expect(written.at(-1)).toMatchObject({ title: "baking", kind: "activity" });
  expect(plan?.moments.slice(0, 3)).toEqual(written.slice(0, 3));
  expect(plan?.moments[3]).toEqual({ title: "Nosotros los pobres", kind: "film", what_to_do: "Watch it together, and stop whenever there is something to talk about.", evidence: ["E7", "E8"] });
  expect(plan?.questions).toEqual(recorded.questions);
  expect(plan?.costUsd).toBeCloseTo(recorded.costUsd, 6);
});
