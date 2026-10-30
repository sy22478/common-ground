import { Redis } from "@upstash/redis";
import { afterAll, describe, expect, it } from "vitest";
import { limits } from "@/lib/config";
import { TokenFactoryLLM } from "@/lib/llm";
import { SpendGuard, spendStatus } from "@/lib/spend";
import { UpstashStore } from "@/lib/store";
import { liveKey } from "./live-env";

// LIVE against the real Upstash database (credentials from .env.local, pulled with `vercel env pull`). Proves the caps
// hold on Redis without the Qloo key and without any public model call. Uses its own key prefix, deleted afterwards,
// so the app's real counters are never touched. Cost: one Nano call, under $0.0001.
const get = (name: string) => {
  try {
    return liveKey(name);
  } catch {
    return "";
  }
};
const url = get("UPSTASH_REDIS_REST_URL") || get("KV_REST_API_URL");
const token = get("UPSTASH_REDIS_REST_TOKEN") || get("KV_REST_API_TOKEN");
const prefix = `test:${Date.now()}:`;
const today = new Date().toISOString().slice(0, 10);
const keys = [`${prefix}spend:day:${today}`, `${prefix}spend:total`];

// The database is shared by development, preview and production, so the test also records the app's real counters
// before it starts and checks they are unchanged at the end.
const appKeys = [`spend:day:${today}`, "spend:total"];

describe.skipIf(!url || !token)("caps on real Upstash", () => {
  const redis = new Redis({ url, token });
  const store = new UpstashStore(redis);
  let appBefore: number[] = [];
  afterAll(() => store.del(keys));

  it("records the app's real counters first", async () => {
    appBefore = await Promise.all(appKeys.map((k) => store.getNumber(k)));
  });

  it("20 concurrent plans cannot overshoot the daily cap", async () => {
    const lim = limits({ PLAN_CAP_USD: "0.06", DAILY_CAP_USD: "0.10", TOTAL_CAP_USD: "1" });
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => new SpendGuard(store, lim, undefined, prefix).reserve(0.03)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect(await store.getNumber(keys[0]!)).toBeLessThanOrEqual(0.1 + 1e-9);
    expect((await spendStatus(store, lim, new Date(), prefix)).pausedFor).toBe("daily");
    await store.del(keys);
  });

  it("a real model call settles its real cost into Redis", async () => {
    const lim = limits({});
    const guard = new SpendGuard(store, lim, undefined, prefix);
    const llm = new TokenFactoryLLM(liveKey("NEBIUS_API_KEY"), guard);
    const result = await llm.chat({ model: "nano", thinking: false, maxTokens: 20, messages: [{ role: "user", content: "Say hello." }] });
    expect(result.costUsd).toBeGreaterThan(0);
    expect(await store.getNumber(keys[0]!)).toBeCloseTo(result.costUsd, 9);
    expect(await store.getNumber(keys[1]!)).toBeCloseTo(result.costUsd, 9);
  });

  it("leaves nothing behind and never touches the app's counters", async () => {
    await store.del(keys);
    expect(await redis.keys(`${prefix}*`)).toEqual([]);
    expect(await Promise.all(appKeys.map((k) => store.getNumber(k)))).toEqual(appBefore);
  });
});
