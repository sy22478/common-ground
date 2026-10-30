import { z } from "zod";
import type { Family } from "./family";
import type { LLM } from "./llm";
import { extractJson, groupOf, KIND_GROUPS, type KindGroup, type Wishes } from "./plan";
import { CapReached } from "./spend";

// After a visit the family ticks what landed and may add a sentence: "the music was a hit, the film was too long".
// This turns that into what the next plan owes them. Nemotron 3 Nano reads the sentence; everything after that is
// plain code, so the wishes are followed by rule (lib/plan.ts checks them) and not by hope.
export type Visit = Family["history"][number];

// Nano now and then names a kind for its group: "artist" under "more", in both takes of 2026-10-28. A word off the
// list used to fail the check of the whole reply, and "avoid" was lost with it. So a song, an album or an artist
// counts as music, any other word off the list is dropped, and the rest of the reply is kept.
const AS_MUSIC = new Set(["artist", "song", "album"]);
const toGroup = (word: unknown): KindGroup | null =>
  typeof word !== "string" ? null : AS_MUSIC.has(word) ? "music" : (KIND_GROUPS as readonly string[]).includes(word) ? (word as KindGroup) : null;
const Groups = z
  .array(z.unknown())
  .default([])
  .transform((words) => words.map(toGroup).filter((g): g is KindGroup => g !== null));

const Reading = z.object({ more: Groups, avoid: Groups });

const READ_RULES = [
  "A family tried a visit plan with a grandparent and reported how it went. Decide what the next plan should hold more",
  "of and what it should leave out. Reply with one JSON object and nothing else:",
  '{"more": [], "avoid": []}',
  `Use only these words: ${KIND_GROUPS.join(", ")}. "music" covers songs, albums and artists.`,
  "more: the kinds marked as landed, and any kind the note praises.",
  "avoid: only the kinds the note says went badly (too long, boring, too loud, did not like it).",
  "A kind that was not marked as landed and that the note does not mention goes in neither list: it may simply not",
  "have been tried.",
  "Where the note and the marks disagree, follow the note. If there are several visits, the last one counts most.",
].join("\n");

const unique = <T>(list: T[]) => [...new Set(list)];

// The most of one kind a plan can be asked for. It has a bridge and up to four moments, and one card is left for
// something else, so "more" stops at four. (At three, a first plan with three music cards could not be followed by
// more music: seen in the scripted run of 2026-10-11.)
const MOST = 4;

export async function readFeedback(history: Visit[], llm: LLM): Promise<Wishes | null> {
  const last = history.at(-1);
  if (!last) return null;
  const marked = unique(last.landed.map((i) => groupOf(i.kind)));
  let reading: z.infer<typeof Reading> = { more: [], avoid: [] };
  try {
    const reply = await llm.chat({
      model: "nano",
      thinking: false,
      maxTokens: 200,
      temperature: 0,
      messages: [
        { role: "system", content: READ_RULES },
        { role: "user", content: JSON.stringify(history.map((v) => ({ landed: v.landed, not_marked: v.rest, note: v.note ?? "" }))) },
      ],
    });
    reading = Reading.parse(extractJson(reply.content));
  } catch (error) {
    if (error instanceof CapReached) throw error; // a spend cap always stops the plan
    // The reply could not be read: go by the ticks alone, and avoid nothing.
  }
  const avoid = unique(reading.avoid);
  // What was ticked always counts as "more", unless the note says that kind went badly.
  const more = unique([...marked, ...reading.more]).filter((g) => !avoid.includes(g));
  const lastPlan = [...last.landed, ...last.rest];
  return {
    more: more.map((group) => ({ group, atLeast: Math.min(lastPlan.filter((i) => groupOf(i.kind) === group).length + 1, MOST) })),
    avoid,
    // A dish or an activity that landed may come back; everything else already suggested may not.
    noRepeat: unique(history.flatMap((v) => [...v.landed.filter((i) => i.kind !== "dish" && i.kind !== "activity"), ...v.rest]).map((i) => i.title)),
  };
}

const PLURAL: Record<KindGroup, string> = { music: "music", film: "films", show: "shows", book: "books", place: "places", event: "events", dish: "dishes", activity: "activities" };
// What Qloo can be asked for, by kind. Events come from the web search; dishes and activities from the family's words.
const QLOO_TYPE: Partial<Record<KindGroup, string>> = { music: "artist", film: "movie", show: "tv_show", book: "book", place: "place" };
const list = (words: string[]) => (words.length > 1 ? `${words.slice(0, -1).join(", ")} and ${words.at(-1)}` : (words[0] ?? ""));

// One line for the page, so the family sees that the last visit was heard.
export function wishesLine(wishes: Wishes): string {
  const parts = [
    ...(wishes.more.length ? [`more ${list(wishes.more.map((m) => PLURAL[m.group]))}`] : []),
    ...(wishes.avoid.length ? [`no ${list(wishes.avoid.map((g) => PLURAL[g]))} this time`] : []),
  ];
  return parts.length ? `From the last visit: ${parts.join(", ")}` : "From the last visit: something new in the same spirit";
}

// For the model that gathers evidence: which Qloo types to ask for, which never to, and what landed (to search and
// use as a signal). The agent builds its order of work from this, so the order and the wishes cannot disagree.
export interface GatherBrief {
  types: string[];
  never: string[];
  signals: string[];
  web: boolean;
}

export function gatherBrief(wishes: Wishes, last: Visit): GatherBrief {
  const never = wishes.avoid.flatMap((g) => QLOO_TYPE[g] ?? []);
  // What they want more of comes first, then the usual two, less anything ruled out.
  const wanted = unique([...wishes.more.flatMap((m) => QLOO_TYPE[m.group] ?? []), "movie", "artist"]).filter((t) => !never.includes(t));
  return {
    types: wanted.length ? wanted : ["tv_show", "book"].filter((t) => !never.includes(t)),
    never,
    signals: last.landed.filter((i) => QLOO_TYPE[groupOf(i.kind)] && !wishes.avoid.includes(groupOf(i.kind))).map((i) => `${i.title} (${QLOO_TYPE[groupOf(i.kind)]})`),
    web: !wishes.avoid.includes("event"),
  };
}

// For the model that writes the plan: the same wishes as rules it can count.
export function planBrief(wishes: Wishes): string {
  const lines = ["After the last visit (this comes before the general rules):"];
  for (const { group, atLeast } of wishes.more) {
    lines.push(`- ${PLURAL[group]} landed: include at least ${atLeast} ${group} ${atLeast === 1 ? "item" : "items"} among the bridge and the moments${group === "music" ? " (kind song, album or artist)" : ""}.`);
  }
  for (const group of wishes.avoid) lines.push(`- ${PLURAL[group]} went badly: include no ${group}, not as the bridge and not as a moment.`);
  if (wishes.noRepeat.length) lines.push(`- Suggest new things. Do not repeat: ${wishes.noRepeat.join("; ")}.`);
  return lines.join("\n");
}
