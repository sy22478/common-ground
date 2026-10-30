import { expect } from "@playwright/test";
import { expectPageStillThere, note, openHow, planButton, planWith, test, watch } from "./helpers";

// The failure paths of the scripted run (STACK_AND_GATE.md): a forced Qloo error, a forced Tavily error, the rate
// limit and the spend cap. Each must show its human message and never a blank screen. Each needs a preview built with
// its own settings (DEPLOY.md, "Failure paths"), so one case runs at a time:
//
//   DEMO_URL=https://... DEMO_CASE=rate-limit npm run demo:e2e:failures
const only = (name: string) => test.skip(process.env.DEMO_CASE !== name, `run with DEMO_CASE=${name}`);

test("rate limit and plan cap: the third plan in an hour is refused in plain words", async ({ page, baseURL }, testInfo) => {
  only("rate-limit"); // preview with LIVE_PLANNING=on, IP_PLANS_PER_HOUR=2, PLAN_CAP_USD=0
  const seen = watch(page, baseURL!);
  await page.goto("/", { waitUntil: "networkidle" });
  for (const attempt of [1, 2]) {
    const run = await planWith(page, () => planButton(page).click());
    expect(run.status, `request ${attempt} is allowed`).toBe(200);
    expect(run.costUsd, `request ${attempt} costs nothing under a $0 plan cap`).toBe(0);
    await expect(page.locator(".notice")).toHaveText("This plan reached its cost limit before it finished.");
    await expectPageStillThere(page);
    await expect(planButton(page)).toBeEnabled();
  }
  const third = await planWith(page, () => planButton(page).click());
  expect(third.status, "request 3 is refused").toBe(429);
  await expect(page.locator(".notice")).toHaveText("You have planned a lot of visits. Please try again in an hour.");
  await expectPageStillThere(page);
  expect(seen.consoleErrors).toEqual([]);
  note(testInfo, "cost", "rate limit and plan cap: $0");
});

test("spend cap: a paused demo says so before anyone clicks and shows the saved plan", async ({ page, baseURL }, testInfo) => {
  only("paused"); // preview with LIVE_PLANNING=on and TOTAL_CAP_USD=0.01
  const seen = watch(page, baseURL!);
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.getByText("Live planning is paused right now.").first()).toBeVisible();
  await expect(planButton(page)).toHaveCount(0);
  await expect(page.locator('[role="note"]')).toContainText("It is a recording, not a new plan.");
  await expect(page.locator(".card.bridge .title")).not.toBeEmpty();
  await expectPageStillThere(page);
  expect(seen.consoleErrors).toEqual([]);
  note(testInfo, "cost", "spend cap pause: $0");
});

test("site's Qloo allowance used: the page says so, blames nobody, and shows the saved plan", async ({ page, baseURL }, testInfo) => {
  only("qloo-allowance"); // preview with LIVE_PLANNING=on and FORCE_ERRORS=allowance
  const seen = watch(page, baseURL!);
  await page.goto("/", { waitUntil: "networkidle" });
  const run = await planWith(page, () => planButton(page).click());
  expect(run.status).toBe(200);
  expect(run.plan).toBeNull();
  await expect(page.locator(".notice").first()).toHaveText(
    "Live planning is paused for today: this site has used its daily allowance of Qloo calls. It starts again at midnight UTC. Below is a plan this agent made earlier.",
  );
  await expect(page.getByText("not answering")).toHaveCount(0);
  await expect(page.locator('[role="note"]')).toContainText("It is a recording, not a new plan.");
  await expect(page.locator(".card.bridge .title")).not.toBeEmpty();
  await expect(page.getByText("Live planning is paused right now.").first()).toBeVisible();
  await expectPageStillThere(page);
  expect(seen.consoleErrors).toEqual([]);
  expect(run.costUsd, "a spent allowance costs one model call, not a whole plan").toBeLessThan(0.005);
  note(testInfo, "cost", `site's Qloo allowance used: $${run.costUsd}, done in ${run.doneMs} ms`);
});

test("forced Qloo error: the page says Qloo is not answering, and the agent stops asking", async ({ page, baseURL }, testInfo) => {
  only("qloo-down"); // preview with LIVE_PLANNING=on and FORCE_ERRORS=qloo
  const seen = watch(page, baseURL!);
  await page.goto("/", { waitUntil: "networkidle" });
  const run = await planWith(page, () => planButton(page).click());
  expect(run.status).toBe(200);
  expect(run.plan).toBeNull();
  await expect(page.locator(".notice")).toHaveText("Qloo, where the taste data comes from, is not answering right now, so no plan can be made. Please try again in a few minutes.");
  await openHow(page);
  await expect(page.locator("ul.steps li.bad").first()).toBeVisible();
  await expect(page.locator(".card.bridge")).toHaveCount(0);
  await expectPageStillThere(page);
  expect(seen.consoleErrors).toEqual([]);
  expect(run.costUsd, "a dead Qloo costs one model call, not a whole plan").toBeLessThan(0.005);
  note(testInfo, "cost", `forced Qloo error: $${run.costUsd}, ${run.events.filter((e) => e.type === "tool").length} tool calls, done in ${run.doneMs} ms`);
});

test("forced Tavily error: the plan still arrives, without local events, and says why", async ({ page, baseURL }, testInfo) => {
  only("tavily-down"); // preview with LIVE_PLANNING=on and FORCE_ERRORS=tavily
  const seen = watch(page, baseURL!);
  await page.goto("/", { waitUntil: "networkidle" });
  const run = await planWith(page, () => planButton(page).click());
  expect(run.status).toBe(200);
  const failure = run.events.find((e) => e.type === "error");
  expect(run.plan, `a plan arrives${failure && "message" in failure ? ` (the agent said: ${failure.message})` : ""}`).not.toBeNull();
  await expect(page.locator(".card.bridge .title")).toHaveText(run.plan!.bridge.title);
  const searched = run.events.some((e) => e.type === "tool" && e.name === "web_search");
  note(testInfo, "extra", `the agent tried a web search: ${searched}`);
  if (searched) await openHow(page);
  if (searched) await expect(page.locator("ul.steps li.bad", { hasText: "Web search is not answering, so this plan has no local events" }).first()).toBeVisible();
  expect(run.plan!.moments.filter((m) => m.kind === "event")).toEqual([]);
  await expectPageStillThere(page);
  expect(seen.consoleErrors).toEqual([]);
  note(testInfo, "cost", `forced Tavily error: $${run.costUsd}, done in ${run.doneMs} ms`);
});
