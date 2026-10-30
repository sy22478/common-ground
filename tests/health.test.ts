import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { limits } from "@/lib/config";
import { HEALTH_CACHE_SECONDS, healthReader } from "@/lib/health";
import { SpendGuard } from "@/lib/spend";
import { MemoryStore } from "@/lib/store";

const get = async () => {
  const { GET } = await import("@/app/api/health/route");
  return GET();
};
const health = async () => (await get()).json();

describe("GET /api/health", () => {
  beforeEach(() => {
    vi.resetModules();
    for (const name of ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_URL", "KV_REST_API_TOKEN"]) vi.stubEnv(name, "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("checks the counters even while live planning is off", async () => {
    vi.stubEnv("LIVE_PLANNING", "");
    expect(await health()).toMatchObject({ livePlanning: false, planningOpen: false, pausedFor: "off", counters: "memory" });
  });

  it("reports missing shared counters in production, and planning closed", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LIVE_PLANNING", "on");
    for (const name of ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_URL", "KV_REST_API_TOKEN"]) vi.stubEnv(name, "");
    expect(await health()).toMatchObject({ livePlanning: true, planningOpen: false, pausedFor: "no_counters", counters: "unavailable" });
  });

  it("says which cap paused planning", async () => {
    vi.stubEnv("LIVE_PLANNING", "on");
    vi.stubEnv("TOTAL_CAP_USD", "0.01");
    expect(await health()).toMatchObject({ planningOpen: false, pausedFor: "total" });
  });

  it("answers a second request from the same reading, and lets a cache keep it for the rest of the minute", async () => {
    const first = await get();
    const second = await get();
    expect(first.headers.get("Cache-Control")).toBe(`public, max-age=0, s-maxage=${HEALTH_CACHE_SECONDS}`);
    const body = await first.json();
    expect(Date.now() - Date.parse(body.checkedAt)).toBeLessThan(5_000);
    expect((await second.json()).checkedAt).toBe(body.checkedAt);
  });
});

// A flood of requests must not become a flood of reads on the shared database: its free quota is counted in
// commands, and planning refuses without its counters.
describe("the reading behind /api/health", () => {
  class CountingStore extends MemoryStore {
    reads = 0;
    down = false;
    override async getNumber(key: string): Promise<number> {
      this.reads += 1;
      if (this.down) throw new Error("the database is not answering");
      return super.getNumber(key);
    }
  }
  const ON = { LIVE_PLANNING: "on", DAILY_CAP_USD: "0.10" };
  const T0 = Date.parse("2026-10-27T15:00:00Z");
  const at = (seconds: number) => new Date(T0 + seconds * 1000);
  const READS_PER_READING = 2; // today's spend and the total

  it("reads the counters once for all the requests of a minute, and again after it", async () => {
    const store = new CountingStore();
    const health = healthReader();
    for (const seconds of [0, 1, 20, 59]) expect((await health(store, ON, at(seconds))).body.checkedAt).toBe(at(0).toISOString());
    expect(store.reads).toBe(READS_PER_READING);
    expect((await health(store, ON, at(60))).body.checkedAt).toBe(at(60).toISOString());
    expect(store.reads).toBe(2 * READS_PER_READING);
  });

  it("makes one read for requests that arrive together", async () => {
    const store = new CountingStore();
    const health = healthReader();
    await health(store, ON, at(0));
    const answers = await Promise.all(Array.from({ length: 20 }, () => health(store, ON, at(61))));
    expect(new Set(answers.map((a) => a.body.checkedAt))).toEqual(new Set([at(61).toISOString()]));
    expect(store.reads).toBe(2 * READS_PER_READING);
  });

  it("lets a cache keep an answer only for what is left of the minute, so no answer is older than that", async () => {
    const health = healthReader();
    const store = new CountingStore();
    expect((await health(store, ON, at(0))).cacheControl).toBe("public, max-age=0, s-maxage=60");
    expect((await health(store, ON, at(45))).cacheControl).toBe("public, max-age=0, s-maxage=15");
    expect((await health(store, ON, at(59.5))).cacheControl).toBe("public, max-age=0, s-maxage=1");
  });

  // The price of the cache, on purpose: the page may show the plan button for up to a minute after a cap is
  // reached. The plan route reads the counters itself and refuses with the reason.
  it("shows a cap that was just reached within the minute", async () => {
    const store = new CountingStore();
    const health = healthReader();
    expect((await health(store, ON, at(0))).body).toMatchObject({ planningOpen: true, pausedFor: null, counters: "memory" });
    await new SpendGuard(store, limits(ON, at(10)), () => at(10)).reserve(0.05); // a plan no longer fits under $0.10
    expect((await health(store, ON, at(30))).body.planningOpen).toBe(true);
    expect((await health(store, ON, at(60))).body).toMatchObject({ planningOpen: false, pausedFor: "daily" });
  });

  // The gate is run on one build and that build is promoted (DEPLOY.md). This is how a check knows which build
  // it is talking to.
  it("names the commit the build was made from, and null where there is none", async () => {
    const store = new CountingStore();
    const commit = "0123456789abcdef0123456789abcdef01234567";
    expect((await healthReader()(store, { ...ON, VERCEL_GIT_COMMIT_SHA: commit }, at(0))).body.build).toBe(commit);
    expect((await healthReader()(store, ON, at(0))).body.build).toBeNull();
  });

  it("asks again five seconds after a read that failed, and lets no cache keep the failure", async () => {
    const store = new CountingStore();
    const health = healthReader();
    store.down = true;
    const failed = await health(store, ON, at(0));
    expect(failed.body).toMatchObject({ planningOpen: false, pausedFor: "no_counters", counters: "unavailable" });
    expect(failed.cacheControl).toBe("no-store");
    store.down = false;
    expect((await health(store, ON, at(4))).body.counters).toBe("unavailable");
    expect((await health(store, ON, at(5))).body).toMatchObject({ planningOpen: true, counters: "memory", checkedAt: at(5).toISOString() });
  });
});
