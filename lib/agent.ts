import type { Limits } from "./config";
import { chooseBridge } from "./bridge";
import { Ledger } from "./evidence";
import { youthWindow, type Family } from "./family";
import { gatherBrief, planBrief, readFeedback, wishesLine } from "./feedback";
import type { ChatMessage, LLM } from "./llm";
import { DraftPlanSchema, extractJson, groundingProblems, qlooFinds, SHOWN_QUESTIONS, tidied, WANTED_FINDS, withoutUnsupportedMoments, withQlooFinds, withShownMoments, type DraftPlan, type FinalPlan, type Question, type Wishes, withDistinctLines } from "./plan";
import type { QlooApi } from "./qloo";
import { CapReached, pausedMessage, type SpendGuard } from "./spend";
import type { TavilyApi } from "./tavily";
import { runToolCalls, toolSpecs, type ToolContext } from "./tools";
import { PLAIN_WHY, translationProblem, withoutLongDashes } from "./wording";

// Who did a step: one of the three Nemotron models, or a rule in code that calls no model. The page shows it beside
// each step, so the routing between the models can be read off a run.
export type Doer = "nano" | "super" | "ultra" | "rule";

export type AgentEvent =
  | { type: "step"; text: string; by: Doer }
  | { type: "tool"; name: string; ok: boolean; summary: string; evidence?: string; names?: string[]; by: Doer }
  | { type: "bridge"; bridge: FinalPlan["bridge"]; evidence: FinalPlan["evidence"] } // the first card, as soon as it is settled
  | { type: "plan"; plan: FinalPlan }
  | { type: "error"; code: "cap" | "no_plan" | "upstream" | "allowance"; message: string }
  | { type: "done"; costUsd: number; ms: number };

export interface AgentDeps {
  llm: LLM;
  qloo: QlooApi | null;
  tavily: TavilyApi | null;
  guard: SpendGuard;
  limits: Limits;
  now?: () => Date;
}

const MAX_TOOL_ROUNDS = 12;

// Three replies, each holding every call of its step. The calls of one reply run at the same time, so the wait is
// the slowest call, not their sum; and each reply re-sends everything before it, so fewer replies cost less. Measured
// on 2026-10-11, before this: 7 to 10 replies, about $0.015 and 15 to 35 s of gathering for one plan.
function gatherPrompt(family: Family, today: Date, wishes: Wishes | null): string {
  const { min, max } = youthWindow(family.grandparent.birthYear);
  const last = family.history.at(-1);
  const brief = wishes && last ? gatherBrief(wishes, last) : null;
  const city = family.grandparent.city;
  const twice = "twice: type movie, and type artist";
  const each = brief ? `once for each of these types: ${brief.types.join(", ")}` : twice;
  return [
    "You gather evidence for planning a family visit between a grandparent and a younger visitor.",
    "Use the tools; never invent ids, titles or events. You have three replies. The calls of one reply run at the same",
    "time, so put every call of a step in that one reply.",
    ...(wishes ? [`${wishesLine(wishes)}. That is why the types below are what they are.`] : []),
    `Reply 1: qloo_search each favorite of both people that names a work, artist or place (skip dishes and habits), saying whose favorite it is.${brief?.signals.length ? ` Also qloo_search what landed last time, for the grandparent: ${brief.signals.join(", ")}.` : ""}`,
    ...(city ? ["In the same reply, if a favorite names a dish or a food, call qloo_tags once with the one word that names the food."] : []),
    "Reply 2, all in one reply, with the ids from reply 1. In every call for a person pass that person's ids, films and",
    "artists together, whatever type you ask for:",
    brief
      ? `- qloo_insights for the grandparent, ${each}. Signal ids: the grandparent's${brief.signals.length ? ", plus the ids of what landed last time" : ""}. For movie or tv_show add release years ${min}-${max} (their youth). Use age 55_and_older for the grandparent.`
      : `- qloo_insights for the grandparent from their ids, twice: type movie with release years ${min}-${max} (their youth), and type artist. Use age 55_and_older for the grandparent.`,
    `- qloo_insights for the visitor from their ids, ${each}.`,
    "- qloo_compare the grandparent's ids with the visitor's ids: it returns the traits their two tastes share.",
    ...(city ? [`- if qloo_tags found a kind of place: one qloo_insights with type place and "for": "both", with ids of both of them. It finds such places near ${city}.`] : []),
    ...(brief && !brief.web ? [] : city ? [`- one web_search for a public event this month in ${city} that fits what they love. It does not need the Qloo results: build the query from the city and their favorites.`] : []),
    ...(brief?.never.length ? [`Never call qloo_insights with type ${brief.never.join(" or ")}: that did not suit them last time.`] : []),
    "Reply 3: the single word done. Before it you may repeat, once, a call that failed.",
    `Today is ${today.toISOString().slice(0, 10)}.`,
  ].join("\n");
}

// Earlier visits, as the models read them. The family's own note is for the planner only (see searcherText).
function historyText(family: Family, withNotes: boolean): string {
  if (!family.history.length) return "No earlier visits.";
  const cards = (items: { title: string; kind: string }[]) => items.map((i) => `${i.title} (${i.kind})`).join(", ") || "-";
  return family.history
    .map((h, i) => `Visit ${i + 1}: landed: ${cards(h.landed)}; not marked as landed: ${cards(h.rest)}${withNotes && h.note ? `; note: ${h.note}` : ""}`)
    .join("\n");
}

// What the planner (Nemotron 3 Ultra) reads about the family: everything the browser sent. It calls no tool, so none
// of it goes further than Nebius.
function familyText(family: Family): string {
  return JSON.stringify({
    grandparent: { relation: family.grandparent.relation ?? "grandparent", born: family.grandparent.birthYear, first_language: family.grandparent.language, city: family.grandparent.city ?? null, favorites: family.grandparent.favorites },
    visitor: { favorites: family.visitor.favorites },
  });
}

// What the gathering model (Nemotron 3 Super) reads about the family. It writes the searches that go to Qloo and to
// the web, so it is given only what those searches are for: the two lists of favorites and what was suggested
// before. Its instructions add the years of the grandparent's youth and the city. It never sees the language,
// grandmother or grandfather, or a note written after a visit, so none of those can reach Qloo or Tavily. The
// privacy note on the page says exactly this, and tests/privacy.test.ts holds the code to it.
function searcherText(family: Family): string {
  return `Family: ${JSON.stringify({ grandparent: { favorites: family.grandparent.favorites }, visitor: { favorites: family.visitor.favorites } })}\nEarlier visits:\n${historyText(family, false)}`;
}

const PLAN_RULES = [
  "You write a visit plan from evidence only. Reply with one JSON object and nothing else:",
  '{"bridge":{"title","kind","why","evidence":["E.."]},"moments":[{"title","kind","what_to_do","evidence":["E.."]}],"questions":[{"text_en"}]}',
  "kind is one of: song, album, artist, film, show, book, place, event, dish, activity.",
  "bridge: ONE item both would love, the first thing to share. If the message names the bridge, use exactly that one.",
  "Otherwise its title must be a name from Qloo evidence, ideally evidence that reflects both people.",
  "why: one or two warm sentences on what in it may speak to each of them.",
  "In why and what_to_do, talk to the family: never mention Qloo, evidence, lists, scores or affinity. The page shows those.",
  "Everything here is a suggestion, and nobody has asked them yet. So put it as a hope: \"may\", \"might\", \"could\".",
  "Never state what either of them loves, likes, enjoys, knows, remembers or grew up with, and never speak of their",
  "memories, their past or their heritage, unless the same sentence names one of their own favorites as given.",
  "Wrong: \"the classic cinema she adores\", \"the music {grandparent} grew up with\", \"a style you both enjoy\",",
  "\"{grandparent}'s love for old films\", \"close to both of their hearts\".",
  "Right: \"its songs may speak to {grandparent}, who loves [one of her favorites as given]\". A sentence that breaks",
  "this is taken out whole, so keep sentences short.",
  "moments: exactly 5 small things to do together (music to start with, a film, a dish to cook, an outing), each",
  "different from the others. The page shows four, so one may be left out.",
  "Prefer what Qloo discovered over the favorites they already named: at most one moment may be a work or artist",
  "they listed themselves, and at least two moments must be from the list headed \"Qloo's own finds\" in the message.",
  "The code holds the plan to both. Include one dish or activity from their own words if it fits.",
  "Each title must be a name that appears in the evidence it cites. Dishes and activities may cite the family's own words.",
  "A title is the name alone: leave out the note in brackets after it (a year, a director, an address).",
  "Compare evidence lists traits both tastes share (a genre, a theme, an instrument). Use them in the bridge's why,",
  "in everyday words (\"Latin music\", \"love stories\"), never as a list of labels. A trait is never a title.",
  "Write {grandparent} and {visitor} wherever you refer to them, exactly so, whatever their relation: the page fills",
  "in their names. Nothing is known about {visitor}: never write he or she for them.",
  "Moments must not repeat the bridge. what_to_do must not add facts the evidence does not state: no invented",
  "dates, performers, showtimes or prices.",
  "Anything found only by a web search is kind event, never place: a place is a name from Qloo place evidence.",
  "If the evidence holds Qloo place insights, one moment may be an outing to one of those places (kind place). Say",
  "what the two of them might do there, as a hope. Do not give its address: the page shows the address from Qloo.",
  "An event from a web search is a lead to check, not a fact: the page behind it may be old, or about something else.",
  "Leave it out if its evidence shows it is over or is not near them. If you use one, say what it is and to check its",
  "page before going. Never give a date, a day, a time, a price, a street address or a performer for an event.",
  "Keep each question under 25 words, spoken by {visitor} to {grandparent}.",
  "questions: exactly 5 open questions that invite stories, tied to the plan. The page shows three, so two may be",
  'left out. Never quiz memory: no "do you remember". Warm, simple English, in words that translate plainly: no idioms.',
  "A question must not assume anything about their life that the family did not say: no husband or wife, no mother,",
  "father, grandmother or other relative, no hometown or country, no job, no school, no faith, and nothing the two of",
  "them did together long ago. Ask about the plan and about what they like. The city given is only where the",
  "grandparent lives now. A question that breaks this is left out.",
  "If the message has a part headed \"After the last visit\", it comes first: follow it to the letter.",
].join("\n");

// Stage 1, on its own so it can be tried alone: Nemotron 3 Super with tools, thinking off (fast and cheap). Returns
// how many replies it took: each reply re-sends everything before it, so the count is most of what gathering costs.
export async function gatherEvidence(family: Family, deps: AgentDeps, ctx: ToolContext, wishes: Wishes | null, emit: (event: AgentEvent) => void): Promise<{ replies: number }> {
  const now = deps.now ?? (() => new Date());
  const messages: ChatMessage[] = [
    { role: "system", content: gatherPrompt(family, now(), wishes) },
    { role: "user", content: searcherText(family) },
  ];
  const specs = toolSpecs();
  let replies = 0;
  let reminded = false;
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    // Temperature 0: the same family should be gathered the same way each time.
    const reply = await deps.llm.chat({ model: "super", messages, tools: specs, thinking: false, maxTokens: 1400, temperature: 0 });
    replies += 1;
    if (!reply.toolCalls.length) break;
    messages.push({ role: "assistant", content: reply.content || null, tool_calls: reply.toolCalls });
    // The calls of one reply go out together. Their outcomes come back in the order the model made them.
    let made = 0;
    for await (const outcome of runToolCalls(reply.toolCalls, ctx)) {
      const call = reply.toolCalls[made++]!;
      emit({ type: "tool", name: call.function.name, ok: outcome.ok, summary: outcome.summary, evidence: outcome.evidence, names: outcome.names, by: "super" });
      messages.push({ role: "tool", tool_call_id: call.id, content: outcome.content });
    }
    // Three failures and not one answer: Qloo is down. Asking again would only spend money on the model. The same
    // when this site's allowance refused a call and nothing has answered.
    if (qlooIsDown(ctx) || (ctx.qlooAllowanceUsed && ctx.qlooAnswers === 0)) break;
    // Now and then the model starts with one call per reply (seen on 2026-10-11: 12 replies and 33 s where 3 replies
    // do). Say so once, and only after a first reply: said later, it made the model invent calls it did not need.
    if (round === 0 && reply.toolCalls.length === 1 && !reminded) {
      reminded = true;
      messages.push({ role: "user", content: "Put all the other searches in your next reply, together, and then all of reply 2's calls in one reply: calls in one reply run at the same time." });
    }
  }
  return { replies };
}

export const newToolContext = (family: Family, deps: AgentDeps): ToolContext => ({
  qloo: deps.qloo,
  tavily: deps.tavily,
  ledger: new Ledger(),
  limits: deps.limits,
  city: family.grandparent.city,
  webSearches: 0,
  ids: { grandparent: [], visitor: [] },
  placeTags: [],
  qlooAnswers: 0,
  qlooFailures: 0,
});

export async function runPlan(family: Family, deps: AgentDeps, emit: (event: AgentEvent) => void): Promise<FinalPlan | null> {
  const started = Date.now();
  const now = deps.now ?? (() => new Date());
  const ctx = newToolContext(family, deps);
  const ledger = ctx.ledger;
  const finish = (plan: FinalPlan | null) => {
    emit({ type: "done", costUsd: round(deps.guard.planSpent), ms: Date.now() - started });
    return plan;
  };

  // Without Qloo there is nothing to ground a plan in: stop before spending anything on the models.
  if (!deps.qloo) {
    emit({ type: "error", code: "upstream", message: "Taste data is not connected yet, so no plan can be made right now." });
    return finish(null);
  }

  // The family's own words are evidence too, but only for dishes and activities (see groundingProblems). The city and
  // the language ride along as context: a question may use them, since the family gave them (lib/wording.ts).
  ledger.add({
    source: "family",
    tool: "input",
    label: "In the family's own words",
    names: [...family.grandparent.favorites, ...family.visitor.favorites],
    entityIds: [],
    urls: [],
    detail: null,
    context: `Language: ${family.grandparent.language}.${family.grandparent.city ? ` City: ${family.grandparent.city}.` : ""}`,
  });

  try {
    // 0. After an earlier visit: Nemotron 3 Nano reads how it went, and the rest of the run is held to it.
    let wishes: Wishes | null = null;
    if (family.history.length) {
      emit({ type: "step", text: "Reading how the last visit went", by: "nano" });
      wishes = await readFeedback(family.history, deps.llm);
      if (wishes) emit({ type: "step", text: wishesLine(wishes), by: "nano" });
    }

    // 1. Gather.
    emit({ type: "step", text: "Looking up their favorites in Qloo", by: "super" });
    await gatherEvidence(family, deps, ctx, wishes, emit);
    if (!ledger.items.some((i) => i.source === "qloo" && i.names.length)) {
      // The site's own allowance first: its refusals also count as failures, and Qloo is not to blame for them.
      if (ctx.qlooAllowanceUsed) {
        emit({ type: "error", code: "allowance", message: QLOO_ALLOWANCE_MESSAGE });
        return finish(null);
      }
      const message = qlooIsDown(ctx)
        ? "Qloo, where the taste data comes from, is not answering right now, so no plan can be made. Please try again in a few minutes."
        : "Qloo returned nothing usable for these favorites. Try different ones.";
      emit({ type: "error", code: "upstream", message });
      return finish(null);
    }

    // 1b. The bridge, chosen by Qloo's affinity with each of them (lib/bridge.ts) and shown at once. When Qloo's
    // answers do not allow it, the planner chooses the bridge below, as it used to.
    const chosen = await chooseBridge(ctx, wishes);
    const ledgerEvidence = () => ledger.items.map((i) => ({ id: i.id, source: i.source, label: i.label, urls: i.urls }));
    const affinity = chosen && { grandparent: round2(chosen.bridge.grandparent), visitor: round2(chosen.bridge.visitor) };
    // For scale, when the bridge is more than famous: what the most popular of its kind score with the same two tastes.
    const beyondFame = chosen?.beyondFame && { of: chosen.beyondFame.of, grandparent: round2(chosen.beyondFame.grandparent), visitor: round2(chosen.beyondFame.visitor) };
    // Or, when it did not pass, the same numbers and why: the card says so plainly (bus 015).
    const fameMissed = chosen?.fameMissed && { of: chosen.fameMissed.of, grandparent: round2(chosen.fameMissed.grandparent), visitor: round2(chosen.fameMissed.visitor), listed: chosen.fameMissed.listed };
    const measured = { ...(affinity ? { affinity } : {}), ...(beyondFame ? { beyondFame } : {}), ...(fameMissed ? { fameMissed } : {}) };
    if (chosen) {
      emit({ type: "tool", name: "qloo_bridge_check", ok: true, summary: chosen.summary, evidence: chosen.checkId, names: chosen.candidates.map((c) => c.title), by: "rule" });
      emit({
        type: "bridge",
        bridge: { title: chosen.bridge.title, kind: chosen.bridge.kind, why: PLAIN_WHY, evidence: chosen.bridge.evidence, ...measured },
        evidence: ledgerEvidence(),
      });
    }

    // 2. Plan: Nemotron 3 Ultra. The first draft is written without thinking, in two or three seconds. A draft the
    // checks send back gets to think: that is where the reasoning is worth its ten seconds and its cent.
    emit({ type: "step", text: "Writing the visit plan", by: "ultra" });
    const fixed = chosen
      ? `The bridge is already chosen, by Qloo's affinity with each of them: "${chosen.bridge.title}" (kind ${chosen.bridge.kind}, evidence ${chosen.bridge.evidence.join(", ")}). Use exactly this as the bridge and write its why. It is not a moment.\n`
      : "";
    // What Qloo suggested and they did not list, named outright, so the draft does not fall back on their own lists.
    const offered = qlooFinds(ledger, wishes ?? undefined).filter((f) => f.title !== chosen?.bridge.title).slice(0, 8);
    const finds = offered.length ? `Qloo's own finds, best first (none is on their lists): ${offered.map((f) => `"${f.title}" (${f.kind}, ${f.evidence.join(", ")})`).join("; ")}. At least ${Math.min(WANTED_FINDS, offered.length)} of the moments must be from these.\n` : "";
    const planMessages: ChatMessage[] = [
      { role: "system", content: PLAN_RULES },
      { role: "user", content: `Today is ${now().toISOString().slice(0, 10)}.\n${fixed}${finds}${wishes ? `${planBrief(wishes)}\n` : ""}Family: ${familyText(family)}\nEarlier visits:\n${historyText(family, true)}\n\nEvidence:\n${ledger.summary()}` },
    ];
    // Whatever the planner writes for it, the chosen bridge keeps its title, kind and evidence. Only the why is the planner's.
    const withChosenBridge = (plan: DraftPlan): DraftPlan =>
      chosen ? { ...plan, bridge: { ...plan.bridge, title: chosen.bridge.title, kind: chosen.bridge.kind, evidence: chosen.bridge.evidence } } : plan;
    const leftOut = (n: number) => emit({ type: "step", text: `Left out ${n === 1 ? "one suggestion" : `${n} suggestions`} that did not pass the checks`, by: "rule" });
    let draft: DraftPlan | null = null;
    let lastValid: DraftPlan | null = null;
    let problems: string[] = [];
    let notes: string[] = []; // what the wording rules took out of the draft that is kept
    let added = 0; // how many of Qloo's own finds the code had to put into it
    for (let attempt = 0; attempt < 2 && !draft; attempt++) {
      const thinking = attempt > 0;
      if (thinking) emit({ type: "step", text: "The checks sent the draft back, so it is written again, with more thought", by: "ultra" });
      let reply;
      try {
        reply = await deps.llm.chat({ model: "ultra", messages: planMessages, thinking, maxTokens: thinking ? 3500 : 1200, temperature: 0.4 });
      } catch (error) {
        // No room left under the plan's cost cap for the correction: go on with what the first draft can still give.
        if (error instanceof CapReached && error.kind === "plan" && lastValid) break;
        throw error;
      }
      try {
        // Set right by rule, at no cost, before anything is checked: kinds from the evidence, no figure on a web
        // lead, no claim about what they love or lived, no question that assumes a fact (lib/plan.ts, tidied).
        const tidy = tidied(withChosenBridge(DraftPlanSchema.parse(extractJson(reply.content))), ledger);
        // Then Qloo's own finds beyond the bridge: at least two, and one of their own listed works at most. Done
        // before the checks, so a wish from the last visit ("more music") is counted on the plan as it will be.
        const found = withQlooFinds(tidy.plan, ledger, wishes ?? undefined);
        const candidate = found.plan;
        lastValid = candidate;
        notes = tidy.notes;
        added = found.added;
        problems = groundingProblems(candidate, ledger, wishes ?? undefined);
        if (!problems.length) draft = candidate;
        else if (!thinking) {
          // A fast draft whose only faults are moments that can simply be left out needs no second call, as long as
          // three moments remain and nothing else is wrong.
          const trimmed = withoutUnsupportedMoments(candidate, ledger, wishes ?? undefined);
          if (trimmed && !trimmed.unmet.length && trimmed.plan.moments.length >= 3) {
            draft = trimmed.plan;
            leftOut(trimmed.dropped);
          }
        }
      } catch (error) {
        problems = [`the reply was not valid plan JSON: ${error instanceof Error ? error.message.slice(0, 200) : "parse error"}`];
      }
      if (!draft) {
        planMessages.push({ role: "assistant", content: reply.content }, { role: "user", content: `Fix these problems and reply with the corrected JSON only:\n- ${problems.join("\n- ")}` });
      }
    }
    // Still in trouble after one correction, or no money left for one: keep the plan if leaving out the moments at
    // fault is enough. A wish from the last visit that is still unmet does not cost the family their plan.
    const kept = !draft && lastValid ? withoutUnsupportedMoments(lastValid, ledger, wishes ?? undefined) : null;
    if (kept) {
      draft = kept.plan;
      if (kept.dropped) leftOut(kept.dropped);
      if (kept.unmet.length) emit({ type: "step", text: "This plan could not follow everything from the last visit", by: "rule" });
    }
    if (!draft) {
      emit({ type: "error", code: "no_plan", message: "Could not write a plan grounded in the evidence this time." });
      return finish(null);
    }
    // Once more, in case a check left out a find the planner wrote: the two that a plan should hold are topped up.
    const topped = withQlooFinds(draft, ledger, wishes ?? undefined);
    added += topped.added;
    if (added) emit({ type: "step", text: `Put in ${added === 1 ? "one of Qloo's own finds" : `${added} of Qloo's own finds`}: the draft leaned on what they had listed themselves`, by: "rule" });
    // Last of the rules, on the cards as they will be shown: no two of them say the same sentence.
    draft = withDistinctLines(withShownMoments(topped.plan, wishes ?? undefined, ledger));
    for (const text of notes) emit({ type: "step", text, by: "rule" });

    // The bridge with its own words now: show it, while the questions are still being put into the right language.
    const evidence = ledgerEvidence();
    const bridge: FinalPlan["bridge"] = { ...draft.bridge, ...measured };
    emit({ type: "bridge", bridge, evidence });

    // 3. Language: the questions in the grandparent's first language.
    const questions = await translateQuestions(draft, family.grandparent, deps.llm, emit);

    const plan: FinalPlan = {
      bridge,
      // A place card carries Qloo's own address for it, looked up in the evidence the card cites.
      moments: draft.moments.map((m) => {
        const where = m.kind === "place" ? ledger.noteOf(m.title, m.evidence) : undefined;
        return where ? { ...m, where } : m;
      }),
      questions,
      language: family.grandparent.language,
      evidence,
      costUsd: round(deps.guard.planSpent),
    };
    emit({ type: "plan", plan });
    return finish(plan);
  } catch (error) {
    if (error instanceof CapReached) {
      const message = error.kind === "plan" ? "This plan reached its cost limit before it finished." : pausedMessage(error.kind, now());
      emit({ type: "error", code: "cap", message });
      return finish(null);
    }
    emit({ type: "error", code: "upstream", message: "Something went wrong while planning. Please try again in a minute." });
    // Name and status only: upstream error text can echo what a visitor typed, and logs are kept by the host.
    const status = typeof (error as { status?: unknown })?.status === "number" ? (error as { status: number }).status : undefined;
    console.error("runPlan failed:", error instanceof Error ? error.name : "unknown", status ?? "");
    return finish(null);
  }
}

const qlooIsDown = (ctx: ToolContext) => ctx.qlooAnswers === 0 && ctx.qlooFailures >= 3;

// Said when this site has spent its own daily share of Qloo calls (QLOO_CALLS_PER_DAY). A plan whose answers are all
// cached still runs, so only a plan that got no answer at all ends here.
export const QLOO_ALLOWANCE_MESSAGE = "Live planning is paused for today: this site has used its daily allowance of Qloo calls. It starts again at midnight UTC.";

// The questions in the grandparent's own language are what this app is for, so the best writer does them:
// Nemotron 3 Ultra, thinking off. Tried side by side on 2026-10-11 in Hindi and Spanish: Nano and Super each made a
// plain grammar slip ("qué fue la primera película", a gender disagreement in Hindi) and Ultra made none, for $0.0004
// and under a second. Super is asked again for any question whose names Ultra got wrong.
const TRANSLATORS = ["ultra", "super"] as const;
// The form of address an elder is owed. Hindi was first written here with the familiar "tum" for a grandfather.
const RESPECT = "Address them the way that language shows respect to an elder (in Hindi आप, never तुम or तू); in Spanish keep the familiar tú.";

// Who the questions are spoken to. Spanish and many other languages mark it in the words themselves.
const ADDRESSEE = {
  grandmother: "their grandmother. She is a woman: use feminine forms for her",
  grandfather: "their grandfather. He is a man: use masculine forms for him",
  unknown: "a grandparent. Their gender is not known: choose wording that fits either",
};

async function translateQuestions(draft: DraftPlan, grandparent: Family["grandparent"], llm: LLM, emit: (e: AgentEvent) => void): Promise<Question[]> {
  const language = grandparent.language;
  // The draft may hold spare questions. All of them are translated, and the first three whose translation passes the
  // checks are shown, so a slip costs a question and not the family's language.
  const english = draft.questions.map((q) => q.text_en);
  const titles = [draft.bridge.title, ...draft.moments.map((m) => m.title)];
  if (/^english$/i.test(language.trim())) return english.slice(0, SHOWN_QUESTIONS).map((e) => ({ native: e, english: e }));
  emit({ type: "step", text: `Putting the questions in ${language}`, by: "ultra" });
  let best: (string | null)[] = english.map(() => null);
  for (const model of TRANSLATORS) {
    if (model !== TRANSLATORS[0]) emit({ type: "step", text: "Asking a second model for the questions whose wording did not pass", by: model });
    const reply = await llm.chat({
      model,
      thinking: false,
      maxTokens: 900,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: `Translate each question into warm, natural ${language} as a grandchild would say it to ${ADDRESSEE[grandparent.relation ?? "unknown"]}. ${RESPECT} Say it the way a native speaker would, not word for word. Nothing is known about the grandchild: where the language marks the two of them as men or women, use its generic form. Never translate the title of a film, a song or a book, or a person's name: keep it as written, or write its sound in the script of ${language}. Keep {grandparent} and {visitor} exactly where the English has them and add no others. Reply with a JSON array of ${english.length} strings, in order, nothing else.`,
        },
        { role: "user", content: JSON.stringify(english) },
      ],
    });
    try {
      const parsed = JSON.parse(reply.content.slice(reply.content.indexOf("["), reply.content.lastIndexOf("]") + 1)) as unknown;
      if (Array.isArray(parsed) && parsed.length === english.length) {
        best = best.map((kept, i) => {
          if (kept) return kept;
          const t = typeof parsed[i] === "string" ? withoutLongDashes((parsed[i] as string).trim()) : "";
          // Checked by rule (lib/wording.ts): the names, the script, and the slips with a shape a rule can see.
          return t && !translationProblem(language, grandparent.relation, t, english[i]!, titles) ? t : null;
        });
      }
    } catch {
      // try the next model
    }
    if (best.filter(Boolean).length >= SHOWN_QUESTIONS) break;
  }
  // The cleanly translated ones first. If there are too few, a question stays in English rather than carry a wrong
  // name or a known slip. They are shown in the order the planner wrote them.
  const order = [...english.keys()].sort((a, b) => Number(best[a] === null) - Number(best[b] === null) || a - b).slice(0, SHOWN_QUESTIONS);
  return order.sort((a, b) => a - b).map((i) => ({ native: best[i] ?? english[i]!, english: english[i]! }));
}

const round = (usd: number) => Math.round(usd * 1e6) / 1e6;
const round2 = (n: number) => Math.round(n * 100) / 100;
