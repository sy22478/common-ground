import { z } from "zod";
import { normalizeName, type Ledger, type Source } from "./evidence";
import { isOwnFavorite, PLAIN_WHY, questionProblem, STOCK_QUESTIONS, withKnownNames, withoutClaims, type QuestionContext, withoutLongDashes } from "./wording";

export const ITEM_KINDS = ["song", "album", "artist", "film", "show", "book", "place", "event", "dish", "activity"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];
const Kind = z.enum(ITEM_KINDS);

// How a family talks about a plan after a visit: "the music was a hit, the film was too long". Songs, albums and
// artists are all "music" to them.
export const KIND_GROUPS = ["music", "film", "show", "book", "place", "event", "dish", "activity"] as const;
export type KindGroup = (typeof KIND_GROUPS)[number];
export const groupOf = (kind: ItemKind): KindGroup => (kind === "song" || kind === "album" || kind === "artist" ? "music" : kind);

// What the next plan owes the last visit (worked out in lib/feedback.ts).
export interface Wishes {
  more: { group: KindGroup; atLeast: number }[]; // kinds that landed: the plan must hold at least this many
  avoid: KindGroup[]; // kinds that went badly: none of these
  noRepeat: string[]; // titles already suggested for an earlier visit
}
const EvidenceIds = z.array(z.string().regex(/^E\d+$/)).min(1).max(6);

const Item = z.object({
  title: z.string().trim().min(1).max(120),
  kind: Kind,
  evidence: EvidenceIds,
});

export const DraftPlanSchema = z.object({
  bridge: Item.extend({ why: z.string().trim().min(1).max(400) }),
  // The planner is asked for five and the page shows four (SHOWN_MOMENTS), so one can fail a check and four remain.
  moments: z.array(Item.extend({ what_to_do: z.string().trim().min(1).max(400) })).min(3).max(5),
  // The planner sometimes sends the questions as plain strings (seen on 2026-10-11). Taking both forms saves a
  // correction, which costs money and seconds for nothing. It is asked for five and the page shows three
  // (SHOWN_QUESTIONS), so a question that fails a check, in English or in translation, has a spare behind it.
  questions: z.array(z.preprocess((q) => (typeof q === "string" ? { text_en: q } : q), z.object({ text_en: z.string().trim().min(5).max(240) }))).min(3).max(6),
});
export type DraftPlan = z.infer<typeof DraftPlanSchema>;
export const SHOWN_QUESTIONS = 3;

export interface Question {
  native: string;
  english: string;
}

export interface FinalPlan {
  // affinity: Qloo's own numbers for the bridge, with each person's favorites (0 to 1), when the bridge was chosen
  // by them (lib/bridge.ts). The page shows them on the card.
  // beyondFame: what the most popular of its kind score with the same two tastes, at the middle of the list. Set
  // only when the bridge is not on that list and is above the middle on both sides. The page shows it for scale.
  // fameMissed: the same numbers when the bridge did not pass, with whether it is on the list. The card says so.
  bridge: DraftPlan["bridge"] & {
    affinity?: { grandparent: number; visitor: number };
    beyondFame?: { of: number; grandparent: number; visitor: number };
    fameMissed?: { of: number; grandparent: number; visitor: number; listed: boolean };
  };
  // where: for a place, the address as Qloo gives it. It is copied from the evidence in code (lib/agent.ts), so the
  // planner never writes an address.
  moments: (DraftPlan["moments"][number] & { where?: string })[];
  questions: Question[];
  language: string;
  evidence: { id: string; source: string; label: string; urls: string[] }[];
  costUsd: number;
}

// Pulls the first JSON object out of a model reply (models sometimes wrap it in a code fence or a sentence).
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced?.[1] ?? text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in the reply");
  return JSON.parse(body.slice(start, end + 1));
}

// A snippet from a web page is not proof of when something happens. On 2026-10-11 a real plan took a ticket-sale date
// from a festival's home page for the date of the festival, which was six months away. So an event card may say what
// the event is, and must leave the when and the where to the page it links to. The planner is told so; this makes
// sure of it. Any figure counts: a street number, a time, a price and a year are all things nobody has checked.
export const EVENT_NOTE = "Found on the web and not checked. Look at its page for what is on, and when, before you go.";
const WHEN =
  /\b(january|february|march|april|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday|tonight|tomorrow|weekend)\b|\bmay \d|\b\d{1,2}(st|nd|rd|th)\b|\b\d{1,2}(:\d{2})? ?(am|pm)\b|\b\d{1,2}\/\d{1,2}\b|\b(this|next) (week|month|year)\b/i;
const OWN_WORDS = new Set(["dish", "activity"]);

export interface PlanProblem {
  scope: "bridge" | "moment" | "question" | "plan";
  index: number; // which moment or question; 0 for the bridge and for the plan as a whole
  text: string;
  soft?: true; // about the last visit's feedback, not about grounding: worth one correction, never a reason to drop the plan
}

// What a card stands on, read from the evidence it cites and never from the label the planner gave it. On 2026-10-11
// a real plan called a festival found on the web a "place" and gave it a street address: the rules for web leads
// (a plain caution, no date, left out of a saved plan) were tied to the label "event", so a different label walked
// past all of them. Now the evidence decides: a card named in Qloo's results is what Qloo says it is; a dish or an
// activity must share a word with what the family said; and anything named only on a web page is an event to check.
type Standing = Source | null;
type Cited = { title: string; kind: ItemKind; evidence: string[] };
const QLOO_KIND: Partial<Record<string, ItemKind>> = { movie: "film", film: "film", tv_show: "show", show: "show", artist: "artist", book: "book", place: "place", destination: "place" };
const citedFrom = (item: Cited, ledger: Ledger, source: Source) => item.evidence.filter((id) => ledger.get(id)?.source === source);

function standing(item: Cited, ledger: Ledger): Standing {
  if (ledger.supports(item.title, citedFrom(item, ledger, "qloo"))) return "qloo";
  if (OWN_WORDS.has(item.kind) && ledger.shares(item.title, citedFrom(item, ledger, "family"))) return "family";
  const web = citedFrom(item, ledger, "tavily");
  return ledger.supports(item.title, web) || ledger.mentions(item.title, web) ? "tavily" : null;
}

// The kind a card should have, when its evidence says something else than its label. Songs, albums and artists are
// one group, so a song by an artist Qloo named keeps its label.
function kindByEvidence(item: Cited, ledger: Ledger): ItemKind | null {
  const stands = standing(item, ledger);
  if (stands === "tavily") return item.kind === "event" ? null : "event";
  if (stands !== "qloo") return null;
  const qloo = QLOO_KIND[ledger.kindOf(item.title, citedFrom(item, ledger, "qloo")) ?? ""];
  return qloo && groupOf(qloo) !== groupOf(item.kind) ? qloo : null;
}

// A dish or an activity from the family's own words: saying that they love it, or know it by heart, is simply true.
// A singer or a film they listed gets no such leave, because a card about one says a good deal more than that
// ("the same depth she loves in her favorite music", from a real plan).
const saysItIsTheirs = (item: Cited, favorites: string[]) => OWN_WORDS.has(item.kind) && isOwnFavorite(item.title, favorites);

// What the family typed themselves. Their favorites are the names of the "family" evidence; the city and the
// language sit in its context.
const favoritesIn = (ledger: Ledger) => ledger.items.filter((i) => i.source === "family").flatMap((i) => i.names);
function questionContext(plan: DraftPlan, ledger: Ledger): QuestionContext {
  return {
    titles: [plan.bridge.title, ...plan.moments.map((m) => m.title)],
    said: ledger.items.filter((i) => i.source === "family").flatMap((i) => [...i.names, i.context ?? ""]),
    known: ledger.items.filter((i) => i.source === "qloo").flatMap((i) => [...i.names, i.context ?? ""]),
  };
}

// Everything a plan must satisfy before anyone sees it (empty means grounded, and true to the last visit's feedback).
export function checkPlan(plan: DraftPlan, ledger: Ledger, wishes?: Wishes): PlanProblem[] {
  const problems: PlanProblem[] = [];
  const items = [
    { scope: "bridge" as const, index: 0, where: "bridge", ...plan.bridge },
    ...plan.moments.map((m, i) => ({ scope: "moment" as const, index: i, where: `moment ${i + 1}`, ...m })),
  ];
  for (const item of items) {
    const missing = item.evidence.filter((id) => !ledger.get(id));
    if (missing.length) {
      problems.push({ scope: item.scope, index: item.index, text: `${item.where} "${item.title}" cites unknown evidence ${missing.join(", ")}` });
      continue;
    }
    // Dishes and activities may come from the family's own words; everything else must be named in its evidence.
    // An event may be titled in the planner's own words, as long as every word comes from the web page it cites.
    const stands = standing(item, ledger);
    if (!stands) {
      problems.push({ scope: item.scope, index: item.index, text: `${item.where} "${item.title}" is not named in its evidence ${item.evidence.join(", ")}` });
      continue;
    }
    // withEvidenceKinds has already set these right for a draft; a plan that skipped it does not get past here.
    const kind = kindByEvidence(item, ledger);
    if (item.scope === "bridge" && stands === "tavily") {
      problems.push({ scope: "bridge", index: 0, text: `the bridge "${item.title}" is named only on a web page; the bridge must be a name from Qloo evidence` });
    } else if (kind) {
      const why = stands === "tavily" ? "is named only on a web page, so it is a lead to check" : "is named in Qloo's results";
      problems.push({ scope: item.scope, index: item.index, text: `${item.where} "${item.title}" ${why}: its kind is ${kind}, not ${item.kind}` });
    }
  }
  plan.moments.forEach((m, i) => {
    if (normalizeName(m.title) === normalizeName(plan.bridge.title)) problems.push({ scope: "moment", index: i, text: `moment ${i + 1} repeats the bridge "${m.title}"` });
  });
  const bridgeSources = new Set(plan.bridge.evidence.map((id) => ledger.get(id)?.source));
  if (!bridgeSources.has("qloo")) problems.push({ scope: "bridge", index: 0, text: "the bridge must cite Qloo evidence" });
  // Wording (lib/wording.ts). tidied() repairs all of this without a model call, so a draft never comes back for it.
  const context = questionContext(plan, ledger);
  plan.questions.forEach((q, i) => {
    const why = withKnownNames(q.text_en) !== q.text_en ? "names someone in braces other than {grandparent} and {visitor}" : questionProblem(q.text_en, context);
    if (why) problems.push({ scope: "question", index: i, text: `question ${i + 1} ${why}` });
  });
  const favorites = favoritesIn(ledger);
  for (const item of items) {
    const text = item.scope === "bridge" ? plan.bridge.why : plan.moments[item.index]!.what_to_do;
    if (withKnownNames(text) !== text) problems.push({ scope: item.scope, index: item.index, text: `${item.where} "${item.title}" names someone in braces other than {grandparent} and {visitor}` });
    const claim = saysItIsTheirs(item, favorites) ? undefined : withoutClaims(text, favorites).found[0];
    if (claim) problems.push({ scope: item.scope, index: item.index, text: `${item.where} "${item.title}" says what they already love or lived ("${claim}"), which the family did not tell us; put it as a hope ("may", "might") or name one of their own favorites` });
  }
  if (wishes) {
    const seen = new Set(wishes.noRepeat.map(normalizeName));
    for (const item of items) {
      const group = groupOf(item.kind);
      if (wishes.avoid.includes(group)) {
        problems.push({ scope: item.scope, index: item.index, soft: true, text: `${item.where} "${item.title}" is a ${item.kind}; after the last visit the family asked for no ${group} this time` });
      } else if (seen.has(normalizeName(item.title))) {
        problems.push({ scope: item.scope, index: item.index, soft: true, text: `${item.where} "${item.title}" was already suggested for an earlier visit; suggest something new` });
      }
    }
    for (const { group, atLeast } of wishes.more) {
      const have = items.filter((i) => groupOf(i.kind) === group).length;
      if (have < atLeast) {
        problems.push({ scope: "plan", index: 0, soft: true, text: `the plan has ${have} ${group} ${have === 1 ? "item" : "items"}; ${group} landed last time, so include at least ${atLeast} (bridge and moments together)` });
      }
    }
  }
  return problems;
}

// Each card gets the kind its evidence gives it, whatever the planner called it: a web lead is an event, a film Qloo
// named is a film. The rules that follow (the caution on an event, "no film this time") then cannot be dodged by a
// label. Done here rather than by sending the plan back: it costs nothing, and it cannot fail.
export function withEvidenceKinds(plan: DraftPlan, ledger: Ledger): DraftPlan {
  const bridgeKind = standing(plan.bridge, ledger) === "qloo" ? kindByEvidence(plan.bridge, ledger) : null;
  return {
    ...plan,
    bridge: bridgeKind ? { ...plan.bridge, kind: bridgeKind } : plan.bridge,
    moments: plan.moments.map((m) => {
      const kind = kindByEvidence(m, ledger);
      return kind ? { ...m, kind } : m;
    }),
  };
}

// An event card that states a date, a day, a time or any figure (a street number, a price) has that sentence
// replaced by a plain caution.
export function withoutEventDates(plan: DraftPlan): DraftPlan {
  return { ...plan, moments: plan.moments.map((m) => (m.kind === "event" && (WHEN.test(m.what_to_do) || /\d/.test(m.what_to_do)) ? { ...m, what_to_do: EVENT_NOTE } : m)) };
}

// What a card says when none of the planner's sentences about it could be kept: the first line of its kind. The
// others are for a second or a third such card in the same plan (withDistinctLines).
const PLAIN_DO: Record<KindGroup, readonly [string, ...string[]]> = {
  music: [
    "Play a little of this music together and see what you each make of it.",
    "Put on a song or two while you sit together, and say what you each hear in it.",
    "Listen to one piece all the way through, side by side.",
    "Let a few of these songs play quietly while you talk.",
  ],
  film: [
    "Watch it together, and stop whenever there is something to talk about.",
    "Put it on one evening and watch as much of it as feels right.",
    "Watch the first half hour together, then decide whether to go on.",
    "Pick one scene to watch together, and talk about it afterwards.",
  ],
  show: ["Watch an episode together, and stop whenever there is something to talk about.", "Put on one episode and see whether you both want another."],
  book: ["Read a few pages aloud together.", "Take turns reading a page each."],
  place: ["Go together, at an easy pace.", "Stop by together and stay as long as it is pleasant."],
  event: [EVENT_NOTE],
  dish: ["Make it together, side by side.", "Cook it together and taste as you go."],
  activity: ["Do it together, at an easy pace.", "Try it together for a little while, with no hurry."],
};
const plainFor = (kind: ItemKind) => PLAIN_DO[groupOf(kind)][0];

// A draft, set right by rule before it is checked: kinds from the evidence, no figures on a web lead, no sentence
// that says what they already love or lived unless the family said so, and no question that assumes a fact about
// their life. "notes" are lines for the page, so the family sees what was taken out.
export function tidied(draft: DraftPlan, ledger: Ledger): { plan: DraftPlan; notes: string[] } {
  const plan = withoutEventDates(withEvidenceKinds(draft, ledger));
  const favorites = favoritesIn(ledger);
  let cut = 0;
  const clean = (item: Cited, written: string, plain: string) => {
    const text = withKnownNames(withoutLongDashes(written)); // {grandfather} is {grandparent}; any other name in braces cannot be shown
    if (text === null) return plain;
    if (saysItIsTheirs(item, favorites)) return text;
    const { kept, found } = withoutClaims(text, favorites);
    cut += found.length;
    return kept ?? plain;
  };
  const bridge = { ...plan.bridge, why: clean(plan.bridge, plan.bridge.why, PLAIN_WHY) };
  const moments = plan.moments.map((m) => ({ ...m, what_to_do: clean(m, m.what_to_do, plainFor(m.kind)) }));

  const context = questionContext(plan, ledger);
  const seen = new Set<string>();
  const good = plan.questions.flatMap((q) => {
    const text_en = withKnownNames(withoutLongDashes(q.text_en));
    const key = normalizeName(text_en ?? "");
    if (text_en === null || seen.has(key) || questionProblem(text_en, context)) return [];
    seen.add(key);
    return [{ text_en }];
  });
  const leftOut = plan.questions.length - good.length;
  // Too few left: plain questions that assume nothing, those about what is in the plan first.
  const groups = new Set([bridge, ...moments].map((i) => groupOf(i.kind)));
  const fits = [groups.has("music"), groups.has("film") || groups.has("show"), groups.has("dish"), true];
  const stock = [...STOCK_QUESTIONS.filter((_, i) => fits[i]), ...STOCK_QUESTIONS.filter((_, i) => !fits[i])];
  for (const text_en of stock) {
    if (good.length >= SHOWN_QUESTIONS) break;
    if (!seen.has(normalizeName(text_en))) good.push({ text_en });
  }

  const notes = [
    ...(cut ? [`Took out ${cut === 1 ? "a sentence" : `${cut} sentences`} that said more about them than the family told us`] : []),
    ...(leftOut ? [`Left out ${leftOut === 1 ? "a question" : `${leftOut} questions`} that assumed something about their life`] : []),
  ];
  return { plan: { ...plan, bridge, moments, questions: good }, notes };
}

// What the page shows: four moments at most. A fifth is given up from the end, sparing a kind the last visit asked
// for more of where there is something else to give up.
export const SHOWN_MOMENTS = 4;
export function withShownMoments(plan: DraftPlan, wishes?: Wishes, ledger?: Ledger): DraftPlan {
  const moments = [...plan.moments];
  const wanted = new Set(wishes?.more.map((m) => m.group));
  // With the evidence at hand, two more things are spared: Qloo's own finds, down to the two a plan should hold
  // (withQlooFinds), and the first card in the family's own words, so a plan is never only what Qloo found either.
  const favorites = ledger ? favoritesIn(ledger) : [];
  const isFind = (m: Cited) => Boolean(ledger) && isQlooFind(m, ledger!, favorites);
  const theirOwn = ledger ? moments.find((m) => standing(m, ledger) === "family") : undefined;
  while (moments.length > SHOWN_MOMENTS) {
    const needed = moments.filter(isFind).length <= WANTED_FINDS;
    const free = (m: Cited) => !wanted.has(groupOf(m.kind));
    const spare = [moments.findLastIndex((m) => free(m) && m !== theirOwn && !(needed && isFind(m))), moments.findLastIndex(free)].find((i) => i >= 0);
    moments.splice(spare ?? moments.length - 1, 1);
  }
  return { ...plan, moments };
}

// A plan is worth more than the family's own lists read back to them. On 2026-10-11 a plan for a family typed into
// the form held, beyond the bridge, only what they had listed themselves: three of their own singers and two things
// in their own words. Qloo's suggestions for both of them were all in the evidence the planner read. The rule it
// broke ("at most one moment may be a work or artist they listed themselves") was an instruction and nothing more.
// So, in code: one of their own works or artists is enough, and a plan holds at least two of Qloo's own finds
// beyond the bridge, as far as Qloo offered any.
export const WANTED_FINDS = 2;
export interface Find {
  title: string;
  kind: ItemKind;
  evidence: string[];
}
const isQlooFind = (item: Cited, ledger: Ledger, favorites: string[]) => standing(item, ledger) === "qloo" && !isOwnFavorite(item.title, favorites);

// What Qloo itself suggested and the family did not list, one name from each list of suggestions in turn: the
// grandparent's lists first, then the visitor's, then those for both (places). So the first few are from both
// sides. Ranked by the bridge check alone they were all from the visitor's side, and a plan recorded that way had
// nothing new from the grandparent's own world (2026-10-11). Nothing the last visit ruled out.
export function qlooFinds(ledger: Ledger, wishes?: Wishes): Find[] {
  const favorites = favoritesIn(ledger);
  const ruledOut = new Set((wishes?.noRepeat ?? []).map(normalizeName));
  const side = (who: string | undefined) => (who === "grandparent" ? 0 : who === "visitor" ? 1 : 2);
  const named = (item: Ledger["items"][number]) => item.names.map((title, at) => ({ title, kind: QLOO_KIND[item.kinds?.[at] ?? ""], evidence: [item.id] }));
  const suggested = ledger.items.filter((i) => i.source === "qloo" && i.tool === "insights").sort((a, b) => side(a.asked?.who) - side(b.asked?.who));
  const lists = suggested.map(named);
  const inTurn = Array.from({ length: Math.max(0, ...lists.map((l) => l.length)) }, (_, row) => lists.flatMap((l) => (l[row] ? [l[row]] : []))).flat();
  // The bridge check names some of the same things: it adds its evidence to them, and its own names come last.
  const checked = ledger.items.filter((i) => i.source === "qloo" && i.tool === "bridge_check").flatMap(named);
  const finds = new Map<string, Find>();
  for (const { title, kind, evidence } of [...inTurn, ...checked]) {
    const key = normalizeName(title);
    if (!kind || !key || ruledOut.has(key) || wishes?.avoid.includes(groupOf(kind)) || isOwnFavorite(title, favorites)) continue;
    const had = finds.get(key);
    finds.set(key, had ? { ...had, evidence: [...new Set([...had.evidence, ...evidence])] } : { title, kind, evidence });
  }
  return [...finds.values()];
}

// Holds a draft to the rule above, with no model call: a second or third of their own works gives its place to one
// of Qloo's finds, and finds are added until there are two. A card that is added says the plain line for its kind.
export function withQlooFinds(plan: DraftPlan, ledger: Ledger, wishes?: Wishes): { plan: DraftPlan; added: number } {
  const favorites = favoritesIn(ledger);
  const taken = new Set([plan.bridge.title, ...plan.moments.map((m) => m.title)].map(normalizeName));
  const waiting = qlooFinds(ledger, wishes).filter((f) => !taken.has(normalizeName(f.title)));
  const card = (f: Find) => ({ title: f.title, kind: f.kind, what_to_do: plainFor(f.kind), evidence: f.evidence });
  let ownWorks = 0;
  let added = 0;
  const moments = plan.moments.map((m) => {
    if (OWN_WORDS.has(m.kind) || !isOwnFavorite(m.title, favorites) || ++ownWorks === 1 || !waiting.length) return m;
    added += 1;
    return card(waiting.shift()!);
  });
  while (moments.filter((m) => isQlooFind(m, ledger, favorites)).length < WANTED_FINDS && waiting.length) {
    added += 1;
    moments.push(card(waiting.shift()!));
  }
  return { plan: { ...plan, moments }, added };
}

// No two cards of a plan say the same sentence. On 2026-10-12 a plan after "more music" showed two artists with one
// sentence between them: the planner had claimed too much about both, a rule had taken each sentence out, and each
// card had fallen back on the one plain line there was for music. A find that the code puts in says that line too.
// So a card that repeats an earlier one takes the next plain line of its kind that the plan has not used. The
// caution on a web lead is left alone: it is a warning, and it should read the same every time.
export function withDistinctLines(plan: DraftPlan): DraftPlan {
  const used = new Set<string>();
  const moments = plan.moments.map((m) => {
    const repeated = m.what_to_do !== EVENT_NOTE && used.has(normalizeName(m.what_to_do));
    const text = repeated ? (PLAIN_DO[groupOf(m.kind)].find((line) => !used.has(normalizeName(line))) ?? m.what_to_do) : m.what_to_do;
    used.add(normalizeName(text));
    return text === m.what_to_do ? m : { ...m, what_to_do: text };
  });
  return { ...plan, moments };
}

// The same, as the sentences sent back to the planner.
export function groundingProblems(plan: DraftPlan, ledger: Ledger, wishes?: Wishes): string[] {
  return checkPlan(plan, ledger, wishes).map((p) => p.text);
}

// A plan still in trouble after its one correction is kept if leaving out some moments is enough: those with a
// grounding problem, and those that go against the last visit's feedback. Two must remain. A grounding problem with
// the bridge or a question still fails the whole plan. A feedback wish that is still unmet does not: the plan is
// kept and "unmet" says what it could not follow.
export function withoutUnsupportedMoments(plan: DraftPlan, ledger: Ledger, wishes?: Wishes): { plan: DraftPlan; dropped: number; unmet: string[] } | null {
  const problems = checkPlan(plan, ledger, wishes);
  if (!problems.length || problems.some((p) => p.scope !== "moment" && !p.soft)) return null;
  const bad = new Set(problems.filter((p) => p.scope === "moment").map((p) => p.index));
  const moments = plan.moments.filter((_, i) => !bad.has(i));
  if (moments.length < 2) return null;
  const kept = { ...plan, moments };
  return { plan: kept, dropped: bad.size, unmet: checkPlan(kept, ledger, wishes).map((p) => p.text) };
}
