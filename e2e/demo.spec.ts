import { expect } from "@playwright/test";
import { inAnotherScript, isSameName, normalizeName } from "../lib/evidence";
import { note, openHow, planButton, planWith, test, watch, type ToolEvent } from "./helpers";

// The scripted demo run, step for step as STACK_AND_GATE.md sets it out ("The gate", layer 2). Each numbered step is
// a soft check, so one run reports on all eight. It makes two real plans: about $0.06.
const MUSIC = new Set(["song", "album", "artist"]);
const OWN_WORDS = new Set(["dish", "activity"]);
const FEEDBACK = "the music was a hit, the film was too long";

test("the scripted demo run", async ({ page, baseURL }, testInfo) => {
  expect(baseURL, "set DEMO_URL to the deployed URL").toBeTruthy();
  const seen = watch(page, baseURL!);

  // 1. Open the page. "Try a sample family" (Rosa and Leo) is visible without scrolling at 375 px wide.
  await page.goto("/", { waitUntil: "networkidle" });
  expect.soft(page.viewportSize()?.width, "step 1: the page is 375 px wide").toBe(375);
  await expect.soft(page.getByRole("heading", { name: "Try a sample family" }), "step 1: the sample family is visible without scrolling").toBeInViewport();
  await expect(planButton(page), "live planning must be open on this URL for the scripted run").toBeVisible();
  note(testInfo, "extra", `plan button visible without scrolling at 375x667: ${await planButton(page).evaluate((el) => el.getBoundingClientRect().bottom <= window.innerHeight)}`);

  // 2. Click it. The first agent step appears within 3 seconds.
  const first = await planWith(page, () => planButton(page).click());
  expect(first.status, "the plan request is accepted").toBe(200);
  note(testInfo, "timing", `plan 1: first step ${first.firstStepMs} ms, bridge ${first.bridgeMs} ms, stream done ${first.doneMs} ms, cost $${first.costUsd}`);
  expect.soft(first.firstStepMs, "step 2: the first agent step appears within 3 seconds").toBeLessThanOrEqual(3_000);
  const failure = first.events.find((e) => e.type === "error");
  expect(first.plan, `a plan arrives${failure && "message" in failure ? ` (the agent said: ${failure.message})` : ""}`).not.toBeNull();
  const plan = first.plan!;

  // Rubric item 5: the trace shows which model did each step. Super gathers, a rule chooses the bridge, Ultra writes.
  const doers = (events: typeof first.events) => new Set(events.flatMap((e) => (e.type === "step" || e.type === "tool" ? [e.by] : [])));
  expect.soft([...doers(first.events)].sort(), "rubric 5: the first plan is the work of Super, Ultra and a rule").toEqual(["rule", "super", "ultra"]);
  expect.soft(await page.locator("ul.steps li .by").count(), "rubric 5: every step on the page says who did it").toBe(await page.locator("ul.steps li").count());

  // 3. The bridge card comes first, within 25 seconds.
  expect.soft(first.bridgeMs, "step 3: the bridge card arrives within 25 seconds").toBeLessThanOrEqual(25_000);
  const cards = page.locator("section[aria-labelledby=plan] .card, section[aria-labelledby=visit] .card");
  await expect.soft(cards.first(), "step 3: the bridge card comes first").toHaveClass(/bridge/);
  await expect.soft(page.locator(".card.bridge .title")).toHaveText(plan.bridge.title);

  // 4. Four moment cards follow, each with a source chip one click away, within 60 seconds in total.
  const moments = page.locator("section[aria-labelledby=visit] .card:not(.question):not(.feedback)");
  await expect.soft(moments, "step 4: four moment cards").toHaveCount(4);
  await openHow(page);
  for (const card of await moments.all()) {
    const title = await card.locator(".title").innerText();
    const found = page.locator("details.how .found", { has: page.locator(".title", { hasText: title }) }).first();
    expect.soft(await found.locator(".chip").count(), `step 4: "${title}" has a source chip under "How this plan was made"`).toBeGreaterThan(0);
  }
  expect.soft(first.doneMs, "step 4: everything within 60 seconds").toBeLessThanOrEqual(60_000);
  expect.soft(await moments.locator(".title").allInnerTexts(), "the cards show the plan the stream carried").toEqual(plan.moments.map((m) => m.title));

  // 5. Three story questions in Spanish, each with an English gloss. None starts with "Do you remember".
  const questions = page.locator(".card.question");
  await expect.soft(questions, "step 5: three questions").toHaveCount(3);
  for (const q of await questions.all()) {
    const native = (await q.locator(".native").innerText()).trim();
    const gloss = (await q.locator(".gloss").innerText().catch(() => "")).trim();
    expect.soft(await q.locator(".native").getAttribute("lang"), `step 5: "${native}" is marked as Spanish`).toBe("es");
    expect.soft(gloss.length, `step 5: "${native}" has an English gloss`).toBeGreaterThan(0);
    expect.soft(native, "step 5: the Spanish is not the English again").not.toBe(gloss);
    expect.soft(gloss, "step 5: no memory test").not.toMatch(/^\s*(do|can|did) you (still )?remember|do you recall/i);
  }

  // 6. Every title, artist, place and event named on a card appears in the run's evidence record.
  // Checked here from the stream, without trusting the server's own grounding check.
  const tools = first.events.filter((e): e is ToolEvent => e.type === "tool" && e.ok && Boolean(e.evidence));
  const byId = new Map(tools.map((t) => [t.evidence!, t]));
  const named = (title: string, ids: string[]) => {
    const t = normalizeName(title);
    return ids.some((id) => (byId.get(id)?.names ?? []).some((n) => normalizeName(n).length > 2 && (t.includes(normalizeName(n)) || normalizeName(n).includes(t))));
  };
  for (const item of [{ where: "bridge", ...plan.bridge }, ...plan.moments.map((m, i) => ({ where: `moment ${i + 1}`, ...m }))]) {
    const unknown = item.evidence.filter((id) => id !== "E1" && !byId.has(id));
    expect.soft(unknown, `step 6: ${item.where} "${item.title}" cites evidence the run produced`).toEqual([]);
    if (OWN_WORDS.has(item.kind) && item.evidence.includes("E1")) continue; // the family's own words
    if (item.kind === "event") {
      // An event may be titled in the planner's words from a page's snippet, which the stream does not carry.
      expect.soft(item.evidence.some((id) => byId.get(id)?.name === "web_search"), `step 6: event "${item.title}" cites a web search`).toBe(true);
      continue;
    }
    expect.soft(named(item.title, item.evidence), `step 6: ${item.where} "${item.title}" is named in its evidence ${item.evidence.join(", ")}`).toBe(true);
  }
  expect.soft(plan.bridge.evidence.some((id) => byId.get(id)?.name.startsWith("qloo_")), "step 6: the bridge cites Qloo evidence").toBe(true);
  const qlooTools = [...new Set(tools.filter((t) => t.name.startsWith("qloo_")).map((t) => t.name))];
  note(testInfo, "qloo", `plan 1 Qloo tools used: ${qlooTools.join(", ")}`);
  // Rubric item 1: live calls to four Qloo endpoints. Each of these tools is one: /search, /v2/tags, /v2/insights
  // and /v2/analysis/compare. The sample family named a dish, so the tag search belongs in their plan.
  expect.soft(qlooTools, "rubric 1: the plan called four Qloo endpoints").toEqual(expect.arrayContaining(["qloo_search", "qloo_tags", "qloo_insights", "qloo_compare"]));
  expect.soft(tools.some((t) => t.name === "qloo_insights" && /^Qloo place insights/.test(t.summary)), "rubric 1: the tag led to a place search").toBe(true);
  for (const place of plan.moments.filter((m) => m.kind === "place")) {
    await expect.soft(page.locator(".card", { hasText: place.title }).first(), `"${place.title}" shows where it is and a caution`).toContainText("Check that it is open before you go.");
  }
  note(testInfo, "bridge", `plan 1: ${plan.bridge.title} (${plan.bridge.kind}), Qloo affinity ${JSON.stringify(plan.bridge.affinity ?? null)}`);
  // Rubric item 3: the bridge is more than famous. It is not one of the 50 that Qloo suggests to anyone, and each of
  // the two tastes likes it more than the middle of those 50. The card says so, with the numbers.
  // Since bus 015 a bridge that did not pass is kept, and its card says so with the numbers.
  const fame = plan.bridge.beyondFame ?? plan.bridge.fameMissed;
  const many = ({ film: "films", show: "shows", artist: "artists", book: "books" } as Record<string, string>)[plan.bridge.kind] ?? "things";
  expect.soft(fame, "rubric 3: the bridge was held against what Qloo suggests to anyone, passed or not").toBeTruthy();
  if (plan.bridge.beyondFame && plan.bridge.affinity) {
    expect.soft(plan.bridge.affinity.grandparent, "rubric 3: above the middle with the grandparent's favorites").toBeGreaterThan(plan.bridge.beyondFame.grandparent);
    expect.soft(plan.bridge.affinity.visitor, "rubric 3: above the middle with the visitor's favorites").toBeGreaterThan(plan.bridge.beyondFame.visitor);
  }
  if (plan.bridge.fameMissed) await expect.soft(page.locator(".card.bridge"), "rubric 3: a bridge that did not pass says so on its card").toContainText(`For scale: the ${plan.bridge.fameMissed.of} ${many} Qloo suggests to anyone score`);
  if (fame) {
    await expect.soft(page.locator("details.how .found").first(), "rubric 3: the workings show the comparison").toContainText(`For scale: the ${fame.of} ${many} Qloo suggests to anyone score`);
    note(testInfo, "bridge", `plan 1: the ${fame.of} most popular score ${fame.grandparent} and ${fame.visitor} at the middle; ${plan.bridge.beyondFame ? "passed" : "did not pass"}`);
  }
  if (plan.bridge.affinity) {
    await expect.soft(page.locator("details.how .found").first(), "step 3: the workings show Qloo's affinity with the bridge for each of them").toContainText(`Qloo affinity, from 0 to 1: ${plan.bridge.affinity.grandparent.toFixed(2)} with Rosa's favorites, ${plan.bridge.affinity.visitor.toFixed(2)} with Leo's.`);
  }

  // 7. Send feedback: "the music was a hit, the film was too long". The next plan has more music items and no
  // full-length film.
  const items = [plan.bridge, ...plan.moments];
  const feedback = page.locator(".card.feedback");
  for (const item of items.filter((i) => MUSIC.has(i.kind))) {
    await feedback.getByLabel(item.title, { exact: true }).check();
  }
  await feedback.locator("textarea").fill(FEEDBACK);
  const second = await planWith(page, () => feedback.getByRole("button", { name: "Plan the next visit" }).click());
  note(testInfo, "timing", `plan 2: first step ${second.firstStepMs} ms, bridge ${second.bridgeMs} ms, stream done ${second.doneMs} ms, cost $${second.costUsd}`);
  const card = ({ title, kind }: { title: string; kind: string }) => ({ title, kind });
  const history = (second.requestBody as { history?: unknown[] } | null)?.history ?? [];
  expect.soft(history.at(-1), "step 7: the feedback is sent with the next request, each card with its kind").toEqual({
    landed: items.filter((i) => MUSIC.has(i.kind)).map(card),
    rest: items.filter((i) => !MUSIC.has(i.kind)).map(card),
    note: FEEDBACK,
  });
  // Each step now begins with who did it, so the line is looked for after that label.
  await openHow(page);
  await expect.soft(page.locator("ul.steps li", { hasText: /^Nemotron 3 Nano\s*From the last visit: / }), "step 7: the page shows what was heard, and that Nano read it").toBeVisible();
  expect(second.plan, "step 7: a second plan arrives").not.toBeNull();
  expect.soft(doers(second.events).has("nano"), "rubric 5: Nano read how the last visit went").toBe(true);
  const next = [second.plan!.bridge, ...second.plan!.moments];
  const music = (list: { kind: string }[]) => list.filter((i) => MUSIC.has(i.kind)).length;
  note(testInfo, "feedback", `music items ${music(items)} -> ${music(next)}; kinds before ${items.map((i) => i.kind).join(", ")}; after ${next.map((i) => i.kind).join(", ")}`);
  note(testInfo, "bridge", `plan 2: ${second.plan!.bridge.title} (${second.plan!.bridge.kind}), Qloo affinity ${JSON.stringify(second.plan!.bridge.affinity ?? null)}`);
  expect.soft(music(next), "step 7: the next plan has more music items").toBeGreaterThan(music(items));
  expect.soft(next.filter((i) => i.kind === "film").map((i) => i.title), "step 7: the next plan has no full-length film").toEqual([]);

  // Two faults seen on 2026-10-12 in the plans recorded for the video (bus 008), checked on both plans of every run.
  for (const [n, run, made] of [[1, first, plan], [2, second, second.plan!]] as const) {
    // No two cards say the same sentence. The caution on a web lead may repeat: it is a warning.
    const lines = made.moments.filter((m) => m.kind !== "event").map((m) => m.what_to_do);
    expect.soft(new Set(lines).size, `plan ${n}: every card has a sentence of its own`).toBe(lines.length);
    // A search result is a favorite only if it is called what was asked for. (For the sample family, whose favorites
    // are all named as Qloo names them: a title in another language is matched by names this run does not see.)
    const searches = run.events.filter((e): e is ToolEvent => e.type === "tool" && e.name === "qloo_search" && e.ok);
    for (const search of searches) {
      const asked = /^Qloo search "(.*)" \(([^)]*)\): /.exec(search.summary);
      const found = search.names?.[0];
      if (asked && found) expect.soft(isSameName(asked[1]!, found, asked[2]!.replace(" ", "_")) || inAnotherScript(asked[1]!, found), `plan ${n}: the search for "${asked[1]}" took "${found}"`).toBe(true);
    }
    note(testInfo, "searches", `plan ${n}: ${searches.length} searches, ${searches.filter((s) => !s.names?.length).length} of them answered "nothing by that name"`);
  }

  // 8. No console errors, and the cost of the run is logged.
  expect.soft(seen.consoleErrors, "step 8: no console errors").toEqual([]);
  expect.soft(seen.otherOrigins, "the page talks only to its own server").toEqual([]);
  note(testInfo, "cost", `scripted run: $${(first.costUsd + second.costUsd).toFixed(6)} for two plans`);
});
