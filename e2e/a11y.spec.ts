import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import type { AgentEvent } from "../lib/agent";

// Keyboard use and contrast (the rubric's item 7), at 375 px, in the light and the dark colours:
//   - axe-core finds no WCAG 2.1 A or AA fault on any view of the page, text contrast among them;
//   - every control is reached with Tab, in the order it stands on the page, and shows a focus ring when reached;
//   - the whole path can be done from the keyboard: open the form, fill it, send it, mark what landed, plan again.
// It answers the two API routes itself, so it costs nothing and runs against any build:
//
//   DEMO_URL=http://localhost:3210 npm run demo:e2e:a11y
//
// Invented people and titles throughout.
const EVIDENCE = [
  { id: "E1", source: "family", label: "In the family's own words", urls: [] },
  { id: "E2", source: "qloo", label: "Qloo bridge check", urls: [] },
  { id: "E3", source: "qloo", label: 'Qloo place insights for both of them near Example City, of the kind "Example house"', urls: [] },
  { id: "E4", source: "tavily", label: 'Web search "example city film days"', urls: ["https://example.org/film-days"] },
];
const BRIDGE = { title: "An Example Film", kind: "film" as const, why: "Its songs may speak to {grandparent}, and its colours to {visitor}.", evidence: ["E2"], affinity: { grandparent: 0.88, visitor: 0.9 }, beyondFame: { of: 50, grandparent: 0.75, visitor: 0.77 } };
const STREAM: AgentEvent[] = [
  { type: "step", text: "Reading how the last visit went", by: "nano" },
  { type: "step", text: "Looking up their favorites in Qloo", by: "super" },
  { type: "tool", name: "qloo_search", ok: false, summary: "Corrected arguments for qloo_search", by: "super" },
  { type: "tool", name: "qloo_bridge_check", ok: true, summary: "Qloo bridge check: An Example Film is closest to both", evidence: "E2", by: "rule" },
  { type: "bridge", bridge: BRIDGE, evidence: EVIDENCE },
  { type: "step", text: "Writing the visit plan", by: "ultra" },
  {
    type: "plan",
    plan: {
      bridge: BRIDGE,
      moments: [
        { title: "An Example Singer", kind: "artist", what_to_do: "Play a little of this music together and see what you each make of it.", evidence: ["E2"] },
        { title: "Example Tamale House", kind: "place", what_to_do: "Go together, at an easy pace.", evidence: ["E3"], where: "12 Example St Example City, TX 00000" },
        { title: "Example Film Days", kind: "event", what_to_do: "Found on the web and not checked. Look at its page for what is on, and when, before you go.", evidence: ["E4"] },
        { title: "masala chai", kind: "dish", what_to_do: "Make it together, side by side.", evidence: ["E1"] },
      ],
      questions: [
        { native: "आपको कौन सा गाना सबसे प्यारा है?", english: "Which song is dearest to you?" },
        { native: "आप सबसे पहले कौन सी फ़िल्म देखेंगे?", english: "Which film would you watch first?" },
        { native: "अगली बार हम क्या करें?", english: "What should we do next time?" },
      ],
      language: "Hindi",
      evidence: EVIDENCE,
      costUsd: 0,
    },
  },
  { type: "done", costUsd: 0, ms: 5 },
];

async function stub(page: Page, planningOpen = true) {
  const bodies: unknown[] = [];
  await page.route("**/api/health", (route) => route.fulfill({ json: { livePlanning: planningOpen, planningOpen, pausedFor: planningOpen ? null : "off", counters: "redis" } }));
  await page.route("**/api/plan", async (route) => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: "text/event-stream; charset=utf-8", body: STREAM.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") });
  });
  return bodies;
}

// No WCAG 2.1 A or AA fault that axe-core can find. Contrast is one of its rules ("color-contrast").
async function expectNoFaults(page: Page, view: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(
    violations.map((v) => `${v.id}: ${v.nodes.map((n) => `${n.target.join(" ")} (${n.failureSummary?.split("\n")[1]?.trim() ?? ""})`).join(" | ")}`),
    view,
  ).toEqual([]);
}

// The controls a keyboard user must be able to reach, in page order. A group of radio buttons is one stop: Tab
// reaches the group and the arrow keys move within it.
// Each control gets a number in page order and a name a person can read: its label, its text, or where it leads.
const NUMBER_CONTROLS = () => {
  const all = [...document.querySelectorAll<HTMLElement>('a[href], button, input, textarea, select, summary, [tabindex]:not([tabindex="-1"])')];
  all.forEach((el, at) => {
    const label = el.closest("label")?.textContent ?? (el.id ? document.querySelector(`label[for="${el.id}"]`)?.textContent : null) ?? el.textContent ?? "";
    el.dataset.stop = `${at} ${el.tagName.toLowerCase()} ${label.trim().slice(0, 40)}`;
  });
};
const controlsOf = (page: Page) =>
  page.evaluate(() => {
    const seenRadios = new Set<string>();
    return [...document.querySelectorAll<HTMLElement>("[data-stop]")]
      .filter((el) => !(el as HTMLButtonElement).disabled && el.getClientRects().length > 0)
      .filter((el) => {
        if (!(el instanceof HTMLInputElement) || el.type !== "radio") return true;
        // Tab stops at the chosen one of a group, or at the first when none is chosen.
        if (seenRadios.has(el.name)) return false;
        const chosen = document.querySelector<HTMLInputElement>(`input[type=radio][name="${el.name}"]:checked`);
        if (chosen && chosen !== el) return false;
        seenRadios.add(el.name);
        return true;
      })
      .map((el) => el.dataset.stop!);
  });

// Presses Tab from the top of the page until focus leaves it, and reports what was reached and whether each stop
// showed a focus ring at least 2 px wide, in view.
async function tabThrough(page: Page) {
  // A click on the heading puts the starting point for Tab at the top, as it is for someone who has just arrived.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator("h1").click();
  const reached: string[] = [];
  const noRing: string[] = [];
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press("Tab");
    const stop = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const style = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      return { name: el.dataset.stop ?? el.tagName, ring: style.outlineStyle !== "none" && parseFloat(style.outlineWidth) >= 2, inView: box.top >= 0 && box.bottom <= window.innerHeight + 1 };
    });
    if (!stop || reached.includes(stop.name)) break;
    reached.push(stop.name);
    if (!stop.ring) noRing.push(stop.name);
    if (!stop.inView) noRing.push(`${stop.name} (not scrolled into view)`);
  }
  return { reached, noRing };
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} colours`, () => {
    test.use({ colorScheme: scheme });

    test("no fault on the first screen, the saved plan, or the paused form", async ({ page }) => {
      await stub(page, false);
      await page.goto("/", { waitUntil: "networkidle" });
      await expectNoFaults(page, "the first screen, planning paused, with the saved plan if this build has one");
      if (await page.locator("details.how").count()) {
        await page.locator("details.how summary").click();
        await expectNoFaults(page, "the saved plan with its workings open");
      }
      await page.getByRole("button", { name: "Tell us about your grandparent and you" }).click();
      await expectNoFaults(page, "the form while planning is paused");
    });

    test("no fault on the form with its error messages, on a live plan, or on the note's error", async ({ page }) => {
      await stub(page);
      await page.goto("/", { waitUntil: "networkidle" });
      await expectNoFaults(page, "the first screen, planning open");
      await page.getByRole("button", { name: "Tell us about your grandparent and you" }).click();
      await page.locator("form.own").getByRole("button", { name: "Plan our visit" }).click();
      await expect(page.locator(".field-error").first()).toBeVisible();
      await expectNoFaults(page, "the form with four error messages");
      await page.getByRole("button", { name: /^Plan a visit for / }).click();
      await page.waitForSelector(".card.feedback");
      await page.locator("details.how summary").click();
      await expectNoFaults(page, "a live plan: its workings open, cards of every kind, questions, the feedback card");
      await page.locator(".card.feedback textarea").fill("call me on 210 555 0100");
      await page.getByRole("button", { name: "Plan the next visit" }).click();
      await expect(page.locator("#note-error")).toBeVisible();
      await expectNoFaults(page, "the note refused");
    });

    // Two things axe-core does not measure. Example text in a field is text, and needs 4.5 to 1 like any other; the
    // edge of a field and the focus ring are what show where a control is, and need 3 to 1 (WCAG 1.4.11).
    test("example text in a field, the edge of a field and the focus ring have enough contrast", async ({ page }) => {
      await stub(page);
      await page.goto("/", { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Tell us about your grandparent and you" }).click();
      await page.locator("#birth-year").focus();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab"); // focus from the keyboard, so the ring shows
      const measured = await page.evaluate(() => {
        const rgb = (color: string) => (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
        const luminance = (color: string) => {
          const [r, g, b] = rgb(color).map((c) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4)) as [number, number, number];
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const contrast = (a: string, b: string) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
        const card = getComputedStyle(document.querySelector("form.own")!).backgroundColor;
        return [...document.querySelectorAll<HTMLElement>("form.own input:not([type=radio]), form.own textarea")].map((field) => {
          const style = getComputedStyle(field);
          return {
            field: field.id,
            exampleText: field.getAttribute("placeholder") ? contrast(getComputedStyle(field, "::placeholder").color, style.backgroundColor) : null,
            edge: contrast(style.borderTopColor, card),
            ring: field === document.activeElement ? contrast(style.outlineColor, card) : null,
          };
        });
      });
      expect(measured.length).toBe(7);
      for (const m of measured) {
        if (m.exampleText !== null) expect(m.exampleText, `example text in ${m.field}`).toBeGreaterThanOrEqual(4.5);
        expect(m.edge, `the edge of ${m.field}`).toBeGreaterThanOrEqual(3);
        if (m.ring !== null) expect(m.ring, `the focus ring on ${m.field}`).toBeGreaterThanOrEqual(3);
      }
      expect(measured.some((m) => m.ring !== null), "one field was measured with its ring").toBe(true);
    });

    test("Tab reaches every control in page order, and each shows a focus ring", async ({ page }) => {
      await stub(page);
      await page.goto("/", { waitUntil: "networkidle" });
      await page.getByRole("button", { name: /^Plan a visit for / }).click();
      await page.waitForSelector(".card.feedback");
      await page.getByRole("button", { name: "Tell us about your grandparent and you" }).click();
      await page.evaluate(NUMBER_CONTROLS);
      const expected = await controlsOf(page);
      expect(expected.length, "the page with a plan and the open form has many controls").toBeGreaterThan(20);
      const { reached, noRing } = await tabThrough(page);
      expect(reached, "every control, in page order").toEqual(expected);
      expect(noRing, "a visible focus ring on every stop, scrolled into view").toEqual([]);
    });
  });
}

test("the whole path works from the keyboard alone", async ({ page }) => {
  const bodies = await stub(page);
  await page.goto("/", { waitUntil: "networkidle" });
  const focusOn = async (name: string | RegExp, role: "button" | "textbox" | "combobox" | "radio" | "checkbox" | "link" = "button") => {
    const target = page.getByRole(role, { name }).first();
    for (let i = 0; i < 80; i++) {
      if (await target.evaluate((el) => el === document.activeElement)) return;
      await page.keyboard.press("Tab");
    }
    throw new Error(`Tab never reached ${String(name)}`);
  };

  // Open the form with Enter, fill it by typing, choose "Grandfather" with the arrow keys, send it with Enter.
  await focusOn("Tell us about your grandparent and you");
  await page.keyboard.press("Enter");
  await focusOn("Their first name, or what you call them", "textbox");
  await page.keyboard.type("Dadaji");
  await page.keyboard.press("Tab"); // into the group of radio buttons, at "Rather not say", which is chosen at first
  await expect(page.getByRole("radio", { name: "Rather not say" })).toBeFocused();
  await page.keyboard.press("ArrowUp"); // the arrow keys move through the group and choose
  await expect(page.getByRole("radio", { name: "Grandfather" })).toBeChecked();
  await focusOn("The year they were born", "textbox");
  await page.keyboard.type("1938");
  await focusOn("The language they are most at home in", "combobox"); // a text field with a list of suggestions
  await page.keyboard.type("Hindi");
  await focusOn(/^What they love/, "textbox");
  await page.keyboard.type("Mohammed Rafi, masala chai");
  await focusOn("Your first name", "textbox");
  await page.keyboard.type("Anika");
  await focusOn(/^What you love/, "textbox");
  await page.keyboard.type("baking");
  await focusOn("Plan our visit");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".card.feedback");
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toMatchObject({ grandparent: { relation: "grandfather", birthYear: 1938, language: "Hindi", favorites: ["Mohammed Rafi", "masala chai"] }, visitor: { favorites: ["baking"] } });
  await expect(page.locator(".card.bridge")).toContainText("Its songs may speak to Dadaji, and its colours to Anika.");

  // Mark what landed with Space, type a note, and plan the next visit with Enter.
  await focusOn("An Example Film", "checkbox");
  await page.keyboard.press("Space");
  await focusOn("What should be different next time?", "textbox");
  await page.keyboard.type("more music");
  await focusOn("Plan the next visit");
  await page.keyboard.press("Enter");
  await expect.poll(() => bodies.length).toBe(2);
  expect((bodies[1] as { history: unknown[] }).history.at(-1)).toMatchObject({ landed: [{ title: "An Example Film", kind: "film" }], note: "more music" });

  // A link to a source page can be reached and followed from the keyboard: it is a real link.
  await focusOn(/World Health Organization/, "link");
  await expect(page.getByRole("link", { name: /World Health Organization/ })).toHaveAttribute("href", /^https:\/\/www\.who\.int\//);
});
