import { describe, expect, it, vi } from "vitest";
import { limits } from "@/lib/config";
import { LLMError, TokenFactoryLLM, stripThinking } from "@/lib/llm";
import { CapReached, SpendGuard } from "@/lib/spend";
import { MemoryStore } from "@/lib/store";

const KEY = "test-key-should-never-appear-0123456789";
const NOW = new Date("2026-10-20T12:00:00Z");
const day = "spend:day:2026-10-20";

function setup(over: Record<string, string> = {}, response?: () => Response | Promise<Response>) {
  const store = new MemoryStore();
  const guard = new SpendGuard(store, limits({ PLAN_CAP_USD: "0.06", DAILY_CAP_USD: "1", ...over }), () => NOW);
  const fetchImpl = vi.fn(
    response ??
      (async () =>
        Response.json({
          choices: [{ message: { content: "<think>hmm</think>Hola", tool_calls: [] }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1000, completion_tokens: 500 },
        })),
  );
  return { store, guard, fetchImpl, llm: new TokenFactoryLLM(KEY, guard, fetchImpl as unknown as typeof fetch) };
}

describe("TokenFactoryLLM", () => {
  it("sends the model, the thinking switch and the key, and meters the real cost", async () => {
    const { llm, fetchImpl, store } = setup();
    const result = await llm.chat({ model: "super", messages: [{ role: "user", content: "hi" }], thinking: false, maxTokens: 100 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(url).toBe("https://api.tokenfactory.nebius.com/v1/chat/completions");
    expect(body.model).toBe("nvidia/nemotron-3-super-120b-a12b");
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    expect(result.content).toBe("Hola");
    // Super: 1000 in at $0.30/M + 500 out at $0.90/M
    expect(result.costUsd).toBeCloseTo(0.00075, 8);
    expect(await store.getNumber(day)).toBeCloseTo(0.00075, 8);
  });

  it("refuses before any network call when the cap is reached", async () => {
    const { llm, fetchImpl } = setup({ PLAN_CAP_USD: "0.000001" });
    await expect(llm.chat({ model: "ultra", messages: [{ role: "user", content: "plan" }], thinking: true, maxTokens: 3500 })).rejects.toBeInstanceOf(CapReached);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refunds the reservation on an HTTP error and never echoes the key", async () => {
    const { llm, store } = setup({}, () => new Response(`upstream said ${KEY} is bad`, { status: 500 }));
    const error = await llm.chat({ model: "nano", messages: [{ role: "user", content: "x" }], thinking: false, maxTokens: 50 }).catch((e) => e);
    expect(error).toBeInstanceOf(LLMError);
    expect(String(error.message)).not.toContain(KEY);
    expect(await store.getNumber(day)).toBe(0);
  });

  it("keeps the worst-case reservation when a call times out (it may have been billed)", async () => {
    const { llm, store } = setup({}, () => {
      throw new DOMException("timed out", "TimeoutError");
    });
    await expect(llm.chat({ model: "nano", messages: [{ role: "user", content: "x" }], thinking: false, maxTokens: 50 })).rejects.toBeDefined();
    expect(await store.getNumber(day)).toBeGreaterThan(0);
  });

  it("strips inline thinking", () => {
    expect(stripThinking("<think>a\nb</think>\n answer")).toBe("answer");
  });
});
