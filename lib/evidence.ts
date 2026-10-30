// Every Qloo and Tavily result the agent sees is recorded here with an id (E1, E2, ...). Plan items must cite these
// ids, and the names on the cards must appear in the cited evidence: that is the grounding check.

// "family" is what the family typed themselves (a dish, a habit): citable for dishes and activities only.
export type Source = "qloo" | "tavily" | "family";

export interface EvidenceItem {
  id: string;
  source: Source;
  tool: string;
  label: string;
  names: string[];
  display?: string[]; // the names as the planner reads them, with Qloo's note: "Title (1964, director)", "Place (address)"
  kinds?: (string | undefined)[]; // for Qloo results: what each name is (movie, artist, place...), one per name
  notes?: (string | undefined)[]; // for Qloo results: Qloo's own note on each name (a place's address), one per name
  entityIds: string[];
  urls: string[];
  detail: unknown;
  context?: string; // extra text the planner sees, e.g. web snippets
  // For Qloo insights: whose taste was asked, for which type, with which signals, and the full results. The bridge
  // is chosen from these (lib/bridge.ts).
  asked?: { who: "grandparent" | "visitor" | "both"; kind: string; signalIds: string[]; entities: { id: string; name: string; year?: number; note?: string; affinity?: number }[] };
}

export const normalizeName = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// ---------------------------------------------------------------------------------------------------------------
// Is a search result what the family named?
//
// Qloo's search answers with whatever is nearest, and always with something. On 2026-10-12 the gathering model
// searched for a habit the family had named ("making ... at Christmas") as a place, and the first of five results
// was a place with one word of it in its name. The code took the first result as the grandparent's favorite, its id
// went out as one of her signals with every later call, and half of what Qloo then suggested for her changed. So a
// result counts only if it is called what was asked for. Checked against the real answers kept on this machine:
// each of the ten favorites searched before that day came back first under its own name.

// The words of a name, in any script: accents dropped, case folded, joining words left out.
const JOINING = new Set(["the", "a", "an", "and", "of", "at", "in", "on", "el", "la", "los", "las", "le", "les", "de", "del", "y"]);
export function nameWords(name: string): string[] {
  const all = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  const kept = all.filter((w) => !JOINING.has(w));
  return kept.length ? kept : all;
}

// One letter added, dropped or changed, in a word long enough for that to be a slip and not another word.
function oneLetterOff(a: string, b: string): boolean {
  if (Math.min(a.length, b.length) < 5 || Math.abs(a.length - b.length) > 1) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  let i = 0;
  while (i < short.length && short[i] === long[i]) i++;
  return short.length === long.length ? short.slice(i + 1) === long.slice(i + 1) : short.slice(i) === long.slice(i + 1);
}

// The same name: every word of the shorter is in the longer. A name of two words or more may have one letter off in
// a word (a slip of the hand), and may be part of a longer name if it is half of it or more ("Roman Holiday" for a
// result with its year added). A single word has to be the whole name, since a common word is one word of many names
// that have nothing to do with it; the one exception is an artist, who is often named by one name of two.
export function isSameName(asked: string, found: string, kind?: string): boolean {
  const a = nameWords(asked);
  const f = nameWords(found);
  if (!a.length || !f.length) return false;
  const slips = a.length >= 2;
  const same = (x: string, y: string) => x === y || (slips && oneLetterOff(x, y));
  const [short, long] = a.length <= f.length ? [a, f] : [f, a];
  if (!short.every((w) => long.some((v) => same(w, v)))) return false;
  if (short.length === long.length) return true;
  return (short.length >= 2 || kind === "artist") && short.length * 2 >= long.length;
}

// Written in different scripts (one has Latin letters, the other has none), two names cannot be compared by their words.
const hasLatin = (s: string) => /[a-z]/i.test(s.normalize("NFKD"));
export const inAnotherScript = (asked: string, found: string) => hasLatin(asked) !== hasLatin(found);

export class Ledger {
  readonly items: EvidenceItem[] = [];

  add(item: Omit<EvidenceItem, "id">): EvidenceItem {
    const full = { ...item, id: `E${this.items.length + 1}` };
    this.items.push(full);
    return full;
  }

  get(id: string): EvidenceItem | undefined {
    return this.items.find((i) => i.id === id);
  }

  knowsEntity(entityId: string): boolean {
    return this.items.some((i) => i.entityIds.includes(entityId));
  }

  // True when the title names something in the cited evidence (either way round, to allow "the film X" vs "X").
  supports(title: string, cited: string[]): boolean {
    const t = normalizeName(title);
    if (!t) return false;
    return cited.some((id) =>
      (this.get(id)?.names ?? []).some((n) => {
        const name = normalizeName(n);
        return name.length > 2 && (t.includes(name) || name.includes(t));
      }),
    );
  }

  // What Qloo says the thing named by this title is (movie, artist, place...), from the cited evidence. A card's kind
  // is read from here, not from the label the planner gave it.
  kindOf(title: string, cited: string[]): string | undefined {
    const t = normalizeName(title);
    for (const id of cited) {
      const item = this.get(id);
      const at = item?.kinds ? item.names.findIndex((n) => normalizeName(n).length > 2 && (t.includes(normalizeName(n)) || normalizeName(n).includes(t))) : -1;
      if (at >= 0 && item!.kinds![at]) return item!.kinds![at];
    }
    return undefined;
  }

  // Qloo's own note on the thing this title names: for a place, its address. The page shows it on a place card, so
  // the address is Qloo's and never the planner's.
  noteOf(title: string, cited: string[]): string | undefined {
    const t = normalizeName(title);
    for (const id of cited) {
      const item = this.get(id);
      const at = item?.notes ? item.names.findIndex((n) => normalizeName(n).length > 2 && (t.includes(normalizeName(n)) || normalizeName(n).includes(t))) : -1;
      if (at >= 0 && item!.notes![at]) return item!.notes![at];
    }
    return undefined;
  }

  // For a dish or an activity from the family's own words: the title must share a word with what they said.
  // "Tamales" and "baking bread together" do; a festival found on the web does not.
  shares(title: string, cited: string[]): boolean {
    const stem = (w: string) => w.replace(/s$/, "");
    const said = new Set(cited.flatMap((id) => (this.get(id)?.names ?? []).flatMap((n) => normalizeName(n).split(" "))).map(stem));
    return normalizeName(title).split(" ").some((w) => w.length >= 3 && said.has(stem(w)));
  }

  // Looser than supports, for events found on the web: a page's own title is rarely a usable card title, so every
  // word of the card's title (four letters or more) must appear in the cited pages' titles or snippets. An invented
  // performer or venue still fails.
  mentions(title: string, cited: string[]): boolean {
    const stem = (w: string) => w.replace(/s$/, "");
    const words = normalizeName(title).split(" ").filter((w) => w.length >= 4);
    if (!words.length) return false;
    const have = new Set(
      cited
        .flatMap((id) => {
          const item = this.get(id);
          return item ? normalizeName(`${item.names.join(" ")} ${item.context ?? ""}`).split(" ") : [];
        })
        .map(stem),
    );
    return words.every((w) => have.has(stem(w)));
  }

  // Compact text for the planning model: what was found, under which id.
  summary(maxNamesPerItem = 8): string {
    return this.items
      .map((i) => `${i.id} [${i.source}:${i.tool}] ${i.label}: ${(i.display ?? i.names).slice(0, maxNamesPerItem).join("; ")}${i.context ? `\n   ${i.context}` : ""}`)
      .join("\n");
  }
}
