// Models, prices and limits. Limits can be lowered through environment variables (for tests and the live cap demo).

export const TOKEN_FACTORY_BASE = "https://api.tokenfactory.nebius.com/v1";
export const QLOO_BASE = "https://hackathon.api.qloo.com";
export const TAVILY_BASE = "https://api.tavily.com";

export const MODELS = {
  nano: "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B",
  super: "nvidia/nemotron-3-super-120b-a12b",
  ultra: "nvidia/Nemotron-3-Ultra-550b-a55b",
} as const;
export type ModelKey = keyof typeof MODELS;

// USD per million tokens, from the Token Factory public catalogue (read 2026-10-04).
export const PRICES: Record<ModelKey, { input: number; output: number }> = {
  nano: { input: 0.06, output: 0.24 },
  super: { input: 0.3, output: 0.9 },
  ultra: { input: 1.0, output: 3.0 },
};

export interface Limits {
  planUsd: number;
  dailyUsd: number;
  totalUsd: number;
  ipPerHour: number;
  ipPerDay: number;
  tavilyPerPlan: number;
  tavilyPerDay: number;
  qlooPerDay: number;
}

type Env = Record<string, string | undefined>;

function num(env: Env, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number`);
  return n;
}

// The budget schedule approved by Sonu on 2026-10-06 (STACK_AND_GATE.md, "Reserve"). The total cap is cumulative and
// rises when each judging window opens, so each window has money held for it; the daily cap is higher while judges are
// testing. Dates are the rules' judging periods in UTC (RULES_NOTES.md). After Nebius judging ends, live planning is
// off and stays off: LIVE_PLANNING cannot turn it back on, only a code change can.
export interface BudgetStep {
  from: string;
  totalUsd: number;
  dailyUsd: number;
  live: boolean;
  label: string;
}

export const BUDGET_SCHEDULE: readonly BudgetStep[] = [
  { from: "2026-10-01T00:00:00Z", totalUsd: 8, dailyUsd: 1.5, live: true, label: "launch" },
  { from: "2026-11-02T17:00:00Z", totalUsd: 15, dailyUsd: 3, live: true, label: "Qloo judging opens" },
  { from: "2026-11-17T04:45:00Z", totalUsd: 15, dailyUsd: 1.5, live: true, label: "Qloo judging ends" },
  { from: "2026-12-01T17:00:00Z", totalUsd: 25, dailyUsd: 3, live: true, label: "Nebius judging opens" },
  { from: "2026-12-15T20:00:00Z", totalUsd: 25, dailyUsd: 3, live: false, label: "Nebius judging ends" },
];

export function budgetAt(now: Date): BudgetStep {
  let current = BUDGET_SCHEDULE[0]!;
  for (const step of BUDGET_SCHEDULE) if (Date.parse(step.from) <= now.getTime()) current = step;
  return current;
}

// When the total cap next rises, if it does: used to tell visitors when a spent tranche reopens.
export function nextBudgetRaise(now: Date): Date | null {
  const total = budgetAt(now).totalUsd;
  const next = BUDGET_SCHEDULE.find((s) => Date.parse(s.from) > now.getTime() && s.totalUsd > total && s.live);
  return next ? new Date(next.from) : null;
}

// Defaults approved by Sonu on 2026-10-05 (STACK_AND_GATE.md); plan cap and plans per address a day lowered by
// Sonu later on 2026-10-05 (bus 001, point 4). TOTAL_CAP_USD and DAILY_CAP_USD, when set, override the schedule.
// The plan cap went back to $0.06 on 2026-10-11 (Sonu, bus 003): plans on real Qloo data cost $0.021 to $0.031, and
// under $0.04 there was no room to send a draft back to the planner once.
export function limits(env: Env = process.env, now: Date = new Date()): Limits {
  const budget = budgetAt(now);
  return {
    planUsd: num(env, "PLAN_CAP_USD", 0.06),
    dailyUsd: num(env, "DAILY_CAP_USD", budget.dailyUsd),
    totalUsd: num(env, "TOTAL_CAP_USD", budget.totalUsd),
    ipPerHour: num(env, "IP_PLANS_PER_HOUR", 6),
    ipPerDay: num(env, "IP_PLANS_PER_DAY", 10),
    tavilyPerPlan: num(env, "TAVILY_PER_PLAN", 2),
    tavilyPerDay: num(env, "TAVILY_PER_DAY", 30),
    // The key allows 10,000 calls a month (X-Month-RateLimit-Limit, first call 2026-10-11): 300 a day keeps a full
    // month under 9,000 and leaves the rest for development. Was 3,000 while the quota was unknown.
    qlooPerDay: num(env, "QLOO_CALLS_PER_DAY", 300),
  };
}

// Live planning stays off until it is switched on deliberately, and off for good once judging has ended. Off means no
// model call can be made from the web.
export function livePlanningOn(env: Env = process.env, now: Date = new Date()): boolean {
  return env.LIVE_PLANNING === "on" && budgetAt(now).live;
}

export function judgingOver(now: Date = new Date()): boolean {
  return !budgetAt(now).live;
}
