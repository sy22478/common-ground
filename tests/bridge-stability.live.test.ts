import { mkdirSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { gatherEvidence, newToolContext, type AgentDeps } from "@/lib/agent";
import { chooseBridge } from "@/lib/bridge";
import { limits } from "@/lib/config";
import { SAMPLE_FAMILY } from "@/lib/family";
import { keyedHasher } from "@/lib/hash";
import { TokenFactoryLLM } from "@/lib/llm";
import { QlooClient } from "@/lib/qloo";
import { CapReached, SpendGuard } from "@/lib/spend";
import { MemoryStore } from "@/lib/store";
import { liveKey } from "./live-env";

// LIVE, run by hand only (STABILITY=1, about $0.03): the sample family's bridge in five runs of the real gathering
// (Nemotron 3 Super with the Qloo tools) and the rule, each on an empty store, so no answer is reused. Stricter than
// the live site, which keeps Qloo's answers for a week. The titles are Qloo's, so they go to .qloo/, never to git.
const RUNS = 5;

it.skipIf(process.env.STABILITY !== "1")("measures how often the sample family gets the same bridge", async () => {
  const lim = limits({ PLAN_CAP_USD: "0.06", DAILY_CAP_USD: "0.06", TOTAL_CAP_USD: "0.06", QLOO_CALLS_PER_DAY: "400" });
  const spendStore = new MemoryStore(); // one spend count for all runs, so the $0.06 stop holds across them
  const runs: { title: string | null; passed: boolean | null; costUsd: number }[] = [];
  for (let i = 0; i < RUNS; i++) {
    const store = new MemoryStore();
    const guard = new SpendGuard(spendStore, lim);
    const deps: AgentDeps = {
      llm: new TokenFactoryLLM(liveKey("NEBIUS_API_KEY"), guard),
      qloo: new QlooClient(liveKey("QLOO_API_KEY"), store, lim.qlooPerDay, keyedHasher(`stability-${i}`)),
      tavily: { search: async () => [] },
      guard,
      limits: lim,
    };
    try {
      const ctx = newToolContext(SAMPLE_FAMILY, deps);
      await gatherEvidence(SAMPLE_FAMILY, deps, ctx, null, () => {});
      const choice = await chooseBridge(ctx, null);
      runs.push({ title: choice?.bridge.title ?? null, passed: choice ? Boolean(choice.beyondFame) : null, costUsd: guard.planSpent });
    } catch (error) {
      runs.push({ title: null, passed: null, costUsd: guard.planSpent });
      if (error instanceof CapReached) break;
    }
  }
  const titles = runs.map((r) => r.title);
  const top = [...new Set(titles)].map((t) => [t, titles.filter((x) => x === t).length] as const).sort((a, b) => b[1] - a[1])[0];
  mkdirSync(".qloo/fair-proof", { recursive: true });
  writeFileSync(".qloo/fair-proof/2026-10-28-stability.json", JSON.stringify({ at: new Date().toISOString(), runs, sameAsMostCommon: top?.[1] ?? 0, of: runs.length, spentUsd: runs.reduce((s, r) => s + r.costUsd, 0) }, null, 1) + "\n");
  expect(runs.length).toBeGreaterThan(0);
});
