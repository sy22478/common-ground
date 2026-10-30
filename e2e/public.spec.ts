import { existsSync, readFileSync } from "node:fs";
import { expect, test as plain, type APIRequestContext } from "@playwright/test";
import { SAMPLE_FAMILY } from "../lib/family";
import { HEALTH_CACHE_SECONDS, type Health } from "../lib/health";
import { isShowableSavedPlan, savedPlanProblems } from "../lib/saved";
import { SOURCES } from "../lib/sources";
import { expectPageStillThere, note, planButton, test as withToken, watch } from "./helpers";

// The public page as a visitor finds it, with live planning on or off. It makes no plan and changes no record, so it
// costs nothing and can run against production:
//
//   DEMO_URL=https://common-ground-beryl.vercel.app PLANNING=off npm run demo:e2e:public
//
// PLANNING=on or PLANNING=off holds the page to that. Without it the check follows what the server says and notes
// that it did: good for a look, not for a gate. BUILD=<commit> holds it to a build of that commit, by the commit
// the build itself names (lib/health.ts): BUILD=$(git rev-parse HEAD) asks for the commit in this folder.
//
// Against a test preview, which is behind Vercel's login:
//
//   vercel env run -- sh -c 'DEMO_URL=https://<preview> PREVIEW=1 PLANNING=on npm run demo:e2e:public'
//
// Only with PREVIEW=1 is the token that opens a preview read at all, and then it goes to that preview's own origin.
// It is never sent to a public address: PREVIEW=1 is refused, before any test starts, for every address but a
// deployment's own, which Vercel keeps behind its login.
const WANT = process.env.PLANNING;
const BUILD = process.env.BUILD;
const PREVIEW = process.env.PREVIEW === "1";
const OWN_ADDRESS = /^common-ground-[a-z0-9]{9}-sy22478\.vercel\.app$/;
if (PREVIEW && !OWN_ADDRESS.test(new URL(process.env.DEMO_URL ?? "http://not-set").hostname)) {
  throw new Error("PREVIEW=1 is for a test preview at its own address (common-ground-<nine characters>-sy22478.vercel.app). No token is sent anywhere else.");
}
if (PREVIEW && !process.env.VERCEL_OIDC_TOKEN) {
  throw new Error("PREVIEW=1 needs the short-lived token: run under `vercel env run`, after `vercel env pull .env.local --yes`.");
}
const test = PREVIEW ? withToken : plain;
const SAVED = "public/saved-plan.json";

// What a request made outside the browser needs to open a preview. It follows no redirect, so the token cannot
// travel on to Vercel's login page.
function opening(): { headers?: Record<string, string>; maxRedirects?: number } {
  return PREVIEW ? { headers: { "x-vercel-trusted-oidc-idp-token": process.env.VERCEL_OIDC_TOKEN! }, maxRedirects: 0 } : {};
}

// A new address each time, so no cache on the way answers for the server.
async function healthOf(request: APIRequestContext) {
  const response = await request.get(`/api/health?t=${Date.now()}-${Math.random().toString(36).slice(2)}`, opening());
  // Vercel's firewall answers a machine it has come to distrust with a checkpoint page: nothing can be checked then.
  expect(response.headers()["x-vercel-mitigated"], "Vercel's firewall is not challenging this machine (if it is, wait some minutes and run again)").toBeUndefined();
  expect(response.status(), "the health route answers").toBe(200);
  return { response, health: (await response.json()) as Health };
}

test.beforeAll(() => {
  expect(["on", "off", undefined], "PLANNING is on, off or not set").toContain(WANT);
});

test("the server says whether planning is on, and the plan route agrees", async ({ request }, testInfo) => {
  const { response, health } = await healthOf(request);
  if (!WANT) note(testInfo, "planning", `not held to on or off: the server says livePlanning ${health.livePlanning}, planningOpen ${health.planningOpen}`);
  const on = WANT ? WANT === "on" : health.livePlanning;
  // Which build is this? A build made before 2026-10-13 does not say.
  if (BUILD) expect(health.build ?? "(the build does not say)", "the page is built from the commit asked for").toBe(BUILD);
  else note(testInfo, "build", `not held to a commit: the build says ${health.build ?? "nothing about its commit"}`);

  if (on) {
    // On and open: no cap has paused it. (A cap reached shows here as pausedFor "daily" or "total", and fails.)
    expect(health).toMatchObject({ livePlanning: true, planningOpen: true, pausedFor: null, counters: "redis" });
    // The plan route is past its switch: it reads the request and refuses this one for what it says. A refused
    // request makes no call and is not counted against the address (tests/route.test.ts).
    const refused = await request.post("/api/plan", { data: { grandparent: { birthYear: 1800 } }, ...opening() });
    expect(refused.status()).toBe(400);
    expect(await refused.json()).toEqual({ error: "invalid", message: "Please check the favorites and the birth year, then try again." });
  } else {
    expect(health).toMatchObject({ livePlanning: false, planningOpen: false, pausedFor: "off", counters: "redis" });
    const plan = await request.post("/api/plan", { data: { grandparent: { birthYear: 1940, language: "Spanish", favorites: ["a song"] }, visitor: { favorites: ["a film"] } }, ...opening() });
    expect(plan.status()).toBe(503);
    expect(await plan.json()).toEqual({ error: "paused", message: "Live planning is switched off right now." });
  }

  // The cache on the health route (lib/health.ts). A build made before it, 2026-10-13, says no time and "no-store".
  if (!health.checkedAt) {
    note(testInfo, "cache", "this build is from before the health route kept a reading: it reads its counters on every request");
    expect(response.headers()["cache-control"]).toBe("no-store");
    return;
  }
  // No answer is older than the cache allows, by the server's own clock. (An answer kept by the CDN carries the
  // date it was made and its age since.)
  const age = (r: typeof response, h: Health) => (Date.parse(r.headers()["date"]!) - Date.parse(h.checkedAt)) / 1000 + Number(r.headers()["age"] ?? 0);
  expect(age(response, health), "the reading is no older than the cache allows").toBeLessThanOrEqual(HEALTH_CACHE_SECONDS + 1);
  expect(response.headers()["cache-control"], "a cache on the way may keep the answer, for a short time").toMatch(/^public, max-age=0(, s-maxage=\d+)?$/); // Vercel keeps s-maxage for itself
  // Four more requests, each to an address never asked for before: they do not make four more reads.
  const readings = new Set([health.checkedAt]);
  for (let i = 0; i < 4; i++) {
    const again = await healthOf(request);
    expect(age(again.response, again.health)).toBeLessThanOrEqual(HEALTH_CACHE_SECONDS + 1);
    readings.add(again.health.checkedAt);
  }
  note(testInfo, "cache", `5 requests to 5 new addresses were answered from ${readings.size} reading${readings.size === 1 ? "" : "s"} of the counters; header "${response.headers()["cache-control"]}", x-vercel-cache "${response.headers()["x-vercel-cache"] ?? "none"}"`);
  expect(readings.size, "new addresses do not each cause a read of the counters").toBeLessThan(5);
});

test("the saved plan is the one recorded on this machine", async ({ request }) => {
  test.skip(!existsSync(SAVED), "no saved plan in this folder to compare with");
  const served = await request.get(`/saved-plan.json?t=${Date.now()}`, opening());
  expect(served.status()).toBe(200);
  expect(await served.json()).toEqual(JSON.parse(readFileSync(SAVED, "utf8")));
});

// Read from the URL itself, not from this folder: what is served must pass today's wording rules. With planning on
// the recording is still what a visitor is offered when a cap pauses planning.
test("the saved plan that is served passes the wording rules", async ({ request }) => {
  const served = await request.get(`/saved-plan.json?t=${Date.now()}`, opening());
  expect(served.status()).toBe(200);
  const saved: unknown = await served.json();
  expect(isShowableSavedPlan(saved)).toBe(true);
  if (isShowableSavedPlan(saved)) expect(savedPlanProblems(saved, SAMPLE_FAMILY)).toEqual([]);
});

test("at 375 px the page offers a plan when planning is open, and the recording when it is not", async ({ page, request, baseURL }, testInfo) => {
  const { health } = await healthOf(request);
  if (WANT) expect(health.planningOpen, `planning is ${WANT === "on" ? "open" : "closed"} on this page`).toBe(WANT === "on");
  const seen = watch(page, baseURL!);
  const methods = new Set<string>();
  page.on("request", (r) => methods.add(r.method()));
  await page.goto("/", { waitUntil: "networkidle" });
  expect(page.viewportSize()?.width).toBe(375);
  await expectPageStillThere(page);
  const paused = page.getByText("Live planning is paused right now.");
  const form = page.locator("form.own");
  const how = page.locator("details.how");
  const note_ = page.locator('[role="note"]');
  if (!health.planningOpen) await expect(paused.first(), "a pause is said on arrival, before any scrolling").toBeInViewport();

  // On arrival, open or paused: the saved plan, labelled as a recording, with its workings folded one click away.
  await expect(note_).toContainText("It is a recording, not a new plan.");
  await expect(page.locator(".card.bridge .title")).not.toBeEmpty();
  await expect(page.locator(".card.bridge"), "the numbers are folded away from the card").not.toContainText("Qloo affinity");
  await expect(how, "the workings start folded").toHaveJSProperty("open", false);
  expect(await page.locator("section[aria-labelledby=visit] .card:not(.question)").count()).toBeGreaterThanOrEqual(2);
  await expect(page.locator(".card.question")).toHaveCount(3);
  await expect(page.getByText("A model put them into the language, not a native speaker: say them in your own words.")).toBeVisible();
  await expect(page.locator(".card.question .native").first()).toHaveAttribute("lang", "es");
  await expect(page.locator(".card.feedback")).toHaveCount(0); // a recording takes no feedback
  await how.locator("summary").click();
  // A recording made since steps say who did them shows that on every step.
  const recorded = existsSync(SAVED) ? (JSON.parse(readFileSync(SAVED, "utf8")) as { steps: string[]; by?: string[] }) : null;
  if (recorded?.by) await expect(page.locator("ul.steps li .by")).toHaveCount(recorded.steps.length);
  await expect(how.locator("ul.steps li").first()).toBeVisible();
  await expect(how).toContainText(/Qloo affinity, from 0 to 1: 0\.\d\d with Rosa's favorites, 0\.\d\d with Leo's\./);
  await expect(how.locator(".found .chip").first()).toBeVisible();

  if (health.planningOpen) {
    // Open: the sample family can be planned for with one click, and nothing says paused. Nothing here clicks it:
    // a plan costs money, and the scripted run (e2e/demo.spec.ts) is the check that makes one.
    await expect(planButton(page)).toHaveText("Plan a visit for Rosa and Leo");
    await expect(planButton(page)).toBeEnabled();
    note(testInfo, "extra", `plan button visible without scrolling at 375x667: ${await planButton(page).evaluate((el) => el.getBoundingClientRect().bottom <= window.innerHeight)}`);
    await expect(paused).toHaveCount(0);

    // The form opens ready to send.
    await page.getByRole("button", { name: "Tell us about your grandparent and you" }).click();
    await expect(form.getByRole("button", { name: "Plan our visit" })).toBeEnabled();
    await expect(form.getByText("Live planning is paused right now", { exact: false })).toHaveCount(0);
  } else {
    await expect(paused.first()).toBeVisible();
    await expect(planButton(page)).toHaveCount(0);

    // The form opens, says why it cannot be sent, and cannot be sent.
    await page.getByRole("button", { name: "Tell us about your grandparent and you" }).click();
    await expect(form.getByText("Live planning is paused right now, so this form cannot make a plan yet.")).toBeVisible();
    await expect(form.getByRole("button", { name: "Plan our visit" })).toBeDisabled();
  }

  // The landing text: who it is for, the problem, and three figures, each in its source's own words with a link.
  await expect(page.locator("p.lead").first()).toContainText("For anyone about to visit a grandparent and wondering what you will talk about.");
  const why = page.getByRole("region", { name: "Why this exists" });
  for (const source of SOURCES) {
    await expect(why.locator("blockquote", { hasText: source.quote })).toHaveAttribute("cite", source.url);
    if (source.asked) await expect(why.locator("blockquote", { hasText: source.quote })).toContainText(source.asked);
    await expect(why.getByRole("link", { name: source.who })).toHaveAttribute("href", source.url);
  }
  await expect(why).toContainText("It is not a medical tool");
  await expect(page.getByRole("region", { name: "What is sent, and where" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), "no sideways scroll at 375 px").toBe(false);
  expect(seen.consoleErrors).toEqual([]);
  expect(seen.otherOrigins, "the page talks to its own server only").toEqual([]);
  expect([...methods], "it only reads").toEqual(["GET"]);
});
