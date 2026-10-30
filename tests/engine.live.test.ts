import { writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { runPlan, type AgentEvent } from "@/lib/agent";
import { limits } from "@/lib/config";
import { SAMPLE_FAMILY } from "@/lib/family";
import { TokenFactoryLLM, type ChatRequest, type ChatResult, type LLM } from "@/lib/llm";
import { SpendGuard } from "@/lib/spend";
import { MemoryStore } from "@/lib/store";
import { FakeQloo, FakeTavily } from "./helpers";
import { liveKey } from "./live-env";

// LIVE: real Nemotron calls on Token Factory (about $0.02), synthetic Qloo, fake web search.
// Records the model's replies to tests/fixtures/engine-synthetic.json for the offline replay test.
class RecordingLLM implements LLM {
  readonly log: { request: { model: string; thinking: boolean; messages: number }; result: ChatResult }[] = [];
  constructor(private inner: LLM) {}
  async chat(request: ChatRequest): Promise<ChatResult> {
    const result = await this.inner.chat(request);
    this.log.push({ request: { model: request.model, thinking: request.thinking, messages: request.messages.length }, result });
    return result;
  }
}

it("plans the sample family end to end on real Nemotron", async () => {
  const store = new MemoryStore();
  // PLAN_CAP_USD in the environment bounds what one recording can cost (the default cap is $0.06).
  const lim = limits({ PLAN_CAP_USD: process.env.PLAN_CAP_USD });
  const guard = new SpendGuard(store, lim);
  const llm = new RecordingLLM(new TokenFactoryLLM(liveKey("NEBIUS_API_KEY"), guard));
  const events: AgentEvent[] = [];
  const plan = await runPlan(SAMPLE_FAMILY, { llm, qloo: new FakeQloo(), tavily: new FakeTavily(), guard, limits: lim }, (e) => {
    events.push(e);
    console.log(JSON.stringify(e).slice(0, 300));
  });
  expect(plan).not.toBeNull(); // a failed run must not replace the recording
  writeFileSync(
    "tests/fixtures/engine-synthetic.json",
    JSON.stringify({ recordedAt: new Date().toISOString(), note: "Real Nemotron replies; Qloo data is SYNTHETIC (tests/helpers.ts).", calls: llm.log, events }, null, 1),
  );
  console.log(
    "calls:",
    llm.log.map((c) => `${c.request.model}/${c.request.thinking ? "think" : "fast"} ${c.result.usage.prompt_tokens}+${c.result.usage.completion_tokens} $${c.result.costUsd.toFixed(5)} ${c.result.ms}ms`),
  );
  expect(plan).not.toBeNull();
  expect(guard.planSpent).toBeLessThan(lim.planUsd);
});
