import { mkdirSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { gatherEvidence, newToolContext, type AgentEvent } from "@/lib/agent";
import { limits } from "@/lib/config";
import { SAMPLE_FAMILY } from "@/lib/family";
import { TokenFactoryLLM } from "@/lib/llm";
import { SpendGuard } from "@/lib/spend";
import { MemoryStore } from "@/lib/store";
import { FakeQloo, FakeTavily } from "./helpers";
import { liveKey, RecordingLLM } from "./live-env";

// LIVE, run by hand (about $0.003): the gathering stage alone on real Nemotron 3 Super, with synthetic Qloo data and
// no planner. It shows how the model spreads its tool calls over replies, which is what gathering costs in money
// and seconds. The prompt asks for three replies; this is where a change to that prompt is tried first.
it("gathers in a few replies, several calls in each", async () => {
  const lim = limits({});
  const guard = new SpendGuard(new MemoryStore(), lim);
  const llm = new RecordingLLM(new TokenFactoryLLM(liveKey("NEBIUS_API_KEY"), guard));
  const deps = { llm, qloo: new FakeQloo(), tavily: new FakeTavily(), guard, limits: lim };
  const ctx = newToolContext(SAMPLE_FAMILY, deps);
  const events: AgentEvent[] = [];
  const { replies } = await gatherEvidence(SAMPLE_FAMILY, deps, ctx, null, (e) => events.push(e));

  const perReply = llm.calls.map((c) => c.result.toolCalls.map((t) => t.function.name));
  mkdirSync(".qloo", { recursive: true });
  writeFileSync(".qloo/gather-trace.json", JSON.stringify({ at: new Date().toISOString(), replies, perReply, costUsd: guard.planSpent, ms: llm.calls.map((c) => c.result.ms), events }, null, 1) + "\n");

  expect(events.filter((e) => e.type === "tool" && e.ok).length).toBeGreaterThanOrEqual(8); // searches, insights, compare
  expect(replies).toBeLessThanOrEqual(4);
});
