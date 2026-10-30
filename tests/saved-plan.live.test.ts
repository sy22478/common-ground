import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { runPlan, type AgentEvent } from "@/lib/agent";
import { SAMPLE_FAMILY } from "@/lib/family";
import { eventsFromStream, savedPlanProblems, toSavedPlan } from "@/lib/saved";
import { makeDeps } from "@/lib/server";
import { MemoryStore } from "@/lib/store";
import { has, liveKey, RecordingLLM } from "./live-env";

// LIVE, run by hand: writes public/saved-plan.json, the plan the page offers while live planning is paused.
// - By default it makes one real plan for the sample family here (real Qloo, Tavily and Nemotron: about $0.03 and
//   12 Qloo calls). The full trace goes to the ignored .qloo/ folder.
// - With SAVED_PLAN_STREAM=<file> it makes no call: it reads the event stream of a plan made through a deployed
//   route (the saved output of POST /api/plan).
// Read the plan before deploying it. It holds names Qloo returned, so git ignores it (Qloo's guide: "Do not store
// Qloo response data in a public repository"); a CLI deploy still uploads it from this folder.

function save(events: AgentEvent[], recordedAt: string) {
  const saved = toSavedPlan(events, recordedAt);
  expect(saved).not.toBeNull(); // a run without a plan must not replace the saved one
  expect(savedPlanProblems(saved!, SAMPLE_FAMILY), "a recording must pass the wording rules").toEqual([]);
  writeFileSync("public/saved-plan.json", JSON.stringify(saved, null, 1) + "\n");
}

const stream = process.env.SAVED_PLAN_STREAM;

it.skipIf(!stream)("saves a plan made through a deployed route, from its event stream", () => {
  // The plan was made when the stream was written, not when this runs.
  save(eventsFromStream(readFileSync(stream!, "utf8")), statSync(stream!).mtime.toISOString());
});

it.skipIf(Boolean(stream) || !has("QLOO_API_KEY"))("records a real plan for the paused page", async () => {
  const env = {
    NEBIUS_API_KEY: liveKey("NEBIUS_API_KEY"),
    QLOO_API_KEY: liveKey("QLOO_API_KEY"),
    TAVILY_API_KEY: has("TAVILY_API_KEY") ? liveKey("TAVILY_API_KEY") : undefined,
    HASH_SECRET: "record-saved-plan",
  };
  const store = new MemoryStore();
  const deps = makeDeps(store, env)!;
  const llm = new RecordingLLM(deps.llm);
  const events: AgentEvent[] = [];
  await runPlan(SAMPLE_FAMILY, { ...deps, llm }, (e) => events.push(e));

  const counters = Object.fromEntries(store.entries().filter(([k]) => /^(qloo:calls|tavily:credits|spend):/.test(k)));
  mkdirSync(".qloo", { recursive: true });
  writeFileSync(".qloo/last-plan-trace.json", JSON.stringify({ at: new Date().toISOString(), counters, events, calls: llm.calls }, null, 1) + "\n");

  save(events, new Date().toISOString());
});
