import { describe, expect, it } from "vitest";
import { budgetAt, judgingOver, limits, livePlanningOn, nextBudgetRaise } from "@/lib/config";
import { CapReached, pausedMessage, SpendGuard } from "@/lib/spend";
import { MemoryStore } from "@/lib/store";

const at = (iso: string) => new Date(iso);

// The cap per plan, set by Sonu on 2026-10-11 (bus 003). The figures below are the largest measured on real Qloo
// data that day (API_NOTES.md): $0.018 of gathering, a first planning call that settles at $0.0114, and a second one
// that must reserve about $0.013 before it is sent.
describe("the cap per plan", () => {
  const largestRealPlan = async (planCap?: string) => {
    const guard = new SpendGuard(new MemoryStore(), limits(planCap ? { PLAN_CAP_USD: planCap } : {}, at("2026-10-12T00:00:00Z")));
    await guard.settle(await guard.reserve(0.018), 0.018); // gathering
    await guard.settle(await guard.reserve(0.0125), 0.0114); // the plan
    await guard.settle(await guard.reserve(0.013), 0.0114); // the plan again, after one correction
    return guard.planSpent;
  };

  it("is $0.06 by default", () => {
    expect(limits({}).planUsd).toBe(0.06);
  });

  it("leaves room to send the largest real plan back to the planner once", async () => {
    expect(await largestRealPlan()).toBeCloseTo(0.0408, 4);
  });

  it("did not at the old $0.04, and still stops a third planning call", async () => {
    await expect(largestRealPlan("0.04")).rejects.toEqual(new CapReached("plan"));
    const guard = new SpendGuard(new MemoryStore(), limits({}, at("2026-10-12T00:00:00Z")));
    await guard.settle(await guard.reserve(0.0408), 0.0408);
    await expect(guard.reserve(0.02)).rejects.toEqual(new CapReached("plan"));
  });

  it("means one address can cost at most $0.60 a day, under the $1.50 daily cap", () => {
    const lim = limits({}, at("2026-10-12T00:00:00Z"));
    expect(lim.ipPerDay * lim.planUsd).toBeCloseTo(0.6);
    expect(lim.ipPerDay * lim.planUsd).toBeLessThan(lim.dailyUsd);
  });
});

// The schedule approved on 2026-10-06, checked at each boundary from the rules' judging periods (UTC).
describe("budget schedule", () => {
  it.each([
    ["2026-10-12T00:00:00Z", 8, 1.5, true],
    ["2026-11-02T16:59:59Z", 8, 1.5, true],
    ["2026-11-02T17:00:00Z", 15, 3, true], // Qloo judging opens: 12:00 pm Eastern on 2 November
    ["2026-11-17T04:44:59Z", 15, 3, true],
    ["2026-11-17T04:45:00Z", 15, 1.5, true], // Qloo judging ends: 11:45 pm Eastern on 16 November
    ["2026-12-01T17:00:00Z", 25, 3, true], // Nebius judging opens: 9:00 am Pacific on 1 December
    ["2026-12-15T19:59:59Z", 25, 3, true],
    ["2026-12-15T20:00:00Z", 25, 3, false], // Nebius judging ends: 12:00 pm Pacific on 15 December
  ])("at %s: total $%d, daily $%d, live %s", (iso, total, daily, live) => {
    const step = budgetAt(at(iso));
    expect([step.totalUsd, step.dailyUsd, step.live]).toEqual([total, daily, live]);
    expect(limits({}, at(iso))).toMatchObject({ totalUsd: total, dailyUsd: daily });
  });

  it("lets TOTAL_CAP_USD and DAILY_CAP_USD override the schedule", () => {
    expect(limits({ TOTAL_CAP_USD: "30", DAILY_CAP_USD: "5" }, at("2026-10-20T00:00:00Z"))).toMatchObject({ totalUsd: 30, dailyUsd: 5 });
  });

  it("switches live planning off after judging, even with LIVE_PLANNING=on", () => {
    expect(livePlanningOn({ LIVE_PLANNING: "on" }, at("2026-12-15T19:59:59Z"))).toBe(true);
    expect(livePlanningOn({ LIVE_PLANNING: "on" }, at("2026-12-15T20:00:00Z"))).toBe(false);
    expect(livePlanningOn({ LIVE_PLANNING: "on" }, at("2027-01-11T20:00:00Z"))).toBe(false);
    expect(judgingOver(at("2026-12-15T20:00:00Z"))).toBe(true);
    expect(livePlanningOn({}, at("2026-10-20T00:00:00Z"))).toBe(false);
  });

  it("tells visitors when a spent tranche reopens", () => {
    expect(nextBudgetRaise(at("2026-10-20T00:00:00Z"))?.toISOString()).toBe("2026-11-02T17:00:00.000Z");
    expect(nextBudgetRaise(at("2026-11-20T00:00:00Z"))?.toISOString()).toBe("2026-12-01T17:00:00.000Z");
    expect(nextBudgetRaise(at("2026-12-05T00:00:00Z"))).toBeNull();
    expect(pausedMessage("total", at("2026-11-20T00:00:00Z"))).toBe("Live planning is paused until 1 December, 17:00 UTC, when its next budget opens.");
    expect(pausedMessage("total", at("2026-12-05T00:00:00Z"))).toBe("Live planning is paused while its budget is topped up.");
  });
});
