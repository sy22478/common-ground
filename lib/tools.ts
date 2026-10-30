import { z } from "zod";
import type { Limits } from "./config";
import { inAnotherScript, isSameName, normalizeName, type Ledger } from "./evidence";
import type { ToolCall, ToolSpec } from "./llm";
import { AGE_BANDS, ENTITY_KINDS, QlooAllowanceUsed, type QlooApi, type QlooEntity } from "./qloo";
import type { TavilyApi } from "./tavily";

export interface ToolContext {
  qloo: QlooApi | null;
  tavily: TavilyApi | null;
  ledger: Ledger;
  limits: Limits;
  city?: string;
  webSearches: number;
  // The Qloo id of each favorite found so far, by person. Insights and compare use all of a person's ids whatever
  // the model passes, so the same family always asks Qloo the same questions.
  ids: { grandparent: string[]; visitor: string[] };
  // Kinds of place found by qloo_tags for a food the family named, best first. A place search uses
  // the first one, whatever the model passes, so it looks for somewhere to eat that food and not for landmarks.
  placeTags: { id: string; name: string }[];
  qlooAnswers: number; // Qloo calls that came back, with results or without
  qlooFailures: number; // Qloo calls that failed: with these and no answers, Qloo is down, not short of data
  qlooAllowanceUsed?: boolean; // a call was refused by this site's own daily allowance, not by Qloo
}

export interface ToolOutcome {
  ok: boolean;
  content: string; // what the model reads
  summary: string; // what the page shows
  evidence?: string;
  names?: string[]; // every name this evidence can ground: lets the scripted run check each card for itself
}

// A tool works in two parts, so the calls of one reply can be on the wire together and still land in the evidence in
// the order the model made them. run() does the fetching and resolves to the second part, which records the evidence
// and writes the outcome. The second part does no waiting.
type Commit = () => ToolOutcome;
const say =
  (outcome: ToolOutcome): Commit =>
  () =>
    outcome;

interface Tool<S extends z.ZodType> {
  name: string;
  description: string;
  schema: S;
  run(args: z.infer<S>, ctx: ToolContext): Promise<Commit>;
}

const Kind = z.enum(ENTITY_KINDS).describe("Entity type");
const Ids = z.array(z.string().min(1)).min(1).max(6).describe("Entity ids returned by qloo_search");

// What the gathering model reads back. Affinity is rounded: the real value has 15 decimals, and every reply is re-sent.
const compact = (e: QlooEntity) => ({ id: e.id, name: e.name, kind: e.kind, year: e.year, affinity: e.affinity === undefined ? undefined : Math.round(e.affinity * 100) / 100 });
// What the planner reads: the name with Qloo's own identifier, so it can tell a 1953 film from its remake, and say
// where a place is, without adding anything from memory.
const withNote = (e: QlooEntity) => (e.note ? `${e.name} (${e.note})` : e.year ? `${e.name} (${e.year})` : e.name);

function unknownIds(ids: string[], ctx: ToolContext): string[] {
  return ids.filter((id) => !ctx.ledger.knowsEntity(id));
}

function needQloo(ctx: ToolContext): QlooApi {
  if (!ctx.qloo) throw new Error("Qloo is not available right now");
  return ctx.qloo;
}

// Every Qloo call goes through here, so the agent can tell "Qloo found nothing" from "Qloo is not answering".
export async function askQloo<T>(ctx: ToolContext, call: (qloo: QlooApi) => Promise<T>): Promise<T> {
  const qloo = needQloo(ctx);
  try {
    const result = await call(qloo);
    ctx.qlooAnswers += 1;
    return result;
  } catch (error) {
    ctx.qlooFailures += 1;
    if (error instanceof QlooAllowanceUsed) ctx.qlooAllowanceUsed = true;
    throw error;
  }
}

// "named" is how many of the results count as evidence. The model still reads all of them, and may use any of their ids.
function entityResult(ctx: ToolContext, tool: string, label: string, kind: string, entities: QlooEntity[], named = entities.length, asked?: Omit<NonNullable<Parameters<Ledger["add"]>[0]["asked"]>, "entities">): ToolOutcome {
  const evidence = entities.slice(0, named);
  const item = ctx.ledger.add({
    source: "qloo",
    tool,
    label,
    names: evidence.map((e) => e.name),
    display: evidence.map(withNote),
    kinds: evidence.map(() => kind), // the type that was asked for: every result of one call has it
    notes: evidence.map((e) => e.note),
    entityIds: entities.map((e) => e.id),
    urls: [],
    detail: entities.map(compact),
    asked: asked && { ...asked, entities: entities.map((e) => ({ id: e.id, name: e.name, year: e.year, note: e.note, affinity: e.affinity })) },
  });
  return {
    ok: true,
    evidence: item.id,
    names: item.names,
    content: JSON.stringify({ evidence: item.id, results: entities.map(compact) }),
    summary: `${label}: ${evidence.length ? evidence.slice(0, 4).map((e) => e.name).join(", ") : "no results"}`,
  };
}

const Who = z.enum(["grandparent", "visitor"]);
const searchSchema = z.object({ query: z.string().trim().min(1).max(80), type: Kind, for: Who.describe("Whose favorite this is") });

const qlooSearch: Tool<typeof searchSchema> = {
  name: "qloo_search",
  description: "Find one person's favorite in Qloo (artist, film, show, book, place) by name. Returns candidate ids. Never guess ids.",
  schema: searchSchema,
  async run({ query, type, for: who }, ctx) {
    const results = await askQloo(ctx, (qloo) => qloo.search(query, type, 5));
    return () => {
      // Qloo's search always answers with what is nearest. Only a result that is called what was asked for, by its
      // name or by one of the other names Qloo knows it by, is this person's favorite (lib/evidence.ts, isSameName).
      // The rest are near-misses that share a word. They are dropped here: their ids are never known to the agent, so
      // none of them can become a signal, a step on the page or a card.
      const calledThat = (e: QlooEntity) => [e.name, ...(e.akas ?? [])].some((name) => isSameName(query, name, type));
      // Asked in one script and answered in another, with no other name to go by, there is nothing to compare: the
      // first result stands, as it always did (a film asked for by its title in Japanese came back so, 2026-10-13).
      const uncomparable = (e: QlooEntity) => [e.name, ...(e.akas ?? [])].every((name) => inAnotherScript(query, name));
      const matches = results.filter(calledThat);
      const kept = matches.length ? matches : results[0] && uncomparable(results[0]) ? [results[0]] : [];
      const best = kept[0]?.id;
      if (best && !ctx.ids[who].includes(best)) ctx.ids[who].push(best);
      const label = `Qloo search "${query}" (${type.replace("_", " ")})`;
      // Only the best match is evidence. A second result of the same name (a remake) can still be told apart by its year.
      const outcome = entityResult(ctx, "search", label, type, kept, 1);
      if (kept.length) return outcome;
      const note = `Qloo has nothing called "${query}". Leave it out: do not search for it again, under this type or another. If it names a food, qloo_tags is the tool for it.`;
      return { ...outcome, content: JSON.stringify({ evidence: outcome.evidence, results: [], note }), summary: `${label}: nothing by that name` };
    };
  },
};

// The signals for a call: every id found for that person, plus any other known id the model passed.
const MAX_SIGNALS = 10;
function signalsFor(ctx: ToolContext, who: "grandparent" | "visitor" | "both", passed: string[]): string[] {
  const theirs = who === "both" ? [...ctx.ids.grandparent, ...ctx.ids.visitor] : ctx.ids[who];
  const other = who === "both" ? [] : ctx.ids[who === "grandparent" ? "visitor" : "grandparent"];
  return [...new Set([...theirs, ...passed.filter((id) => !other.includes(id))])].slice(0, MAX_SIGNALS);
}

const insightsSchema = z.object({
  for: z.enum(["grandparent", "visitor", "both"]).describe("Whose taste the signal ids describe"),
  type: Kind,
  entity_ids: Ids,
  release_year_min: z.number().int().min(1900).max(2030).optional(),
  release_year_max: z.number().int().min(1900).max(2030).optional(),
  age: z.enum(AGE_BANDS).optional(),
  take: z.number().int().min(3).max(8).optional(),
});

const qlooInsights: Tool<typeof insightsSchema> = {
  name: "qloo_insights",
  description:
    "Qloo taste recommendations of one type from signal entity ids. Use release years to aim at an era (films, " +
    "shows, books). For places, results are near the family's city, and of the kind qloo_tags found.",
  schema: insightsSchema,
  async run(args, ctx) {
    const unknown = unknownIds(args.entity_ids, ctx);
    if (unknown.length) {
      return say({ ok: false, content: `error: unknown entity ids ${unknown.join(", ")}; use ids from qloo_search`, summary: "Rejected unknown ids" });
    }
    // A place search is for somewhere near the grandparent. With no city there is nowhere to look, and the page
    // promises the city goes to Qloo only "when it looks for places nearby".
    if (args.type === "place" && !ctx.city) {
      return say({ ok: false, content: "error: no city was given, so there are no places to look for; continue without them", summary: "No city given, so no places nearby" });
    }
    const signalIds = signalsFor(ctx, args.for, args.entity_ids);
    const placeTag = args.type === "place" ? ctx.placeTags[0] : undefined;
    const results = await askQloo(ctx, (qloo) =>
      qloo.insights({
        kind: args.type,
        signalIds,
        releaseYearMin: args.release_year_min,
        releaseYearMax: args.release_year_max,
        age: args.age,
        location: args.type === "place" ? ctx.city : undefined,
        tagIds: placeTag ? [placeTag.id] : undefined,
        take: args.take,
      }),
    );
    const era = args.release_year_min || args.release_year_max ? `, ${args.release_year_min ?? ""}-${args.release_year_max ?? ""}` : "";
    const who = args.for === "both" ? "both of them" : `the ${args.for}`;
    const where = args.type === "place" ? ` near ${ctx.city!.split(",")[0]!.trim()}${placeTag ? `, of the kind "${placeTag.name}"` : ""}` : "";
    return () => entityResult(ctx, "insights", `Qloo ${args.type.replace("_", " ")} insights for ${who}${era}${where}`, args.type, results, results.length, { who: args.for, kind: args.type, signalIds });
  },
};

const compareSchema = z.object({
  grandparent_ids: Ids,
  visitor_ids: Ids,
});

// The real endpoint returns what the two tastes share as tags (a genre, a theme, an instrument), not titles. They go
// into the evidence as context, never as names: a trait can explain a bridge, but it cannot be the title of a card.
const qlooCompare: Tool<typeof compareSchema> = {
  name: "qloo_compare",
  description:
    "Qloo analysis of what the grandparent's taste and the visitor's taste share: the genres, themes, moods and " +
    "instruments both carry. Returns shared traits, not titles.",
  schema: compareSchema,
  async run(args, ctx) {
    const unknown = unknownIds([...args.grandparent_ids, ...args.visitor_ids], ctx);
    if (unknown.length) {
      return say({ ok: false, content: `error: unknown entity ids ${unknown.join(", ")}; use ids from qloo_search`, summary: "Rejected unknown ids" });
    }
    const traits = await askQloo(ctx, (qloo) => qloo.compare(signalsFor(ctx, "grandparent", args.grandparent_ids), signalsFor(ctx, "visitor", args.visitor_ids), 12));
    return () => {
      const shown = traits.map((t) => (t.kind ? `${t.name} (${t.kind})` : t.name));
      const item = ctx.ledger.add({
        source: "qloo",
        tool: "compare",
        label: "Qloo compare, what their two tastes share",
        names: [],
        entityIds: [],
        urls: [],
        detail: traits,
        context: shown.length ? `Shared traits, strongest first: ${shown.join("; ")}` : "No shared traits found.",
      });
      return {
        ok: true,
        evidence: item.id,
        content: JSON.stringify({ evidence: item.id, shared_traits: traits.map((t) => ({ name: t.name, kind: t.kind })) }),
        summary: `Qloo compare, what they share: ${traits.slice(0, 5).map((t) => t.name).join(", ") || "nothing found"}`,
      };
    };
  },
};

const tagsSchema = z.object({ query: z.string().trim().min(2).max(40).describe("One or two words that name a dish or a food, for example: tamales") });

// Qloo's tag search (/v2/tags) turns a word the family used for a food into Qloo's own tag for the kind of place that
// serves it. The place search then filters by that tag, so "an outing" is somewhere to eat what they named, near the
// grandparent, and not the city's landmarks (what a place search without a tag returned on 2026-10-11). A tag is a
// label, never a title: it goes into the evidence as context, like the traits from compare.
// Only tags that name a kind of place are used. Qloo also returns tags for single dishes on single
// menus; a real search for a spiced tea returned only those (2026-10-11), no place carried the first of them, and
// the planner made a dish of one. So those are not kinds of place, and they are not shown to the planner.
const KINDS_OF_PLACE = ["urn:tag:genre:place", "urn:tag:category:place"];
const rank = (type: string | undefined) => KINDS_OF_PLACE.findIndex((prefix) => (type ?? "").startsWith(prefix));

const qlooTags: Tool<typeof tagsSchema> = {
  name: "qloo_tags",
  description:
    "Find Qloo's tag for the kind of place that serves a dish or a food the family named (for example tamales). " +
    "Call it at most once. A qloo_insights call with type place then looks for such places near them.",
  schema: tagsSchema,
  async run({ query }, ctx) {
    if (ctx.placeTags.length) return say({ ok: false, content: "error: qloo_tags was already called for this plan; continue with what it found", summary: "One tag search a plan" });
    const tags = await askQloo(ctx, (qloo) => qloo.tags(query, 8));
    return () => {
      // Stable: Qloo's own order within each type of tag.
      const forPlaces = tags.filter((t) => t.places && rank(t.type) >= 0).sort((a, b) => rank(a.type) - rank(b.type));
      ctx.placeTags = forPlaces.map((t) => ({ id: t.id, name: t.name }));
      const kind = forPlaces[0]?.name; // the one the place search will use
      if (!kind) {
        return { ok: true, content: `no tag for a kind of place matches "${query}". Do not search tags again, and make no place search.`, summary: `Qloo tags for "${query}": no kind of place found` };
      }
      const item = ctx.ledger.add({
        source: "qloo",
        tool: "tags",
        label: `Qloo tags for "${query}"`,
        names: [],
        entityIds: forPlaces.map((t) => t.id),
        urls: [],
        detail: forPlaces,
        context: `The kind of place Qloo knows for "${query}": ${kind}`,
      });
      return {
        ok: true,
        evidence: item.id,
        content: JSON.stringify({ evidence: item.id, kind_of_place: kind, next: "call qloo_insights with type place, for both: it will look for this kind of place near them" }),
        summary: `Qloo tags for "${query}": ${kind}`,
      };
    };
  },
};

const webSchema = z.object({ query: z.string().trim().min(3).max(120) });

const webSearch: Tool<typeof webSchema> = {
  name: "web_search",
  description: "Search the web (Tavily) for a current local event that fits their shared taste. At most 2 per plan.",
  schema: webSchema,
  async run({ query }, ctx) {
    if (!ctx.tavily) return say({ ok: false, content: "error: web search is not available", summary: "Web search unavailable" });
    // The web search is for events near the grandparent. With no city there is nothing local to look for, and the
    // page promises that nothing is sent to Tavily then.
    if (!ctx.city) return say({ ok: false, content: "error: no city was given, so there is no local search; continue without it", summary: "No city given, so no local events" });
    if (ctx.webSearches >= ctx.limits.tavilyPerPlan) {
      return say({ ok: false, content: "error: web search limit for this plan reached; continue without it", summary: "Web search limit reached" });
    }
    ctx.webSearches += 1; // counted before the wait, so two searches in one reply cannot both slip under the limit
    let all: Awaited<ReturnType<TavilyApi["search"]>>;
    try {
      all = await ctx.tavily.search(query);
    } catch {
      // The plan goes ahead without local events, and the page says why in plain words.
      return say({ ok: false, content: "error: web search is not answering; continue without it", summary: "Web search is not answering, so this plan has no local events" });
    }
    // A search for "San Antonio ... family festival" also finds festivals elsewhere, and a snippet does not say where
    // (seen on 2026-10-11: a theatre in another country). So only a page that names the grandparent's city counts.
    const city = ctx.city.split(",")[0]!.trim();
    const cityWords = normalizeName(city).split(" ").filter((w) => w.length >= 3);
    const near = cityWords.length
      ? all.filter((r) => {
          const page = ` ${normalizeName(`${r.title} ${r.snippet} ${r.url}`)} `;
          return cityWords.every((w) => page.includes(` ${w} `));
        })
      : all;
    if (!near.length) {
      return say({ ok: true, content: `no result names ${city}, so there is no local event to suggest. Do not search the web again: continue without one.`, summary: `Web: nothing that names ${city}, so this plan has no local events` });
    }
    return () => {
      const results = near;
      const item = ctx.ledger.add({ source: "tavily", tool: "web_search", label: `Web search "${query}"`, names: results.map((r) => r.title), entityIds: [], urls: results.map((r) => r.url), detail: results, context: results.map((r) => `${r.title}: ${r.snippet.slice(0, 160)}`).join(" | ") });
      return { ok: true, evidence: item.id, names: item.names, content: JSON.stringify({ evidence: item.id, results }), summary: `Web: ${results.map((r) => r.title).slice(0, 3).join(" | ") || "nothing found"}` };
    };
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const TOOLS: Tool<any>[] = [qlooSearch, qlooInsights, qlooCompare, qlooTags, webSearch];

export function toolSpecs(tools = TOOLS): ToolSpec[] {
  return tools.map((t) => {
    const parameters = z.toJSONSchema(t.schema) as Record<string, unknown>;
    delete parameters.$schema;
    return { type: "function", function: { name: t.name, description: t.description, parameters } };
  });
}

// Validates the model's arguments and does the fetching. A bad call goes back to the model as an error so it can
// correct itself. Never rejects: whatever goes wrong becomes the outcome.
export async function startToolCall(call: ToolCall, ctx: ToolContext, tools = TOOLS): Promise<Commit> {
  const tool = tools.find((t) => t.name === call.function.name);
  if (!tool) return say({ ok: false, content: `error: no tool named ${call.function.name}`, summary: `Unknown tool ${call.function.name}` });
  let raw: unknown;
  try {
    raw = unwrapped(JSON.parse(call.function.arguments || "{}"));
  } catch {
    return say({ ok: false, content: "error: arguments are not valid JSON", summary: `Bad arguments for ${tool.name}` });
  }
  const parsed = tool.schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i: { path: PropertyKey[]; message: string }) => `${i.path.map(String).join(".") || "(root)"}: ${i.message}`).join("; ");
    return say({ ok: false, content: `error: invalid arguments for ${tool.name}: ${issues}. Fix them and call again.`, summary: `Corrected arguments for ${tool.name}` });
  }
  try {
    return await tool.run(parsed.data, ctx);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return say({ ok: false, content: `error: ${message}`, summary: `${tool.name} failed` });
  }
}

// Nemotron 3 Super now and then sends a list as a piece of text: "=[\"id\", \"id\"]" where ["id", "id"] is meant.
// Seen on 2026-10-11 in three replies running, so sending the call back did not help: that plan lost its compare and
// its place search. The text is read as the list it spells. Nothing is guessed: an id nobody found is still refused.
function unwrapped(args: unknown): unknown {
  if (!args || typeof args !== "object" || Array.isArray(args)) return args;
  return Object.fromEntries(
    Object.entries(args).map(([key, value]) => {
      const spelled = typeof value === "string" ? value.match(/^\s*=?\s*(\[[\s\S]*\])\s*$/)?.[1] : undefined;
      if (!spelled) return [key, value];
      try {
        return [key, JSON.parse(spelled) as unknown];
      } catch {
        return [key, value];
      }
    }),
  );
}

// One call from start to outcome.
export async function runToolCall(call: ToolCall, ctx: ToolContext, tools = TOOLS): Promise<ToolOutcome> {
  return (await startToolCall(call, ctx, tools))();
}

// Qloo allows 5 calls a second on the hackathon key, so the calls of one reply go out at most this many at a time.
export const TOOLS_AT_ONCE = 4;

// Starts every call of one reply, a few at a time, and hands back their second parts in the order the model made the
// calls. The agent commits them in that order, so evidence ids do not depend on which answer came back first.
export function startToolCalls(calls: ToolCall[], ctx: ToolContext, tools = TOOLS, atOnce = TOOLS_AT_ONCE): Promise<Commit>[] {
  let running = 0;
  const waiting: (() => void)[] = [];
  return calls.map(
    (call) =>
      new Promise<Commit>((resolve) => {
        const go = () => {
          running += 1;
          void startToolCall(call, ctx, tools).then((commit) => {
            running -= 1;
            waiting.shift()?.();
            resolve(commit);
          });
        };
        if (running < atOnce) go();
        else waiting.push(go);
      }),
  );
}

// The calls of one reply, run together, with their outcomes in the order the model made them. One exception keeps
// what worked when calls ran one by one: a call that is not a lookup (a search, or a tag search) waits for the
// lookups made before it in the same reply, because it may use what they find: an id, or the kind of place to look
// for. In the usual run (lookups in one reply, the rest in the next) nothing waits.
export async function* runToolCalls(calls: ToolCall[], ctx: ToolContext, tools = TOOLS, atOnce = TOOLS_AT_ONCE): AsyncGenerator<ToolOutcome> {
  const isSearch = (call: ToolCall) => call.function.name === "qloo_search" || call.function.name === "qloo_tags";
  let from = 0;
  while (from < calls.length) {
    let to = from + 1;
    while (to < calls.length && !(isSearch(calls[to - 1]!) && !isSearch(calls[to]!))) to += 1;
    for (const commit of startToolCalls(calls.slice(from, to), ctx, tools, atOnce)) yield (await commit)();
    from = to;
  }
}
