import type { AgentEvent, Doer } from "./agent";
import type { Family } from "./family";
import type { FinalPlan } from "./plan";
import { isOwnFavorite, questionProblem, withKnownNames, withoutClaims } from "./wording";

// A real plan recorded from a live run (tests/saved-plan.live.test.ts), served as public/saved-plan.json and shown,
// clearly labelled, when live planning is paused. Only plans made with real Qloo data may be shown: the synthetic
// test data never leaves tests/.
export interface SavedPlan {
  recordedAt: string;
  qlooData: "real";
  steps: string[];
  by?: Doer[]; // who did each step, one for each (recordings made before 2026-10-11 have none)
  plan: FinalPlan;
  leftOut?: number; // event cards left out of the recording; the page says so
}

export function isShowableSavedPlan(value: unknown): value is SavedPlan {
  const v = value as Partial<SavedPlan> | null;
  return Boolean(
    v &&
      v.qlooData === "real" &&
      typeof v.recordedAt === "string" &&
      Array.isArray(v.steps) &&
      v.plan?.bridge?.title &&
      Array.isArray(v.plan.moments) &&
      Array.isArray(v.plan.questions),
  );
}

// Turns the events of one real run into the saved plan. Nothing is rewritten. One thing is left out, by Sonu's word
// of 2026-10-11 (bus 003): event cards. An event found on the web is an unchecked lead, and a recording stays on the
// page for weeks, long after such an event has passed. Live plans keep their event cards. The page says how many
// cards a recording left out. A web lead is told by the evidence it cites, not only by its label: a recording made
// before the engine learned that (2026-10-11) called one a "place".
export function toSavedPlan(events: AgentEvent[], recordedAt: string): SavedPlan | null {
  const plan = events.find((e): e is Extract<AgentEvent, { type: "plan" }> => e.type === "plan")?.plan;
  if (!plan) return null;
  const fromWeb = new Set(plan.evidence.filter((e) => e.source === "tavily").map((e) => e.id));
  const moments = plan.moments.filter((m) => m.kind !== "event" && !m.evidence.some((id) => fromWeb.has(id)));
  if (moments.length < 2) return null;
  const leftOut = plan.moments.length - moments.length;
  const done = events.flatMap((e) => (e.type === "step" ? [{ text: e.text, by: e.by }] : e.type === "tool" && e.ok ? [{ text: e.summary, by: e.by }] : []));
  const by = done.every((s) => s.by) ? { by: done.map((s) => s.by) } : {};
  return { recordedAt, qlooData: "real", steps: done.map((s) => s.text), ...by, plan: { ...plan, moments }, ...(leftOut ? { leftOut } : {}) };
}

// The events of a plan as the route streams them ("data: {...}" frames), for a plan made through a deployed route.
export function eventsFromStream(text: string): AgentEvent[] {
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)) as AgentEvent);
}

// A recording stays on the public page for weeks, so it is held to the wording rules of today (lib/wording.ts),
// whatever engine made it. Empty means it may be shown. The recording test refuses to save a plan that fails, and
// check.sh fails while a published one does.
export function savedPlanProblems(saved: SavedPlan, family: Family): string[] {
  const favorites = [...family.grandparent.favorites, ...family.visitor.favorites];
  const { plan } = saved;
  const cards = [{ title: plan.bridge.title, text: plan.bridge.why, ownWords: false }, ...plan.moments.map((m) => ({ title: m.title, text: m.what_to_do, ownWords: m.kind === "dish" || m.kind === "activity" }))];
  const context = { titles: cards.map((c) => c.title), said: [...favorites, family.grandparent.city ?? "", family.grandparent.language], known: saved.steps };
  return [
    ...cards.flatMap((c) => (c.ownWords && isOwnFavorite(c.title, favorites) ? [] : withoutClaims(c.text, favorites).found.map((claim) => `"${c.title}" says what they already love or lived ("${claim}")`))),
    ...cards.filter((c) => withKnownNames(c.text) !== c.text).map((c) => `"${c.title}" names someone in braces other than {grandparent} and {visitor}`),
    ...plan.questions.flatMap((q) => {
      const why = questionProblem(q.english, context);
      return why ? [`the question "${q.english}" ${why}`] : [];
    }),
    ...plan.moments.filter((m) => m.kind === "event").map((m) => `"${m.title}" is an unchecked web lead`),
    // Seen on 2026-10-12: two cards of one plan with the same plain sentence (lib/plan.ts, withDistinctLines).
    ...plan.moments.filter((m, i) => plan.moments.findIndex((o) => o.what_to_do === m.what_to_do) < i).map((m) => `"${m.title}" says the same sentence as a card above it`),
  ];
}
