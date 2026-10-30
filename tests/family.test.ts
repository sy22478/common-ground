import { describe, expect, it } from "vitest";
import { EMPTY_FORM, FamilySchema, SAMPLE_FAMILY, familyFromForm, favoritesFrom, looksLikeContactDetails, namesFor, noteProblem, refusalMessage, type FamilyForm } from "@/lib/family";

// The form a visitor fills in for their own family. Invented people throughout.
const filled: FamilyForm = {
  relation: "grandfather",
  birthYear: "1938",
  language: " Hindi ",
  city: "Jersey City, New Jersey",
  theirFavorites: "Mohammed Rafi\nMughal-E-Azam, cricket on the radio\n\n  masala chai  ",
  yourFavorites: "Spirited Away; baking",
};

describe("the form for your own family", () => {
  it("reads favorites one per line or separated by commas, and counts a repeat once", () => {
    expect(favoritesFrom(filled.theirFavorites)).toEqual(["Mohammed Rafi", "Mughal-E-Azam", "cricket on the radio", "masala chai"]);
    expect(favoritesFrom("Bolero, bolero\nBOLERO;  tango  night ")).toEqual(["Bolero", "tango night"]);
    expect(favoritesFrom(" \n , ")).toEqual([]);
  });

  it("turns a filled form into exactly what the server accepts", () => {
    const result = familyFromForm(filled);
    expect(result.errors).toBeNull();
    expect(result.family).toEqual({
      grandparent: { birthYear: 1938, relation: "grandfather", language: "Hindi", city: "Jersey City, New Jersey", favorites: ["Mohammed Rafi", "Mughal-E-Azam", "cricket on the radio", "masala chai"] },
      visitor: { favorites: ["Spirited Away", "baking"] },
      history: [],
    });
    expect(FamilySchema.safeParse(result.family).success).toBe(true);
  });

  it("leaves out what was left blank: no city, and neither grandmother nor grandfather", () => {
    const { family } = familyFromForm({ ...filled, relation: "", city: "  " });
    expect(family?.grandparent.city).toBeUndefined();
    expect(family?.grandparent.relation).toBeUndefined();
  });

  it("says in plain words what to change, field by field", () => {
    expect(familyFromForm(EMPTY_FORM).errors).toEqual({
      birthYear: "A year from 1910 to 2000, for example 1941.",
      language: "The language they are most at home in, for example Spanish.",
      theirFavorites: "Add at least one thing they love.",
      yourFavorites: "Add at least one thing you love.",
    });
    expect(familyFromForm({ ...filled, birthYear: "38" }).errors).toEqual({ birthYear: "A year from 1910 to 2000, for example 1941." });
    expect(familyFromForm({ ...filled, birthYear: "2015" }).errors?.birthYear).toBeDefined();
    expect(familyFromForm({ ...filled, yourFavorites: "a\nb\nc\nd\ne\nf\ng\nh\ni" }).errors).toEqual({ yourFavorites: "Eight at most, please: the ones that matter most." });
    expect(familyFromForm({ ...filled, theirFavorites: "x".repeat(81) }).errors).toEqual({ theirFavorites: "A few words each, please (80 letters at most)." });
  });
});

// Qloo's safe-use rules: no personal data to Qloo. What a visitor types as a favorite or a city is sent there.
describe("contact details are not tastes", () => {
  it("tells an email address, a phone number or a link from a favorite", () => {
    for (const text of ["rosa@example.com", "call 210 555 0142", "+1 (210) 555-0142", "https://example.com/rosa", "www.example.com"]) expect(looksLikeContactDetails(text)).toBe(true);
    for (const text of ["Pedro Infante", "Roman Holiday", "2001: A Space Odyssey", "Fahrenheit 451", "the 1970 World Cup", "Blink-182", "making tamales at Christmas"]) expect(looksLikeContactDetails(text)).toBe(false);
  });

  it("does not take a date or a span of years for a phone number", () => {
    for (const text of ["we went on 12.10.2026", "on 2026-10-12 she sang along", "10-12-26 was a good day", "films of 1950-1965", "songs from 1955 – 1962, please"]) expect(looksLikeContactDetails(text), text).toBe(false);
    // Still phone numbers, whatever the punctuation: a date stands alone, a number runs on.
    for (const text of ["06.12.34.56.78", "06 12 34 56 78", "2015550142", "ring 555-0142 x 201", "12.10.2026 call 210 555 0142"]) expect(looksLikeContactDetails(text), text).toBe(true);
  });

  it("the form refuses them, and says where what is typed goes", () => {
    expect(familyFromForm({ ...filled, theirFavorites: "Mohammed Rafi\nhis number is 201 555 0142" }).errors).toEqual({
      theirFavorites: "Tastes only, please: no phone numbers, email addresses or links. What you type here is sent to the planner, to Qloo and to a web search.",
    });
    expect(familyFromForm({ ...filled, city: "12 Example Street, 07302 0142 Jersey" }).errors).toEqual({ city: "Just the city, please: no street address or number." });
  });

  it("the server refuses them too, whatever the page did", () => {
    const withFavorite = (favorite: string) => FamilySchema.safeParse({ ...SAMPLE_FAMILY, visitor: { favorites: [favorite] } }).success;
    expect(withFavorite("Bad Bunny")).toBe(true);
    expect(withFavorite("leo@example.com")).toBe(false);
    expect(FamilySchema.safeParse({ ...SAMPLE_FAMILY, grandparent: { ...SAMPLE_FAMILY.grandparent, city: "phone 210 555 0142" } }).success).toBe(false);
  });
});

// The sentence a family may add after a visit. It is read by the planner's models (lib/feedback.ts, lib/agent.ts).
describe("the note after a visit", () => {
  const NOTE_ONLY = "Only how the visit went, please: no phone numbers, email addresses or links. This note is sent to the planner.";
  const visit = (note: unknown) => ({ ...SAMPLE_FAMILY, history: [{ landed: [{ title: "A Singer", kind: "artist" }], rest: [], note }] });

  it("passes as written when it only says how the visit went", () => {
    for (const note of ["the music was a hit, the film was too long", "she sang along for 45 minutes on 12.10.2026", "more from 1950-1965 next time", ""]) {
      expect(noteProblem(note), note).toBeNull();
      expect(FamilySchema.safeParse(visit(note)).success, note).toBe(true);
    }
  });

  it("is refused in the browser when it holds an email address, a phone number or a link, in plain words", () => {
    for (const note of ["write to rosa@example.com", "her number is 210 555 0142", "photos at https://example.com/rosa", "see www.example.com"]) expect(noteProblem(note), note).toBe(NOTE_ONLY);
    expect(noteProblem("x".repeat(281))).toBe("A sentence or two, please (280 letters at most).");
    expect(noteProblem(`  ${"x".repeat(280)}  `)).toBeNull(); // counted as it is sent, without the spaces around it
  });

  it("is refused again on the server, whatever the page did, with the same words", () => {
    for (const note of ["write to rosa@example.com", "her number is 210 555 0142", "photos at https://example.com/rosa"]) {
      const parsed = FamilySchema.safeParse(visit(note));
      expect(parsed.success, note).toBe(false);
      expect(refusalMessage(parsed.error!.issues)).toBe(NOTE_ONLY);
    }
    const long = FamilySchema.safeParse(visit("x".repeat(281)));
    expect(refusalMessage(long.error!.issues)).toBe("A sentence or two, please (280 letters at most).");
  });

  it("the route says which thing to take out, and falls back to the general line for anything else", () => {
    const refused = (family: unknown) => refusalMessage(FamilySchema.safeParse(family).error!.issues);
    expect(refused({ ...SAMPLE_FAMILY, visitor: { favorites: ["leo@example.com"] } })).toBe("Tastes only, please: no phone numbers, email addresses or links. What you type here is sent to the planner, to Qloo and to a web search.");
    expect(refused({ ...SAMPLE_FAMILY, grandparent: { ...SAMPLE_FAMILY.grandparent, city: "phone 210 555 0142" } })).toBe("Just the city, please: no street address or number.");
    expect(refused({ grandparent: { birthYear: 1800 } })).toBe("Please check the favorites and the birth year, then try again.");
    expect(refused(visit(42))).toBe("Please check the favorites and the birth year, then try again."); // never a parser's own words
    expect(refused(null)).toBe("Please check the favorites and the birth year, then try again.");
  });
});

describe("names", () => {
  it("stay out of the family that is sent, and have a stand-in when none is typed", () => {
    expect(JSON.stringify(familyFromForm(filled).family)).not.toMatch(/Dadaji|Anika/);
    expect(namesFor(filled, { grandparent: " Dadaji ", visitor: "Anika" })).toEqual({ grandparent: "Dadaji", visitor: "Anika" });
    expect(namesFor(filled, { grandparent: "", visitor: "" })).toEqual({ grandparent: "Grandpa", visitor: "the visitor" });
    expect(namesFor({ relation: "grandmother" }, { grandparent: "", visitor: "" }).grandparent).toBe("Grandma");
    expect(namesFor({ relation: "" }, { grandparent: "", visitor: "" }).grandparent).toBe("your grandparent");
  });
});
