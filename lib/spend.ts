import { nextBudgetRaise, type Limits } from "./config";
import type { Store } from "./store";

export type CapKind = "plan" | "daily" | "total";

export class CapReached extends Error {
  constructor(public kind: CapKind) {
    super(`spend cap reached: ${kind}`);
    this.name = "CapReached";
  }
}

export interface Reservation {
  usd: number;
  dayKey: string;
}

// The prefix is empty in the app; live tests use their own prefix so they never touch the real counters.
const totalKey = (prefix: string) => `${prefix}spend:total`;
const dayKey = (now: Date, prefix = "") => `${prefix}spend:day:${now.toISOString().slice(0, 10)}`;

// Every model call reserves its worst-case cost before it is sent and settles to the real cost after. Reserving
// first means concurrent plans cannot overshoot a cap together.
export class SpendGuard {
  private planUsd = 0;

  constructor(
    private store: Store,
    private limits: Limits,
    private now: () => Date = () => new Date(),
    private prefix = "",
  ) {}

  get planSpent(): number {
    return this.planUsd;
  }

  async reserve(usd: number): Promise<Reservation> {
    if (this.planUsd + usd > this.limits.planUsd) throw new CapReached("plan");
    const key = dayKey(this.now(), this.prefix);
    const day = await this.store.incrByFloat(key, usd, 3 * 86400);
    const total = await this.store.incrByFloat(totalKey(this.prefix), usd);
    if (day > this.limits.dailyUsd || total > this.limits.totalUsd) {
      await this.store.incrByFloat(key, -usd);
      await this.store.incrByFloat(totalKey(this.prefix), -usd);
      throw new CapReached(total > this.limits.totalUsd ? "total" : "daily");
    }
    this.planUsd += usd;
    return { usd, dayKey: key };
  }

  async settle(reservation: Reservation, actualUsd: number): Promise<void> {
    const delta = actualUsd - reservation.usd;
    if (delta !== 0) {
      await this.store.incrByFloat(reservation.dayKey, delta);
      await this.store.incrByFloat(totalKey(this.prefix), delta);
    }
    this.planUsd += delta;
  }
}

export interface SpendStatus {
  dayUsd: number;
  totalUsd: number;
  open: boolean;
  pausedFor: "daily" | "total" | null;
}

// Planning is open while a full plan still fits under both caps. The total cap is reported first: it does not
// reset at midnight.
export async function spendStatus(store: Store, limits: Limits, now = new Date(), prefix = ""): Promise<SpendStatus> {
  const dayUsd = await store.getNumber(dayKey(now, prefix));
  const totalUsd = await store.getNumber(totalKey(prefix));
  const pausedFor =
    totalUsd + limits.planUsd > limits.totalUsd ? "total" : dayUsd + limits.planUsd > limits.dailyUsd ? "daily" : null;
  return { dayUsd, totalUsd, open: pausedFor === null, pausedFor };
}

const fmtUtc = (d: Date) =>
  `${d.toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" })}, ${d.toISOString().slice(11, 16)} UTC`;

export function pausedMessage(kind: "daily" | "total", now: Date = new Date()): string {
  if (kind === "daily") return "Live planning is paused for today to keep costs in check. It starts again at midnight UTC.";
  const reopens = nextBudgetRaise(now);
  return reopens
    ? `Live planning is paused until ${fmtUtc(reopens)}, when its next budget opens.`
    : "Live planning is paused while its budget is topped up.";
}

export const JUDGING_OVER_MESSAGE = "Live planning ended when hackathon judging closed on 15 December 2026.";
