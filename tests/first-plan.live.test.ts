import { mkdirSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { runPlan, type AgentEvent } from "@/lib/agent";
import { SAMPLE_FAMILY, familyFromForm, type Family } from "@/lib/family";
import { makeDeps } from "@/lib/server";
import { MemoryStore } from "@/lib/store";
import { has, liveKey, RecordingLLM } from "./live-env";

// LIVE, run by hand (about $0.01 each): one first plan on real services, timed stage by stage. Nothing is cached here,
// so this is the slow case: a family the app has not seen. The gate's step 3 wants the bridge within 25 seconds.
// Neither test touches the saved plan; the traces go to the ignored .qloo/ folder. Run one of them with -t.
async function timed(family: Family, trace: string) {
  const store = new MemoryStore();
  const deps = makeDeps(store, {
    NEBIUS_API_KEY: liveKey("NEBIUS_API_KEY"),
    QLOO_API_KEY: liveKey("QLOO_API_KEY"),
    TAVILY_API_KEY: has("TAVILY_API_KEY") ? liveKey("TAVILY_API_KEY") : undefined,
    HASH_SECRET: "first-plan-live-test",
  })!;
  const llm = new RecordingLLM(deps.llm);
  const started = Date.now();
  const events: (AgentEvent & { atMs: number })[] = [];
  const plan = await runPlan(family, { ...deps, llm }, (e) => events.push({ ...e, atMs: Date.now() - started }));

  const at = (type: AgentEvent["type"]) => events.find((e) => e.type === type)?.atMs ?? null;
  const timing = {
    firstToolMs: at("tool"),
    bridgeMs: at("bridge"),
    planMs: at("plan"),
    doneMs: at("done"),
    gatherReplies: llm.calls.filter((c) => c.model === "super" && typeof c.messages === "number").length,
    modelMs: llm.calls.map((c) => [c.model, c.result.ms]),
    costUsd: events.find((e): e is Extract<AgentEvent, { type: "done" }> & { atMs: number } => e.type === "done")?.costUsd,
  };
  const counters = Object.fromEntries(store.entries().filter(([k]) => /^(qloo:calls|tavily:credits|spend):/.test(k)));
  mkdirSync(".qloo", { recursive: true });
  writeFileSync(`.qloo/${trace}.json`, JSON.stringify({ at: new Date().toISOString(), timing, counters, events, calls: llm.calls }, null, 1) + "\n");
  return plan;
}

it.skipIf(!has("QLOO_API_KEY"))("times a first plan for the sample family, stage by stage", async () => {
  expect(await timed(SAMPLE_FAMILY, "first-plan-trace")).not.toBeNull();
});

// A family as a visitor would type it into the form: another language, another script, a grandfather.
it.skipIf(!has("QLOO_API_KEY"))("plans for an own family typed into the form", async () => {
  const { family } = familyFromForm({
    relation: "grandfather",
    birthYear: "1938",
    language: "Hindi",
    city: "Jersey City, New Jersey",
    theirFavorites: "Mohammed Rafi\nMughal-E-Azam\nLata Mangeshkar\nmasala chai in the afternoon",
    yourFavorites: "Taylor Swift\nSpirited Away\nbaking",
  });
  const plan = await timed(family!, "own-family-trace");
  expect(plan).not.toBeNull();
  expect(plan!.language).toBe("Hindi");
  expect(plan!.questions.every((q) => /[\u0900-\u097F]/.test(q.native)), "the questions are in Devanagari").toBe(true);
});
