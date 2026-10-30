import { judgingOver, limits as readLimits, livePlanningOn } from "./config";
import { spendStatus } from "./spend";
import type { Store } from "./store";

type Env = Record<string, string | undefined>;

export interface Health {
  livePlanning: boolean;
  planningOpen: boolean;
  pausedFor: "ended" | "off" | "daily" | "total" | "no_counters" | null;
  counters: "redis" | "memory" | "unavailable";
  checkedAt: string; // when the counters were read: the answer is as old as this
  build: string | null; // the commit this build was made from, so a check can tell which build it is talking to
}

// Vercel tells a build the commit of the folder it was deployed from, also for a deploy from the CLI (seen on a
// preview, 2026-10-13). It names the commit even when the folder held changes not yet committed, so the gate looks
// at the folder too (tests/candidate.live.test.ts). Null on this machine. The repository is public for the
// judging, so the commit is no secret.
export function buildCommit(env: Env = process.env): string | null {
  return env.VERCEL_GIT_COMMIT_SHA || null;
}

// How long one reading of the counters answers for. Until 2026-10-13 every request to /api/health read Redis twice,
// so a flood of requests could use up the database's free quota, and planning, which refuses without its counters,
// would stop for everyone. Now one running instance reads them at most once in this time, however many requests
// come and whatever address they ask for, and Vercel's CDN is told to keep an answer only for what is left of that
// time. So an answer is never older than this. The price: for up to a minute after a cap is reached the page may
// still show the plan button. The plan route reads the counters itself on every request, and says why it refuses.
export const HEALTH_CACHE_SECONDS = 60;
// A reading that failed is asked again sooner, and no cache on the way keeps it: one slip of the database must not
// have the page say "paused" for a minute.
const FAILED_READING_SECONDS = 5;

interface Reading {
  at: number;
  counters: Health["counters"];
  cap: "daily" | "total" | null;
}

const life = (r: Reading) => (r.counters === "unavailable" ? FAILED_READING_SECONDS : HEALTH_CACHE_SECONDS) * 1000;

async function read(store: Store | null, env: Env, now: Date): Promise<Reading> {
  const at = now.getTime();
  if (!store) return { at, counters: "unavailable", cap: null };
  try {
    const status = await spendStatus(store, readLimits(env, now), now);
    return { at, counters: store.kind, cap: status.pausedFor };
  } catch {
    return { at, counters: "unavailable", cap: null };
  }
}

// Public and read-only: whether planning is available and why not. No spend figures, no keys.
// "counters" proves the shared counter store is reachable even while live planning is off: "redis" on Vercel with
// Upstash, "memory" in local development, "unavailable" when production has no Redis (planning then refuses).
// Each reader keeps its own last reading; the route has one, which lives as long as its instance.
export function healthReader() {
  let kept: Promise<Reading> | undefined;
  async function current(store: Store | null, env: Env, now: Date): Promise<Reading> {
    const mine = kept;
    const last = mine && (await mine);
    if (last && now.getTime() - last.at < life(last)) return last;
    // Requests that arrive together wait for one read: only the first to find the reading old starts a new one.
    if (kept === mine) kept = read(store, env, now);
    return kept!;
  }
  return async function health(store: Store | null, env: Env = process.env, now: Date = new Date()): Promise<{ body: Health; cacheControl: string }> {
    const reading = await current(store, env, now);
    const live = livePlanningOn(env, now);
    let pausedFor: Health["pausedFor"] = judgingOver(now) ? "ended" : live ? null : "off";
    if (live && reading.cap) pausedFor = reading.cap;
    if (live && reading.counters === "unavailable") pausedFor = "no_counters";
    const left = Math.max(1, Math.ceil((reading.at + life(reading) - now.getTime()) / 1000));
    return {
      body: { livePlanning: live, planningOpen: pausedFor === null, pausedFor, counters: reading.counters, checkedAt: new Date(reading.at).toISOString(), build: buildCommit(env) },
      cacheControl: reading.counters === "unavailable" ? "no-store" : `public, max-age=0, s-maxage=${left}`,
    };
  };
}
