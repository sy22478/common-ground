import type { AgentDeps } from "./agent";
import { limits as readLimits, type Limits } from "./config";
import { keyedHasher } from "./hash";
import { TokenFactoryLLM } from "./llm";
import { QlooAllowanceUsed, QlooClient, QlooError, type QlooApi } from "./qloo";
import { SpendGuard } from "./spend";
import type { Store } from "./store";
import { TavilyClient, TavilyError, type TavilyApi } from "./tavily";

type Env = Record<string, string | undefined>;

// For the scripted run's failure paths (STACK_AND_GATE.md): FORCE_ERRORS=qloo, tavily or both makes that service
// fail on every call, without calling it; FORCE_ERRORS=allowance refuses every Qloo call as this site's own daily
// allowance does. It is set by an environment variable on a preview build, never by a route,
// and production ignores it.
export function forcedErrors(env: Env = process.env): Set<string> {
  if (env.VERCEL_ENV === "production") return new Set();
  return new Set((env.FORCE_ERRORS ?? "").split(",").map((s) => s.trim()).filter(Boolean));
}

const qlooDown = async (): Promise<never> => {
  throw new QlooError(503, "Qloo 503: forced by FORCE_ERRORS");
};
const brokenQloo: QlooApi = { search: qlooDown, insights: qlooDown, compare: qlooDown, tags: qlooDown, affinity: qlooDown, famous: qlooDown };
const allowanceUsed = async (): Promise<never> => {
  throw new QlooAllowanceUsed();
};
const spentQloo: QlooApi = { search: allowanceUsed, insights: allowanceUsed, compare: allowanceUsed, tags: allowanceUsed, affinity: allowanceUsed, famous: allowanceUsed };
const brokenTavily: TavilyApi = {
  search: async () => {
    throw new TavilyError(503, "Tavily 503: forced by FORCE_ERRORS");
  },
};

// Builds the real dependencies for one plan. Keys are read here, on the server, and nowhere else.
export function makeDeps(store: Store, env: Env = process.env, lim: Limits = readLimits(env)): AgentDeps | null {
  const nebius = env.NEBIUS_API_KEY;
  const secret = hashSecret(env);
  if (!nebius || !secret) return null;
  const guard = new SpendGuard(store, lim);
  const keyFor = keyedHasher(secret);
  const forced = forcedErrors(env);
  return {
    llm: new TokenFactoryLLM(nebius, guard),
    qloo: forced.has("qloo") ? brokenQloo : forced.has("allowance") ? spentQloo : env.QLOO_API_KEY ? new QlooClient(env.QLOO_API_KEY, store, lim.qlooPerDay, keyFor) : null,
    tavily: forced.has("tavily") ? brokenTavily : env.TAVILY_API_KEY ? new TavilyClient(env.TAVILY_API_KEY, store, lim.tavilyPerDay, keyFor) : null,
    guard,
    limits: lim,
  };
}

// Keys the one-way hashes for rate limits and cache keys. Required in production; a fixed value in development.
export function hashSecret(env: Env = process.env): string | null {
  if (env.HASH_SECRET) return env.HASH_SECRET;
  return env.NODE_ENV === "production" ? null : "development-only-hash-secret";
}

// On Vercel these headers are set by the platform, which overwrites any client-supplied X-Forwarded-For "to prevent
// IP spoofing" (vercel.com/docs/headers/request-headers). Locally they are whatever the client sends.
export function clientIp(request: Request): string {
  const h = request.headers;
  return (h.get("x-vercel-forwarded-for") ?? h.get("x-forwarded-for"))?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}
