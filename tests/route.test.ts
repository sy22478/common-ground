import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_FAMILY } from "@/lib/family";

// The route must refuse before any model call in each of these cases. A fetch spy proves no request leaves.
const post = async (body: unknown, ip: string) => {
  const { POST } = await import("@/app/api/plan/route");
  return POST(new Request("http://localhost/api/plan", { method: "POST", body: JSON.stringify(body), headers: { "x-forwarded-for": ip } }));
};

describe("POST /api/plan guards", () => {
  const fetchSpy = vi.fn(async () => new Response("no network in tests", { status: 599 }));

  beforeEach(() => {
    vi.resetModules(); // fresh in-memory store per test
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubEnv("NEBIUS_API_KEY", "");
    vi.stubEnv("QLOO_API_KEY", "");
    vi.stubEnv("TAVILY_API_KEY", "");
    for (const name of ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_URL", "KV_REST_API_TOKEN"]) vi.stubEnv(name, "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    fetchSpy.mockClear();
  });

  it("is off unless LIVE_PLANNING=on", async () => {
    vi.stubEnv("LIVE_PLANNING", "");
    const res = await post(SAMPLE_FAMILY, "198.51.100.1");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "paused", message: "Live planning is switched off right now." });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects malformed input", async () => {
    vi.stubEnv("LIVE_PLANNING", "on");
    const res = await post({ grandparent: { birthYear: 1800 } }, "198.51.100.2");
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses a note with contact details in plain words, before the rate limit and before any call", async () => {
    vi.stubEnv("LIVE_PLANNING", "on");
    vi.stubEnv("IP_PLANS_PER_HOUR", "1");
    const withNote = { ...SAMPLE_FAMILY, history: [{ landed: [{ title: "A Singer", kind: "artist" }], rest: [], note: "the music was a hit, call her on 210 555 0142" }] };
    const res = await post(withNote, "198.51.100.8");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid", message: "Only how the visit went, please: no phone numbers, email addresses or links. This note is sent to the planner." });
    // The refused request did not use up the address's one plan this hour.
    expect((await post(SAMPLE_FAMILY, "198.51.100.8")).status).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("answers a body that is not JSON with the general line", async () => {
    vi.stubEnv("LIVE_PLANNING", "on");
    const { POST } = await import("@/app/api/plan/route");
    const res = await POST(new Request("http://localhost/api/plan", { method: "POST", body: "not json", headers: { "x-forwarded-for": "198.51.100.9" } }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid", message: "Please check the favorites and the birth year, then try again." });
  });

  it("rate-limits by address before planning", async () => {
    vi.stubEnv("LIVE_PLANNING", "on");
    vi.stubEnv("IP_PLANS_PER_HOUR", "1");
    const first = await post(SAMPLE_FAMILY, "198.51.100.3");
    expect(first.status).toBe(503); // got past the limiter; no model key in tests
    const second = await post(SAMPLE_FAMILY, "198.51.100.3");
    expect(second.status).toBe(429);
    expect(Number(second.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect((await post(SAMPLE_FAMILY, "198.51.100.4")).status).toBe(503); // a different address is not affected
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("pauses planning when the daily cap cannot fit another plan", async () => {
    vi.stubEnv("LIVE_PLANNING", "on");
    vi.stubEnv("NEBIUS_API_KEY", "would-be-used-if-the-cap-failed");
    vi.stubEnv("DAILY_CAP_USD", "0.01"); // below the $0.06 plan cap: no plan can fit
    const res = await post(SAMPLE_FAMILY, "198.51.100.5");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "cap", message: "Live planning is paused for today to keep costs in check. It starts again at midnight UTC." });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("says when a spent total budget reopens", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-20T12:00:00Z"));
    vi.stubEnv("LIVE_PLANNING", "on");
    vi.stubEnv("TOTAL_CAP_USD", "0.01");
    const res = await post(SAMPLE_FAMILY, "198.51.100.6");
    expect(await res.json()).toEqual({ error: "cap", message: "Live planning is paused until 2 November, 17:00 UTC, when its next budget opens." });
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("is off for good after Nebius judging ends, whatever LIVE_PLANNING says", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-12-15T20:00:00Z"));
    vi.stubEnv("LIVE_PLANNING", "on");
    const res = await post(SAMPLE_FAMILY, "198.51.100.7");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "ended", message: "Live planning ended when hackathon judging closed on 15 December 2026." });
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
