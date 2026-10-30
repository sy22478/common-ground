import { z } from "zod";
import { ITEM_KINDS } from "./plan";

// A favorite is a taste: a singer, a film, a dish, a habit. It goes to Qloo and to the models, so it must not carry
// anyone's contact details. Qloo's safe-use rules: do not send "names, email addresses, device identifiers, account
// IDs, location histories, or other personal data". A person's name cannot be told from an artist's, so the form
// asks for tastes only; an email address, a phone number or a link can be told, and is refused.
// A date or a span of years is not a phone number ("12.10.2026", "2026-10-12", "films of 1950-1965"), so those are
// set aside before the digits are counted. Only when they stand alone: "06.12.34.56.78" is still a phone number.
const DATES = /(?<![\d./-])(?:\d{1,2}[./-]\d{1,2}[./-](?:\d{4}|\d{2})|\d{4}[./-]\d{1,2}[./-]\d{1,2}|(?:19|20)\d{2}\s?[-–]\s?(?:19|20)\d{2})(?![./-]?\d)/g;
export const looksLikeContactDetails = (text: string) =>
  /\S+@\S+\.\S+/.test(text) || /(\d[\s().-]*){7,}/.test(text.replace(DATES, "#")) || /https?:\/\/|www\./i.test(text);

// What the page says when it refuses something, and what the route says when the same thing gets past the page.
const TASTES_ONLY = "Tastes only, please: no phone numbers, email addresses or links. What you type here is sent to the planner, to Qloo and to a web search.";
const CITY_ONLY = "Just the city, please: no street address or number.";
const NOTE_MAX = 280;
const NOTE_TOO_LONG = `A sentence or two, please (${NOTE_MAX} letters at most).`;
const NOTE_ONLY = "Only how the visit went, please: no phone numbers, email addresses or links. This note is sent to the planner.";

// What the browser sends. No names: the page keeps names on the visitor's device and shows them; the server and the
// models only see roles ("grandparent", "visitor"). Location is a city at most.
const favorite = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((v) => !looksLikeContactDetails(v), TASTES_ONLY);

// The sentence a family may add after a visit ("the music was a hit, the film was too long"). It is read by the
// planner's models, so like a favorite it must not carry anyone's contact details.
const visitNote = z
  .string()
  .trim()
  .max(NOTE_MAX, NOTE_TOO_LONG)
  .refine((v) => !looksLikeContactDetails(v), NOTE_ONLY);

// The same check for the page, before anything is sent.
export function noteProblem(text: string): string | null {
  const note = text.trim();
  if (note.length > NOTE_MAX) return NOTE_TOO_LONG;
  return looksLikeContactDetails(note) ? NOTE_ONLY : null;
}

// Grandmother or grandfather, when the family says: languages such as Spanish need it to address her or him
// correctly ("de niña", not "de niño"). Left out, the questions are kept neutral where the language allows.
export const RELATIONS = ["grandmother", "grandfather"] as const;

// One card of an earlier plan, as the page reports it back after the visit. The kind travels with the title, so the
// agent knows a film from a singer without guessing.
const visitItem = z.object({ title: favorite, kind: z.enum(ITEM_KINDS) });

export const FamilySchema = z.object({
  grandparent: z.object({
    birthYear: z.number().int().min(1910).max(2000),
    relation: z.enum(RELATIONS).optional(),
    language: z.string().trim().min(2).max(30),
    city: z
      .string()
      .trim()
      .max(80)
      .refine((v) => !looksLikeContactDetails(v), CITY_ONLY)
      .optional(),
    favorites: z.array(favorite).min(1).max(8),
  }),
  visitor: z.object({
    favorites: z.array(favorite).min(1).max(8),
  }),
  history: z
    .array(
      z.object({
        landed: z.array(visitItem).max(8).default([]), // ticked as "landed"
        rest: z.array(visitItem).max(8).default([]), // shown and not ticked: not tried, or not liked. The note says which
        note: visitNote.optional(),
      }),
    )
    .max(5)
    .default([]),
});

export type Family = z.infer<typeof FamilySchema>;

// What the route answers when it refuses a family. Where the reason is contact details, or a note that is too long,
// it says so in the page's own words (the only messages written here); anything else gets the general line.
export function refusalMessage(issues: readonly { code?: string; path: PropertyKey[]; message: string }[]): string {
  const plain = issues.find((i) => i.code === "custom" || (i.code === "too_big" && i.path.at(-1) === "note"));
  return plain?.message ?? "Please check the favorites and the birth year, then try again.";
}

// The sample family on the landing page. The page shows them as Rosa and Leo.
export const SAMPLE_FAMILY: Family = {
  grandparent: {
    birthYear: 1940,
    relation: "grandmother",
    language: "Spanish",
    city: "San Antonio, Texas",
    favorites: ["Pedro Infante", "Roman Holiday", "Javier Solis", "making tamales at Christmas"],
  },
  visitor: { favorites: ["Bad Bunny", "Spirited Away", "baking"] },
  history: [],
};

// The years that shape lasting taste: roughly ages 10 to 30.
export function youthWindow(birthYear: number): { min: number; max: number } {
  return { min: birthYear + 10, max: birthYear + 30 };
}

// The form on the page, as typed. Names are not part of it: they never leave the browser.
export interface FamilyForm {
  relation: "" | (typeof RELATIONS)[number];
  birthYear: string;
  language: string;
  city: string;
  theirFavorites: string;
  yourFavorites: string;
}
export type FormErrors = Partial<Record<keyof FamilyForm, string>>;
export const EMPTY_FORM: FamilyForm = { relation: "", birthYear: "", language: "", city: "", theirFavorites: "", yourFavorites: "" };

// One favorite per line, or separated by commas. The same thing typed twice counts once.
export function favoritesFrom(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const piece of text.split(/[\n,;]+/)) {
    const favorite = piece.trim().replace(/\s+/g, " ");
    if (!favorite || seen.has(favorite.toLowerCase())) continue;
    seen.add(favorite.toLowerCase());
    out.push(favorite);
  }
  return out;
}

function favoritesProblem(text: string, nobody: string): string | null {
  const list = favoritesFrom(text);
  if (!list.length) return nobody;
  if (list.length > 8) return "Eight at most, please: the ones that matter most.";
  if (list.some((f) => f.length > 80)) return "A few words each, please (80 letters at most).";
  if (list.some(looksLikeContactDetails)) return TASTES_ONLY;
  return null;
}

// Turns the form into what the server accepts, or says in plain words what to change. The server checks again.
export function familyFromForm(form: FamilyForm): { family: Family; errors: null } | { family: null; errors: FormErrors } {
  const errors: FormErrors = {};
  const year = form.birthYear.trim();
  if (!/^\d{4}$/.test(year) || Number(year) < 1910 || Number(year) > 2000) errors.birthYear = "A year from 1910 to 2000, for example 1941.";
  const language = form.language.trim();
  if (language.length < 2) errors.language = "The language they are most at home in, for example Spanish.";
  else if (language.length > 30) errors.language = "The name of one language, please.";
  const city = form.city.trim();
  if (city.length > 80) errors.city = "Just the city, please.";
  else if (looksLikeContactDetails(city)) errors.city = CITY_ONLY;
  const theirs = favoritesProblem(form.theirFavorites, "Add at least one thing they love.");
  if (theirs) errors.theirFavorites = theirs;
  const yours = favoritesProblem(form.yourFavorites, "Add at least one thing you love.");
  if (yours) errors.yourFavorites = yours;
  if (Object.keys(errors).length) return { family: null, errors };
  const family = FamilySchema.parse({
    grandparent: { birthYear: Number(year), relation: form.relation || undefined, language, city: city || undefined, favorites: favoritesFrom(form.theirFavorites) },
    visitor: { favorites: favoritesFrom(form.yourFavorites) },
  });
  return { family, errors: null };
}

// Names stay on the visitor's device. When none is typed, these stand in for them on the page.
export function namesFor(form: Pick<FamilyForm, "relation">, typed: { grandparent: string; visitor: string }): { grandparent: string; visitor: string } {
  const fallback = form.relation === "grandmother" ? "Grandma" : form.relation === "grandfather" ? "Grandpa" : "your grandparent";
  return { grandparent: typed.grandparent.trim().slice(0, 40) || fallback, visitor: typed.visitor.trim().slice(0, 40) || "the visitor" };
}
