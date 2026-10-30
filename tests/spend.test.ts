import { describe, expect, it } from "vitest";
import { limits } from "@/lib/config";
import { CapReached, SpendGuard, spendStatus } from "@/lib/spend";
import { MemoryStore } from "@/lib/store";

const NOW = new Date("2026-10-20T12:00:00Z");
const lim = (over: Record<string, string> = {}) => limits({ PLAN_CAP_USD: "0.06", DAILY_CAP_USD: "0.10", TOTAL_CAP_USD: "0.25", ...over });
const day = "spend:day:2026-10-20";

describe("SpendGuard", () => {
  it("reserves the worst case and settles to the real cost", async () => {
    const store = new MemoryStore();
    const guard = new SpendGuard(store, lim(), () => NOW);
    const r = await guard.reserve(0.02);
    expect(await store.getNumber(day)).toBeCloseTo(0.02);
    await guard.settle(r, 0.005);
    expect(await store.getNumber(day)).toBeCloseTo(0.005);
    expect(await store.getNumber("spend:total")).toBeCloseTo(0.005);
    expect(guard.planSpent).toBeCloseTo(0.005);
  });

  it("stops a plan at its own cap without touching the shared counters", async () => {
    const store = new MemoryStore();
    const guard = new SpendGuard(store, lim(), () => NOW);
    await guard.reserve(0.05);
    await expect(guard.reserve(0.02)).rejects.toEqual(new CapReached("plan"));
    expect(await store.getNumber(day)).toBeCloseTo(0.05);
  });

  it("stops at the daily cap across plans and rolls the refused reservation back", async () => {
    const store = new MemoryStore();
    const a = new SpendGuard(store, lim(), () => NOW);
    const b = new SpendGuard(store, lim(), () => NOW);
    await a.reserve(0.05);
    await b.reserve(0.04);
    const c = new SpendGuard(store, lim(), () => NOW);
    await expect(c.reserve(0.02)).rejects.toMatchObject({ kind: "daily" });
    expect(await store.getNumber(day)).toBeCloseTo(0.09);
  });

  it("stops at the total cap even on a new day", async () => {
    const store = new MemoryStore();
    await store.incrByFloat("spend:total", 0.24);
    const guard = new SpendGuard(store, lim(), () => NOW);
    await expect(guard.reserve(0.02)).rejects.toMatchObject({ kind: "total" });
    expect(await store.getNumber("spend:total")).toBeCloseTo(0.24);
  });

  it("never lets concurrent plans overshoot the daily cap", async () => {
    const store = new MemoryStore();
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => new SpendGuard(store, lim(), () => NOW).reserve(0.03)),
    );
    const accepted = results.filter((r) => r.status === "fulfilled").length;
    expect(accepted).toBe(3);
    expect(await store.getNumber(day)).toBeLessThanOrEqual(0.1 + 1e-9);
  });

  it("reports planning closed when a typical plan no longer fits", async () => {
    const store = new MemoryStore();
    expect((await spendStatus(store, lim(), NOW)).open).toBe(true);
    await store.incrByFloat(day, 0.05);
    expect((await spendStatus(store, lim(), NOW)).open).toBe(false);
  });
});

describe("why planning is paused", () => {
  it("names the total cap first, since it does not reset at midnight", async () => {
    const store = new MemoryStore();
    await store.incrByFloat(day, 0.05);
    expect((await spendStatus(store, lim(), NOW)).pausedFor).toBe("daily");
    await store.incrByFloat("spend:total", 0.2);
    expect((await spendStatus(store, lim(), NOW)).pausedFor).toBe("total");
  });
});
