import { expect, type Page } from "@playwright/test";
import type { AgentEvent } from "../lib/agent";
import { test, watch } from "./helpers";

// The form for the visitor's own family, in a real browser. The plan request is answered here, by the test, so this
// costs nothing and can run against any build, with planning on or off:
//
//   DEMO_URL=http://localhost:3210 npm run demo:e2e:form
//
// Invented people throughout.
const NAMES = { grandparent: "Dadaji", visitor: "Anika" };
const EVIDENCE = [{ id: "E2", source: "qloo", label: "Qloo bridge check", urls: [] }];
const BRIDGE = { title: "An Example Film", kind: "film" as const, why: "{grandparent} will love its songs and {visitor} its colours.", evidence: ["E2"], affinity: { grandparent: 0.88, visitor: 0.9 } };
const STREAM: AgentEvent[] = [
  { type: "step", text: "Looking up their favorites in Qloo", by: "super" },
  { type: "bridge", bridge: BRIDGE, evidence: EVIDENCE },
  {
    type: "plan",
    plan: {
      bridge: BRIDGE,
      moments: [
        { title: "An Example Singer", kind: "artist", what_to_do: "{visitor} plays one song for {grandparent}.", evidence: ["E2"] },
        { title: "masala chai", kind: "dish", what_to_do: "Make it together.", evidence: ["E2"] },
        { title: "A Second Film", kind: "film", what_to_do: "Watch the first half.", evidence: ["E2"] },
      ],
      questions: [{ native: "आपको कौन सा गाना सबसे प्यारा है?", english: "Which song is dearest to you?" }],
      language: "Hindi",
      evidence: EVIDENCE,
      costUsd: 0,
    },
  },
  { type: "done", costUsd: 0, ms: 5 },
];

// Answers the two API routes from here: planning open (or paused), and a plan that never reaches a model.
async function stub(page: Page, planningOpen = true) {
  const bodies: unknown[] = [];
  await page.route("**/api/health", (route) => route.fulfill({ json: { livePlanning: planningOpen, planningOpen, pausedFor: planningOpen ? null : "off", counters: "redis" } }));
  await page.route("**/api/plan", async (route) => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: "text/event-stream; charset=utf-8", body: STREAM.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") });
  });
  return bodies;
}

async function openForm(page: Page) {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Tell us about your grandparent and you" }).click();
  return page.locator("form.own");
}

async function fill(page: Page) {
  await page.getByLabel("Their first name, or what you call them").fill(NAMES.grandparent);
  await page.getByRole("radio", { name: "Grandfather" }).check();
  await page.getByLabel("The year they were born").fill("1938");
  await page.getByLabel("The language they are most at home in").fill("Hindi");
  await page.getByLabel("The city they live in now (optional)").fill("Jersey City, New Jersey");
  await page.getByLabel(/^What they love/).fill("Mohammed Rafi\nMughal-E-Azam\nmasala chai");
  await page.getByLabel("Your first name").fill(NAMES.visitor);
  await page.getByLabel(/^What you love/).fill("Spirited Away, baking");
}

test("an empty form says what is missing, in plain words, and sends nothing", async ({ page, baseURL }) => {
  const seen = watch(page, baseURL!);
  const bodies = await stub(page);
  const form = await openForm(page);
  await form.getByRole("button", { name: "Plan our visit" }).click();
  await expect(form.locator(".field-error")).toHaveText([
    "A year from 1910 to 2000, for example 1941.",
    "The language they are most at home in, for example Spanish.",
    "Add at least one thing they love.",
    "Add at least one thing you love.",
  ]);
  await expect(page.getByLabel("The year they were born")).toHaveAttribute("aria-invalid", "true");
  expect(bodies).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), "no sideways scroll at 375 px").toBe(false);
  expect(seen.consoleErrors).toEqual([]);
});

test("contact details are refused before anything is sent", async ({ page }) => {
  const bodies = await stub(page);
  const form = await openForm(page);
  await fill(page);
  await page.getByLabel(/^What they love/).fill("Mohammed Rafi\nhis number is 201 555 0142");
  await form.getByRole("button", { name: "Plan our visit" }).click();
  await expect(form.locator(".field-error")).toHaveText(["Tastes only, please: no phone numbers, email addresses or links. What you type here is sent to the planner, to Qloo and to a web search."]);
  expect(bodies).toEqual([]);
});

test("a filled form sends the family without the names, and the plan comes back with them", async ({ page, baseURL }) => {
  const seen = watch(page, baseURL!);
  const bodies = await stub(page);
  const form = await openForm(page);
  await fill(page);
  await form.getByRole("button", { name: "Plan our visit" }).click();

  await expect(page.locator(".card.bridge .title")).toHaveText("An Example Film");
  // Each step says who did it: the model's name for a screen reader, its short name on the screen.
  await expect(page.locator("ul.steps li .by")).toHaveText(["Nemotron 3 Super"]);
  await expect(page.locator("section[aria-labelledby=steps] p.who")).toContainText("three NVIDIA Nemotron 3 models, called on Nebius Token Factory");
  expect(bodies).toEqual([
    {
      grandparent: { birthYear: 1938, relation: "grandfather", language: "Hindi", city: "Jersey City, New Jersey", favorites: ["Mohammed Rafi", "Mughal-E-Azam", "masala chai"] },
      visitor: { favorites: ["Spirited Away", "baking"] },
      history: [],
    },
  ]);
  expect(JSON.stringify(bodies), "the names never leave the browser").not.toMatch(/Dadaji|Anika/);

  // On the page the names are filled in, on the device.
  await expect(page.locator(".card.bridge")).toContainText("Dadaji will love its songs and Anika its colours.");
  await expect(page.locator("details.how")).toContainText("Qloo affinity, from 0 to 1: 0.88 with Dadaji's favorites, 0.90 with Anika's.");
  await expect(page.locator("section[aria-labelledby=visit] .card").first()).toContainText("Anika plays one song for Dadaji.");
  await expect(page.locator(".card.question .native")).toHaveAttribute("lang", "hi");

  // After the visit: a note with a phone number is refused on the page, in plain words, and nothing is sent.
  const feedback = page.locator(".card.feedback");
  await feedback.getByLabel("An Example Singer", { exact: true }).check();
  await feedback.locator("textarea").fill("the music was a hit, call me on 201 555 0142");
  await feedback.getByRole("button", { name: "Plan the next visit" }).click();
  await expect(feedback.locator(".field-error")).toHaveText("Only how the visit went, please: no phone numbers, email addresses or links. This note is sent to the planner.");
  await expect(feedback.locator("textarea")).toHaveAttribute("aria-invalid", "true");
  expect(bodies).toHaveLength(1);

  // The same note without the number goes back for this family, with each card's kind, still without names.
  await feedback.locator("textarea").fill("the music was a hit");
  await expect(feedback.locator(".field-error")).toHaveCount(0);
  await feedback.getByRole("button", { name: "Plan the next visit" }).click();
  await expect.poll(() => bodies.length).toBe(2);
  expect(bodies[1]).toMatchObject({
    grandparent: { birthYear: 1938, language: "Hindi" },
    history: [{ landed: [{ title: "An Example Singer", kind: "artist" }], rest: [{ title: "An Example Film", kind: "film" }, { title: "masala chai", kind: "dish" }, { title: "A Second Film", kind: "film" }], note: "the music was a hit" }],
  });
  expect(JSON.stringify(bodies[1])).not.toMatch(/Dadaji|Anika/);
  expect(seen.consoleErrors).toEqual([]);
});

test("what was typed is kept on this device, and comes back after a reload", async ({ page }) => {
  await stub(page);
  await openForm(page);
  await fill(page);
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Tell us about your grandparent and you" }).click();
  await expect(page.getByLabel("Their first name, or what you call them")).toHaveValue("Dadaji");
  await expect(page.getByLabel("The year they were born")).toHaveValue("1938");
  await expect(page.getByRole("radio", { name: "Grandfather" })).toBeChecked();
  await expect(page.getByLabel(/^What you love/)).toHaveValue("Spirited Away, baking");
});

test("the page says what is sent where, field by field", async ({ page }) => {
  await stub(page);
  await page.goto("/", { waitUntil: "networkidle" });
  const privacy = page.getByRole("region", { name: "What is sent, and where" });
  await expect(privacy.locator("dt")).toHaveText([
    "Stays on this device",
    "NVIDIA Nemotron models on Nebius, which do the planning",
    "Qloo, for taste data",
    "Tavily, for local events",
    "Never sent to Qloo or Tavily",
    "Kept by this site",
  ]);
  await expect(privacy.locator("dd").nth(4)).toHaveText("The language, grandmother or grandfather, and your note.");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), "no sideways scroll at 375 px").toBe(false);
});

test("while planning is paused the form says so and cannot be sent", async ({ page }) => {
  const bodies = await stub(page, false);
  const form = await openForm(page);
  await fill(page);
  await expect(form.getByText("Live planning is paused right now, so this form cannot make a plan yet.")).toBeVisible();
  await expect(form.getByRole("button", { name: "Plan our visit" })).toBeDisabled();
  expect(bodies).toEqual([]);
});

// Bus 015: a bridge that did not pass the check against what Qloo suggests to anyone says so on the card itself, with
// its numbers, and claims no pass.
test("a bridge that did not pass the check against what Qloo suggests to anyone says so on its card, with the numbers", async ({ page }) => {
  await stub(page);
  const missed = { ...BRIDGE, fameMissed: { of: 50, grandparent: 0.8, visitor: 0.92, listed: false } };
  const stream = STREAM.map((e) => (e.type === "bridge" ? { ...e, bridge: missed } : e.type === "plan" ? { ...e, plan: { ...e.plan, bridge: missed } } : e));
  await page.route("**/api/plan", (route) => route.fulfill({ status: 200, contentType: "text/event-stream; charset=utf-8", body: stream.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") }));
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^Plan a visit for / }).click();
  const card = page.locator("main[data-shown=live] .card.bridge");
  await expect(card).toContainText("Chosen from what Qloo suggests for Rosa, as the best fit for both of them.");
  await expect(card).toContainText("For scale: the 50 films Qloo suggests to anyone score 0.80 with Rosa's favorites and 0.92 with Leo's at the middle. This is not one of them, but its 0.90 with Leo's is not above that middle.");
  await expect(card).not.toContainText("This is not one of them.");
});
