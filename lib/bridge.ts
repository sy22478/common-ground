import { normalizeName } from "./evidence";
import { groupOf, type ItemKind, type Wishes } from "./plan";
import type { EntityKind } from "./qloo";
import { askQloo, type ToolContext } from "./tools";

// The bridge is the first card of every plan: one thing both of them would love. It is chosen here, by Qloo's
// numbers, and not by a language model's taste.
//
// Qloo has already suggested things for each of them alone. The bridge comes from what it suggested for the
// grandparent: ask it one more question, how much the visitor's taste likes each of those. Every candidate then has an
// affinity with each of them, and the bridge is the one whose lower affinity is highest: the thing neither of them is
// lukewarm about, from the grandparent's world.
//
// Tried on real data on 2026-10-11. Left to the planner, the bridge changed from run to run and was often an artist
// from the grandparent's side only. Qloo's own list "for both" (one call with both people's signals) leans to
// whoever gave more signals, and to films that are simply famous.
//
// Only the grandparent's side since 2026-10-28 (Sonu, bus 015). Taken from both sides, the bridge came from the
// grandchild's suggestions in 4 of 10 invented families, current pop stars among them, which Qloo also scores high
// with a grandparent's favorites: its affinity runs high for popular things whatever the taste.
//
// More than famous. Qloo's affinity is high for famous things whatever the taste: asked how much the sample family's
// two tastes like its 50 most popular films, it gave every one of them a high number too. So a high number alone
// does not show a fit. The bridge is therefore held against what Qloo suggests to anyone (the same question with no
// taste signal): it should not be on that list, and each of the two tastes should like it more than the middle of
// that list. A candidate that fails is passed over while another passes. The card shows the comparison.
const CARD_KIND: Partial<Record<string, ItemKind>> = { movie: "film", tv_show: "show", artist: "artist", book: "book" };
const SHOWN = 4;

export interface BridgeCandidate {
  id: string;
  title: string;
  kind: ItemKind;
  note?: string;
  from: "grandparent" | "visitor"; // whose suggestions it came from
  grandparent: number; // Qloo affinity with the grandparent's favorites, 0 to 1
  visitor: number;
  evidence: string[];
  // Held against what Qloo suggests to anyone. Absent when that could not be asked: the bridge is chosen without it.
  beyondFame?: boolean;
}

// What the most popular of a type get from the same two tastes: the middle affinity on each side.
export interface FameLine {
  of: number; // how many of the most popular Qloo named
  grandparent: number;
  visitor: number;
}

// The same line when the bridge did not pass it: on that list, or not above its middle on one side or both.
export interface FameMiss extends FameLine {
  listed: boolean;
}

export interface BridgeChoice {
  bridge: BridgeCandidate;
  candidates: BridgeCandidate[];
  checkId: string; // the evidence item that holds the comparison
  summary: string;
  beyondFame?: FameLine; // set when the bridge passed: it is not on the list, and above its middle on both sides
  fameMissed?: FameMiss; // set when it was measured and did not pass. Said plainly on the card, with its numbers
}

const two = (n: number) => n.toFixed(2);
const PLURAL: Partial<Record<ItemKind, string>> = { film: "films", show: "shows", artist: "artists", book: "books" };

// For the planner's evidence, with the numbers. The page says the same in the family's names.
export function fameSentence(title: string, kind: ItemKind, c: { grandparent: number; visitor: number }, line: FameLine, missed?: FameMiss): string {
  const head = `For scale: the ${line.of} ${PLURAL[kind] ?? "things"} Qloo suggests to anyone score ${two(line.grandparent)} with the grandparent's favorites and ${two(line.visitor)} with the visitor's at the middle.`;
  if (!missed) return `${head} ${title} is not one of them.`;
  if (missed.listed) return `${head} ${title} is one of them.`;
  const low = [c.grandparent <= line.grandparent && `${two(c.grandparent)} with the grandparent's favorites`, c.visitor <= line.visitor && `${two(c.visitor)} with the visitor's`].filter(Boolean);
  return `${head} ${title} is not one of them, but its ${low.join(" and ")} ${low.length > 1 ? "are" : "is"} not above that middle.`;
}
const middle = (list: { affinity?: number }[]) => {
  const sorted = list.flatMap((e) => (e.affinity === undefined ? [] : [e.affinity])).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)]! : undefined;
};
const MIN_FAMOUS = 10; // fewer than this is not a list to measure against

export async function chooseBridge(ctx: ToolContext, wishes: Wishes | null): Promise<BridgeChoice | null> {
  const asked = ctx.ledger.items.filter((i) => i.asked && i.asked.who !== "both" && CARD_KIND[i.asked.kind]);
  const side = (who: "grandparent" | "visitor", kind?: string) => asked.filter((i) => i.asked!.who === who && (!kind || i.asked!.kind === kind));
  const signals = (who: "grandparent" | "visitor") => [...new Set(side(who).flatMap((i) => i.asked!.signalIds))];
  const ruledOut = new Set((wishes?.noRepeat ?? []).map(normalizeName));

  // One list of suggestions per person and type, each item with the affinity Qloo gave it for that person.
  const own = (who: "grandparent" | "visitor", kind: string) => {
    const seen = new Map<string, { id: string; title: string; note?: string; affinity: number; evidence: string[] }>();
    for (const item of side(who, kind)) {
      for (const e of item.asked!.entities) {
        if (e.affinity === undefined) continue;
        const had = seen.get(e.id);
        seen.set(e.id, { id: e.id, title: e.name, note: e.note ?? (e.year ? String(e.year) : undefined), affinity: Math.max(e.affinity, had?.affinity ?? 0), evidence: [...(had?.evidence ?? []), item.id] });
      }
    }
    return [...seen.values()];
  };

  // What Qloo suggests to anyone of this type, and how much each of the two tastes likes that list. It is an extra
  // check: if Qloo cannot answer it, the bridge is chosen as before and the card makes no claim.
  const fame = new Map<string, { listed: Set<string>; line: FameLine }>();
  const againstFame = async (kind: string) => {
    try {
      const famous = await askQloo(ctx, (qloo) => qloo.famous(kind as EntityKind));
      if (famous.length < MIN_FAMOUS) return;
      const ids = famous.map((e) => e.id);
      const [g, v] = await Promise.all([
        askQloo(ctx, (qloo) => qloo.affinity(signals("grandparent"), ids, kind as EntityKind)),
        askQloo(ctx, (qloo) => qloo.affinity(signals("visitor"), ids, kind as EntityKind)),
      ]);
      const [grandparent, visitor] = [middle(g), middle(v)];
      if (grandparent !== undefined && visitor !== undefined) fame.set(kind, { listed: new Set(ids), line: { of: ids.length, grandparent, visitor } }); // one of their own favorites may be on the list: Qloo does not score a thing against itself
    } catch {
      // no comparison for this type
    }
  };

  const kinds = [...new Set(asked.map((i) => i.asked!.kind))].filter((kind) => !wishes?.avoid.includes(groupOf(CARD_KIND[kind]!)));
  const perKind = await Promise.all(
    kinds.map(async (kind): Promise<BridgeCandidate[]> => {
      const theirs = own("grandparent", kind);
      if (!theirs.length || !signals("visitor").length) return [];
      const measured = againstFame(kind); // on the wire together with the question below
      try {
        const forVisitor = await askQloo(ctx, (qloo) => qloo.affinity(signals("visitor"), theirs.map((e) => e.id), kind as EntityKind));
        await measured;
        const likedByVisitor = new Map(forVisitor.map((e) => [e.id, e.affinity]));
        const candidates: BridgeCandidate[] = [];
        for (const e of theirs) {
          const other = likedByVisitor.get(e.id);
          if (other !== undefined) candidates.push({ id: e.id, title: e.title, kind: CARD_KIND[kind]!, note: e.note, from: "grandparent", grandparent: e.affinity, visitor: other, evidence: e.evidence });
        }
        const known = fame.get(kind);
        return known ? candidates.map((c) => ({ ...c, beyondFame: !known.listed.has(c.id) && c.grandparent > known.line.grandparent && c.visitor > known.line.visitor })) : candidates;
      } catch {
        await measured;
        return []; // Qloo could not answer for this type: the planner chooses the bridge as before
      }
    }),
  );

  const low = (c: BridgeCandidate) => Math.min(c.grandparent, c.visitor);
  // Those that are more than famous first (or that could not be measured), then by the lower affinity as before.
  const passes = (c: BridgeCandidate) => Number(c.beyondFame !== false);
  const ranked = perKind
    .flat()
    .filter((c) => !ruledOut.has(normalizeName(c.title)))
    .sort((a, b) => passes(b) - passes(a) || low(b) - low(a) || b.grandparent + b.visitor - (a.grandparent + a.visitor));
  const best = ranked[0];
  if (!best) return null;
  const qlooKind = Object.keys(CARD_KIND).find((k) => CARD_KIND[k] === best.kind && fame.has(k));
  const known = qlooKind ? fame.get(qlooKind)! : undefined;
  const line = best.beyondFame && known ? known.line : undefined;
  const missed: FameMiss | undefined = best.beyondFame === false && known ? { ...known.line, listed: known.listed.has(best.id) } : undefined;
  const many = PLURAL[best.kind] ?? "things";

  const shown = ranked.slice(0, SHOWN);
  const check = ctx.ledger.add({
    source: "qloo",
    tool: "bridge_check",
    label: "Qloo bridge check: how much the visitor's taste likes what was suggested for the grandparent",
    names: shown.map((c) => c.title),
    kinds: shown.map((c) => c.kind),
    display: shown.map((c) => `${c.title} (${c.kind}${c.note ? `, ${c.note}` : ""}): grandparent ${two(c.grandparent)}, visitor ${two(c.visitor)}`),
    entityIds: shown.map((c) => c.id),
    urls: [],
    detail: shown,
    ...(line || missed ? { context: fameSentence(best.title, best.kind, best, (line ?? missed)!, missed) } : {}),
  });
  return {
    bridge: { ...best, evidence: [check.id, ...best.evidence] },
    candidates: shown,
    checkId: check.id,
    summary: `Qloo bridge check: of what Qloo suggested for the grandparent, ${best.title} is closest to both (affinity ${two(best.grandparent)} with the grandparent's favorites, ${two(best.visitor)} with the visitor's)${line ? `, and not one of the ${line.of} ${many} Qloo suggests to anyone` : missed ? (missed.listed ? `, though it is one of the ${missed.of} ${many} Qloo suggests to anyone` : `, though not above the middle of the ${missed.of} ${many} Qloo suggests to anyone`) : ""}`,
    ...(line ? { beyondFame: line } : {}),
    ...(missed ? { fameMissed: missed } : {}),
  };
}
