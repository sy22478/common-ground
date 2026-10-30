import type { Limits } from "./config";
import { keyedHasher } from "./hash";
import type { Store } from "./store";

export type RateResult = { ok: true } | { ok: false; window: "hour" | "day"; retryAfterSeconds: number };

// IP addresses are personal data: only a keyed hash is stored, and only for a day.
export function hashIp(ip: string, secret: string): string {
  return keyedHasher(secret)(`ip:${ip}`);
}

export async function checkRate(store: Store, ipHash: string, limits: Limits, now = new Date()): Promise<RateResult> {
  const iso = now.toISOString();
  const hour = await store.incrByFloat(`rl:h:${ipHash}:${iso.slice(0, 13)}`, 1, 3600);
  const day = await store.incrByFloat(`rl:d:${ipHash}:${iso.slice(0, 10)}`, 1, 86400);
  if (day > limits.ipPerDay) {
    const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    return { ok: false, window: "day", retryAfterSeconds: Math.ceil((midnight - now.getTime()) / 1000) };
  }
  if (hour > limits.ipPerHour) {
    const nextHour = Math.floor(now.getTime() / 3_600_000 + 1) * 3_600_000;
    return { ok: false, window: "hour", retryAfterSeconds: Math.ceil((nextHour - now.getTime()) / 1000) };
  }
  return { ok: true };
}
