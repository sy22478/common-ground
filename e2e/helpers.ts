import { test as base, expect, type Page } from "@playwright/test";
import type { AgentEvent } from "../lib/agent";
import type { FinalPlan } from "../lib/plan";

export type ToolEvent = Extract<AgentEvent, { type: "tool" }>;

// The token that opens a protected preview goes to that preview and nowhere else. (A header set for the whole
// browser would also ride on the request Vercel's own preview toolbar makes to vercel.live.)
export const test = base.extend({
  context: async ({ context, baseURL }, provide) => {
    const token = process.env.VERCEL_OIDC_TOKEN;
    if (token && baseURL) {
      const origin = new URL(baseURL).origin;
      await context.route(
        (url) => url.origin === origin,
        (route) => route.continue({ headers: { ...route.request().headers(), "x-vercel-trusted-oidc-idp-token": token } }),
      );
    }
    await provide(context);
  },
});

export interface Watch {
  consoleErrors: string[];
  otherOrigins: string[];
}

// Console errors, and any request that leaves the page's own server. The app makes none. On a preview, Vercel itself
// adds its toolbar script from vercel.live; production does not have it (checked on the public URL, 2026-10-11).
const VERCEL_PREVIEW_TOOLBAR = "https://vercel.live";

export function watch(page: Page, baseURL: string): Watch {
  const seen: Watch = { consoleErrors: [], otherOrigins: [] };
  const origin = new URL(baseURL).origin;
  page.on("console", (m) => {
    // A refused plan request is an expected answer here (429, 503); the browser logs it as a failed resource.
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) seen.consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => seen.consoleErrors.push(String(e)));
  page.on("request", (r) => {
    const to = new URL(r.url()).origin;
    if (to !== origin && to !== VERCEL_PREVIEW_TOOLBAR) seen.otherOrigins.push(r.url());
  });
  return seen;
}

export interface PlanRun {
  status: number;
  events: AgentEvent[];
  plan: FinalPlan | null;
  costUsd: number;
  requestBody: unknown;
  firstStepMs: number | null;
  bridgeMs: number | null;
  doneMs: number;
}

// Clicks, then follows one POST /api/plan to its end, timing what a visitor sees.
export async function planWith(page: Page, click: () => Promise<void>): Promise<PlanRun> {
  const responding = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/plan" && r.request().method() === "POST", { timeout: 60_000 });
  const started = Date.now();
  const since = () => Date.now() - started;
  await click();
  // Only what this run brings counts: the saved plan shown on arrival has steps and a bridge card of its own.
  const firstStep = page.locator("main[data-shown=live] ul.steps li").first().waitFor({ state: "attached", timeout: 30_000 }).then(since, () => null);
  const bridge = page.locator("main[data-shown=live] .card.bridge").waitFor({ timeout: 300_000 }).then(since, () => null);
  const response = await responding;
  const text = await response.text(); // resolves when the stream ends
  const doneMs = since();
  const events = text.split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)) as AgentEvent);
  const plan = events.find((e): e is Extract<AgentEvent, { type: "plan" }> => e.type === "plan")?.plan ?? null;
  const done = events.find((e): e is Extract<AgentEvent, { type: "done" }> => e.type === "done");
  let requestBody: unknown = null;
  try {
    requestBody = response.request().postDataJSON();
  } catch {
    // not JSON: left as null
  }
  return {
    status: response.status(),
    events,
    plan,
    costUsd: done?.costUsd ?? 0,
    requestBody,
    firstStepMs: response.status() === 200 ? await firstStep : null,
    bridgeMs: plan ? await bridge : null,
    doneMs,
  };
}

export const planButton = (page: Page) => page.getByRole("button", { name: /^Plan a visit for / });

// Opens "How this plan was made", where the steps, who did them, and what each card rests on are folded.
export async function openHow(page: Page) {
  const how = page.locator("details.how");
  if (!(await how.evaluate((el) => (el as HTMLDetailsElement).open))) await how.locator("summary").click();
}

// Never a blank screen: the heading and the sample family are still there.
export async function expectPageStillThere(page: Page) {
  await expect(page.getByRole("heading", { level: 1, name: "Common Ground" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Try a sample family" })).toBeVisible();
}

export function note(testInfo: { annotations: { type: string; description?: string }[] }, type: string, description: string) {
  testInfo.annotations.push({ type, description });
  console.log(`[${type}] ${description}`);
}
