import { normalizeName } from "./evidence";

// Rules for the words on a card and in a question. Each of these began as an instruction to the planner, and each was
// broken by a real plan on 2026-10-11, so each is now checked here, in code, before anyone sees the plan:
//   - a question asked about "your abuela": a relative the family never mentioned;
//   - a card said what cinema she "adores": a taste read into her favorites, not given by the family;
//   - a Spanish question was English put word for word ("una película que sintió como si...").
// A list of phrases catches the phrases it knows. It is a floor under the planner, not a reader: the Spanish and the
// Hindi still need a native speaker (LANGUAGE_REVIEW.md). tests/wording.test.ts holds the cases these came from.

const stem = (word: string) => word.replace(/s$/, "");
const wordsOf = (texts: string[]) => new Set(texts.flatMap((t) => normalizeName(t).split(" ")).filter(Boolean).map(stem));
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---------------------------------------------------------------------------------------------------------------
// 1. A card may not say what either of them already loves, knows or lived, unless it names one of their own
//    favorites. Everything Qloo suggests is a guess about them, so it is put as a hope ("may", "might").

const WHO = String.raw`(?:\{grandparent\}|\{visitor\}|s?he|they|you both|you two|both of you|the two of you|each of you|who)`;
const BETWEEN = String.raw`(?:\s+(?:both|each|all|already|still|always|so|really|truly|clearly|dearly|deeply|once|has|have|had))*`;
const LOVES = String.raw`(?:adores?|adored|cherish(?:es|ed)?|treasures?|treasured|loves?|loved|likes?|liked|enjoys?|enjoyed|prefers?|preferred|appreciates?|favou?rs?|knows?|knew|known|remembers?|recalls?|misses|missed|feels?|felt|grew up|grow up|grown up|used to|is fond of|are fond of|is drawn to|are drawn to|is used to|responds? to|gravitates? to(?:ward)?)`;
const SOMEONE = String.raw`(?:her|him|them|you|\{grandparent\}|\{visitor\})`;
const THEIR = String.raw`(?:your|her|his|their|\{grandparent\}['’]s|\{visitor\}['’]s)`;
// Matched against the sentence in lower case and without accents.
const CLAIMS: RegExp[] = [
  // Not a claim when it is asked or left open: "see if she likes it", "ask what he loves about it", "so she feels at ease".
  new RegExp(String.raw`(?<![\w}])(?<!\b(?:if|whether|what|whatever|how|which|when|once|until|unless|ask|so)\s)${WHO}${BETWEEN}\s+${LOVES}\b`, "g"),
  // The same thing said with a noun: "her love of old films", "the shared love of whimsical stories".
  new RegExp(String.raw`${THEIR} (?:\w+ )?(?:love|fondness|passion|affection|soft spot|taste|nostalgia) (?:for|of)\b|\bthe (?:shared|mutual|common) (?:love|fondness|passion|affection) (?:for|of)\b|\b(?:close|dear|near) to (?:both of )?${THEIR} hearts?\b`, "g"),
  // What they lived: a memory, a past or a background nobody told us about.
  new RegExp(String.raw`\bmemories of\b|\bnostalgi\w*|\breminds? ${SOMEONE} of\b|\btakes? ${SOMEONE} (?:straight |right )?back\b|\bbrings? (?:it all )?back\b`, "g"),
  new RegExp(String.raw`\bshaped ${THEIR}\b|${THEIR} (?:roots|heritage|culture|homeland|hometown|upbringing|generation|era|past|old days)\b`, "g"),
];
// Where what is said of one person ends: at a comma or a stop, or where the other person is named.
const EDGE = /[,;.!?:–—]|\{(?:grandparent|visitor)\}|\b(?:s?he|they|who)\b/;
const MASK = "\u0001";
const fold = (text: string) => text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

// A semicolon ends a thought as a full stop does, so what stands before or after one can be kept on its own.
export const sentencesOf = (text: string) => text.split(/(?<=[.!?;])\s+/).map((s) => s.trim()).filter(Boolean);
const asSentence = (part: string) => {
  const s = part.replace(/;$/, ".");
  return s.charAt(0).toUpperCase() + s.slice(1);
};

// The phrase in one sentence that says what they already love, know or lived, or null. It may say so of one of the
// family's own favorites, named beside the phrase: that much the family did tell us. A favorite somewhere else in
// the sentence excuses nothing ("her love for classic cinema and his love for Spirited Away", from a real plan).
export function tasteClaim(sentence: string, favorites: string[]): string | null {
  let text = fold(sentence);
  const named = favorites.map((f) => fold(f).trim()).filter((f) => f.length > 2).sort((a, b) => b.length - a.length);
  for (const favorite of named) text = text.split(favorite).join(MASK);
  for (const pattern of CLAIMS) {
    for (const found of text.matchAll(pattern)) {
      const before = text.slice(0, found.index).split(EDGE).at(-1) ?? "";
      const after = text.slice(found.index + found[0].length).split(EDGE)[0] ?? "";
      if (!`${before}${after}`.includes(MASK)) return found[0].trim();
    }
  }
  return null;
}

// A card's text without the sentences that make such a claim. "kept" is null when nothing would remain.
export function withoutClaims(text: string, favorites: string[]): { kept: string | null; found: string[] } {
  const found: string[] = [];
  const kept = sentencesOf(text).filter((sentence) => {
    const claim = tasteClaim(sentence, favorites);
    if (claim) found.push(claim);
    return !claim;
  });
  if (!found.length) return { kept: text, found };
  return { kept: kept.length ? kept.map(asSentence).join(" ") : null, found };
}

// True when a card is one of their own favorites, as given: then its text may say they love it.
export function isOwnFavorite(title: string, favorites: string[]): boolean {
  const t = normalizeName(title);
  return favorites.some((f) => {
    const name = normalizeName(f);
    return name.length > 2 && t.length > 2 && (t.includes(name) || name.includes(t));
  });
}

// The page fills in two names, {grandparent} and {visitor}. A real plan wrote {grandfather} instead, which would
// have reached the page as it stands (2026-10-11). The usual slips are set right; a text with any other name in
// braces cannot be shown, and null says so.
const SAME_PERSON: [RegExp, string][] = [
  [/\{(?:grandmother|grandfather|grandma|grandpa|granny|grandparents?|abuel[ao]|abuelit[ao]|nana|elder)\}/gi, "{grandparent}"],
  [/\{(?:grandson|granddaughter|grandchild|grandkid|visitors?|you)\}/gi, "{visitor}"],
];
export function withKnownNames(text: string): string | null {
  const fixed = SAME_PERSON.reduce((t, [pattern, name]) => t.replace(pattern, name), text);
  return /\{(?!grandparent\}|visitor\})|(?<!\{grandparent|\{visitor)\}/.test(fixed) ? null : fixed;
}

// No long dash reaches the page: the rule on style covers what the planner writes too (bus 007b). The planner
// writes them however it is asked not to, so they are set right here. Between two numbers a dash becomes a hyphen;
// anywhere else it becomes a comma.
const LONG_DASH = "\u2012-\u2015";
export function withoutLongDashes(text: string): string {
  return text
    .replace(new RegExp(`(\\d)\\s*[${LONG_DASH}]\\s*(\\d)`, "g"), "$1-$2")
    .replace(new RegExp(`\\s*[${LONG_DASH}]+\\s*`, "g"), ", ")
    .replace(/^,\s*|,\s*$/g, "")
    .replace(/,\s*([,.!?;:])/g, "$1");
}

// What the bridge card says when the planner's own sentences could not be kept.
export const PLAIN_WHY = "Found from {grandparent}'s favorites, this is what both of their tastes come closest on.";

// ---------------------------------------------------------------------------------------------------------------
// 2. A question may not assume a fact about their life that the family did not give.

const QUIZ = /\b(do|can|did) you (still )?remember\b|\bdo you recall\b/i;
// Matched against the question in lower case and without accents. A single word the family used themselves is fine
// ("making tamales at Christmas" lets a question say Christmas).
const ASSUMED: [RegExp, string][] = [
  [/\b(husbands?|wife|wives|spouses?|partners?|sweethearts?|boyfriends?|girlfriends?|fiancee?s?|married|marriage|weddings?|honeymoons?|first love|fell in love|courtship|widow(?:er|ed)?)\b/, "a husband, a wife or a wedding"],
  [/\b(mothers?|fathers?|moms?|mums?|mamas?|mami|dads?|papas?|papi|parents?|grandmothers?|grandfathers?|grandmas?|grandpas?|grandparents?|abuel[ao]s?|abuelit[ao]s?|nanas?|sisters?|brothers?|siblings?|aunts?|uncles?|cousins?|sons?|daughters?|children|kids|baby|babies|ancestors?|in laws?)\b/, "a relative"],
  [/\b(hometowns?|home town|homeland|home country|villages?|birthplace|where you (?:grew up|were born|come from|are from|came from)|back home|old country|immigra\w*|emigra\w*|migrat\w*|moved (?:here|to|away)|came to (?:this|the) (?:country|city)|left home)\b/, "where they come from"],
  [/\b(jobs?|careers?|professions?|occupations?|boss|bosses|co ?workers?|colleagues?|retired?|retirement|worked|for a living|workplace)\b/, "their work"],
  [/\b(schools?|college|university|teachers?|classmates?|classrooms?|graduat\w*)\b/, "their schooling"],
  [/\b(church|temples?|mosques?|synagogues?|pray|prays|prayed|praying|prayers?|god|faith|religio\w*|mass|bible|quran|worship|hymns?)\b/, "their faith"],
  [/\b(when i was (?:born|a baby|little|small|a kid|a child|young|growing up)|first time you \w+ me|when you (?:first )?(?:held|met|saw) me|you held me)\b/, "something the two of them did long ago"],
  [/\b(the war|army|military|soldiers?|passed away|died|funerals?)\b/, "a loss or a war"],
];
// Capital letters that are not names of people or places.
const NOT_NAMES = new Set(["i", "tv", "ok", "cd", "cds", "dvd", "dvds", "lp", "lps", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]);

export interface QuestionContext {
  titles: string[]; // the cards of this plan: a question may name them
  said: string[]; // the family's own words: favorites, the city, the language
  known: string[]; // names and traits from Qloo's answers
}

// Why a question cannot be shown, or null. The reason goes back to the planner when a draft is sent back.
export function questionProblem(text: string, context: QuestionContext): string | null {
  if (QUIZ.test(text)) return 'tests memory ("do you remember"); invite a story instead';
  // A memory of something Qloo suggested is a memory nobody told us they have ("What memory comes up when you hear
  // [an artist from Qloo's list]?", from a real plan). Of one of their own favorites it is a fair question.
  const unknown = context.titles.find((title) => title.trim().length > 2 && text.toLowerCase().includes(title.trim().toLowerCase()) && !isOwnFavorite(title, context.said));
  if (unknown && /\b(?:memor(?:y|ies)|reminds?|remember|takes? you back|brings? back|nostalgi\w*)\b/i.test(text)) return `assumes they already know "${unknown}", which is only a suggestion; ask what they make of it instead`;
  // A card's title may hold any word ("Like Father, Like Son"), so the titles are set aside first.
  const rest = context.titles.reduce((t, title) => (title.trim().length > 2 ? t.replace(new RegExp(escaped(title.trim()), "gi"), " ") : t), text);
  const said = wordsOf(context.said);
  const plain = rest.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ");
  for (const [pattern, what] of ASSUMED) {
    for (const found of plain.matchAll(new RegExp(pattern, "g"))) {
      const words = found[0].split(" ");
      if (words.length === 1 && said.has(stem(words[0]!))) continue;
      return `assumes ${what} ("${found[0]}") that the family did not mention; ask about the plan or their tastes instead`;
    }
  }
  // A name of a place or a people is a fact too ("back in Mexico"), unless the family or Qloo's answers gave it.
  const allowed = new Set([...said, ...wordsOf(context.known)]);
  let startsSentence = true;
  for (const raw of rest.split(/\s+/)) {
    const first = startsSentence;
    startsSentence = /[.!?:]["'”’)]*$/.test(raw);
    const word = raw.replace(/^[^\p{L}{]+|[^\p{L}}]+$/gu, "").replace(/['’]s$/, "");
    if (!word || word.startsWith("{") || first || !/^\p{Lu}/u.test(word)) continue;
    const parts = normalizeName(word).split(" ").filter((p) => p.length > 1);
    if (parts.every((p) => NOT_NAMES.has(p) || allowed.has(stem(p)))) continue;
    return `names "${word}", which the family did not mention; ask about the plan or their tastes instead`;
  }
  return null;
}

// Plain questions that assume nothing, for a plan whose own questions could not be kept. They are put into the
// grandparent's language like any other.
export const STOCK_QUESTIONS = [
  "What is a song you could listen to again and again?",
  "What is a film you would happily watch one more time?",
  "What do you love to eat when someone else is cooking?",
  "What would you like the two of us to do next time?",
];

// ---------------------------------------------------------------------------------------------------------------
// 3. A question put into the grandparent's language. No rule can read grammar, so these catch only slips with a
//    fixed shape, each one seen in a real plan or a real comparison on 2026-10-11.

const placeholders = (text: string) => (text.match(/\{(grandparent|visitor)\}/g) ?? []).sort().join(",");
const count = (text: string, pattern: RegExp) => text.match(pattern)?.length ?? 0;
const DEVANAGARI = /[ऀ-ॿ]/;
const HINDI_FAMILIAR = /(?<![ऀ-ॿ])(?:तुम|तू|तुम्हें|तुमने|तुमको|तुम्हारा|तुम्हारी|तुम्हारे|तुझे|तुझको|तेरा|तेरी|तेरे)(?![ऀ-ॿ])/;

type Relation = "grandmother" | "grandfather" | undefined;

// "titles" are the cards of the plan. Where the language is written in Latin letters, a title the English names must
// stand unchanged: in a real plan a film's title came back translated word by word (2026-10-11, in Hindi, where a rule
// cannot tell a title written in another script from one that was translated; the translator is told instead).
export function translationProblem(language: string, relation: Relation, native: string, english: string, titles: string[] = []): string | null {
  if (!native.trim()) return "is empty";
  if (placeholders(native) !== placeholders(english)) return "changes who is named";
  if (normalizeName(native) === normalizeName(english)) return "is still in English";
  if (!/[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u.test(native)) {
    const lost = titles.find((t) => t.trim().length > 2 && english.includes(t.trim()) && !native.includes(t.trim()));
    if (lost) return `changes the title "${lost}"`;
  }
  const lang = language.trim().toLowerCase();
  if (lang === "spanish") {
    if (count(native, /¿/g) !== count(native, /\?/g) || !count(native, /¿/g)) return "lacks an opening or a closing question mark";
    // "felt like" put word for word. Spanish needs "se sintió como si" or "sentiste que".
    if (/(?<!\b(?:se|te|me|nos|lo|la) )\b(?:sinti[oó]|sentía|siente|sienten|sintieron) como (?:si|que)\b/i.test(native)) return 'puts "felt like" word for word ("sintió como si")';
    // "make sense" put word for word. Spanish says "tener sentido".
    if (/\b(?:hace[nr]?|hacía|hizo|hacen) sentido\b/i.test(native)) return 'puts "make sense" word for word ("hacer sentido")';
    // Words that agree with the person spoken to must match her or him.
    if (relation === "grandmother" && /\b(?:de|eras|cuando eras|siendo)(?: una?| muy)? (?:niño|pequeño|chico|jovencito|muchacho)\b/i.test(native)) return "speaks to a grandmother in the masculine";
    if (relation === "grandfather" && /\b(?:de|eras|cuando eras|siendo)(?: una?| muy)? (?:niña|pequeña|chica|jovencita|muchacha)\b/i.test(native)) return "speaks to a grandfather in the feminine";
    // Nothing about the visitor is ever sent, so a word that makes the two of them women is a guess ("juntas", seen
    // on 2026-10-11 for a grandmother and her grandson). The generic form is the only one that is never wrong.
    if (/\b(?:juntas|nosotras|las dos|ambas|solas)\b/i.test(native)) return "says the two of them are women, which nobody told it";
  }
  if (lang === "hindi") {
    if (!DEVANAGARI.test(native)) return "is not written in Devanagari";
    if (HINDI_FAMILIAR.test(native)) return "uses the familiar तुम or तू for an elder";
  }
  return null;
}
