import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { runPlan, type AgentEvent } from "@/lib/agent";
import { SAMPLE_FAMILY, type Family } from "@/lib/family";
import { groupOf } from "@/lib/plan";
import type { SavedPlan } from "@/lib/saved";
import { makeDeps } from "@/lib/server";
import { MemoryStore } from "@/lib/store";
import { has, liveKey, RecordingLLM } from "./live-env";

// LIVE, run by hand (about $0.03): the gate's step 7 on real models and real Qloo data, without a browser.
// The saved plan stands for the first visit. The family says "the music was a hit, the film was too long", and the
// next plan must hold more music and no film. The trace goes to the ignored .qloo/ folder.
const SAVED = "public/saved-plan.json";

it.skipIf(!has("QLOO_API_KEY") || !existsSync(SAVED))("the next plan follows the last visit: more music, no film", async () => {
  const first = (JSON.parse(readFileSync(SAVED, "utf8")) as SavedPlan).plan;
  const cards = [first.bridge, ...first.moments].map(({ title, kind }) => ({ title, kind }));
  const music = (list: { kind: (typeof cards)[number]["kind"] }[]) => list.filter((c) => groupOf(c.kind) === "music").length;
  const family: Family = {
    ...SAMPLE_FAMILY,
    history: [{ landed: cards.filter((c) => groupOf(c.kind) === "music"), rest: cards.filter((c) => groupOf(c.kind) !== "music"), note: "the music was a hit, the film was too long" }],
  };

  const store = new MemoryStore();
  const deps = makeDeps(store, {
    NEBIUS_API_KEY: liveKey("NEBIUS_API_KEY"),
    QLOO_API_KEY: liveKey("QLOO_API_KEY"),
    TAVILY_API_KEY: has("TAVILY_API_KEY") ? liveKey("TAVILY_API_KEY") : undefined,
    HASH_SECRET: "feedback-live-test",
  })!;
  const llm = new RecordingLLM(deps.llm);
  const events: AgentEvent[] = [];
  const plan = await runPlan(family, { ...deps, llm }, (e) => events.push(e));

  const counters = Object.fromEntries(store.entries().filter(([k]) => /^(qloo:calls|tavily:credits|spend):/.test(k)));
  mkdirSync(".qloo", { recursive: true });
  writeFileSync(".qloo/feedback-trace.json", JSON.stringify({ at: new Date().toISOString(), before: cards, counters, events, calls: llm.calls }, null, 1) + "\n");

  expect(plan).not.toBeNull();
  const next = [plan!.bridge, ...plan!.moments];
  expect(next.filter((c) => c.kind === "film").map((c) => c.title)).toEqual([]);
  expect(music(next)).toBeGreaterThan(music(cards));
  const before = new Set(cards.map((c) => c.title.toLowerCase()));
  expect(next.filter((c) => before.has(c.title.toLowerCase())).map((c) => c.title)).toEqual([]);
});
