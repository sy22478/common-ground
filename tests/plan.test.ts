import { describe, expect, it } from "vitest";
import { Ledger } from "@/lib/evidence";
import { DraftPlanSchema, EVENT_NOTE, extractJson, groundingProblems, qlooFinds, tidied, withDistinctLines, withoutEventDates, withoutUnsupportedMoments, withQlooFinds, withShownMoments, type DraftPlan, type Wishes } from "@/lib/plan";
import { PLAIN_WHY, STOCK_QUESTIONS } from "@/lib/wording";

function ledger() {
  const l = new Ledger();
  l.add({ source: "family", tool: "input", label: "own words", names: ["making tamales at Christmas"], entityIds: [], urls: [], detail: null }); // E1
  l.add({ source: "qloo", tool: "insights", label: "both", names: ["Natalia Lafourcade", "Coco"], entityIds: ["Q-B1", "Q-B2"], urls: [], detail: null }); // E2
  l.add({ source: "tavily", tool: "web_search", label: "web", names: ["CineFestival at Guadalupe Cultural Arts Center"], entityIds: [], urls: ["https://x"], detail: null }); // E3
  return l;
}

const good: DraftPlan = {
  bridge: { title: "Natalia Lafourcade", kind: "artist", why: "Both love boleros.", evidence: ["E2"] },
  moments: [
    { title: "Coco", kind: "film", what_to_do: "Watch it together.", evidence: ["E2"] },
    { title: "Tamales", kind: "dish", what_to_do: "Cook them together.", evidence: ["E1"] },
    { title: "CineFestival", kind: "event", what_to_do: "A festival of classic films; check its page for dates.", evidence: ["E3"] },
  ],
  questions: [{ text_en: "What music filled your house growing up?" }, { text_en: "Who taught you to cook?" }, { text_en: "Where did you go dancing?" }],
};

describe("grounding check", () => {
  it("passes a plan whose every item is named in its evidence", () => {
    expect(groundingProblems(good, ledger())).toEqual([]);
  });

  it("catches invented items, unknown evidence, a non-Qloo bridge and memory quizzes", () => {
    const bad: DraftPlan = {
      ...good,
      bridge: { ...good.bridge, title: "What a Wonderful World", evidence: ["E3"] },
      moments: [{ ...good.moments[0]!, evidence: ["E9"] }, good.moments[1]!, { ...good.moments[2]!, title: "Opera night", kind: "event" }],
      questions: [{ text_en: "Do you remember your first dance?" }, ...good.questions.slice(1)],
    };
    const problems = groundingProblems(bad, ledger());
    expect(problems).toEqual([
      'bridge "What a Wonderful World" is not named in its evidence E3',
      'moment 1 "Coco" cites unknown evidence E9',
      'moment 3 "Opera night" is not named in its evidence E3',
      "the bridge must cite Qloo evidence",
      'question 1 tests memory ("do you remember"); invite a story instead',
    ]);
  });

  it("does not let a film cite the family's own words", () => {
    const plan = { ...good, moments: [{ title: "making tamales at Christmas", kind: "film" as const, what_to_do: "x", evidence: ["E1"] }, ...good.moments.slice(1)] };
    expect(groundingProblems(plan, ledger())).toEqual(['moment 1 "making tamales at Christmas" is not named in its evidence E1']);
  });

  it("reads JSON wrapped in a code fence", () => {
    expect(extractJson('Here:\n```json\n{"a": 1}\n```')).toEqual({ a: 1 });
  });
});

describe("events from the web", () => {
  // A real page title is not a card title: "San Antonio, TX Latin Concerts 2026 Schedule & Calendar | Ticketmaster".
  function withPage() {
    const l = ledger();
    l.add({ source: "tavily", tool: "web_search", label: "web", names: ["San Antonio, TX Latin Concerts 2026 Schedule & Calendar | Tickets"], entityIds: [], urls: ["https://y"], detail: null, context: "Bolero night at the Example Theatre, 24 October" }); // E4
    return l;
  }
  const event = (title: string) => ({ ...good, moments: [...good.moments.slice(0, 2), { title, kind: "event" as const, what_to_do: "Check the details first.", evidence: ["E4"] }] });

  it("accepts a title in the planner's own words when every word is on the cited page", () => {
    expect(groundingProblems(event("Latin concert in San Antonio"), withPage())).toEqual([]);
    expect(groundingProblems(event("Bolero night"), withPage())).toEqual([]);
  });

  it("still rejects a performer or venue the page does not mention", () => {
    expect(groundingProblems(event("Example Singer tribute concert"), withPage())).toEqual(['moment 3 "Example Singer tribute concert" is not named in its evidence E4']);
  });

  it("replaces a date, a day or a time on an event card with a plain caution, whatever the page says", () => {
    const said = (what_to_do: string) => {
      const plan = event("Bolero night");
      plan.moments[2]!.what_to_do = what_to_do;
      return withoutEventDates(plan).moments[2]!.what_to_do;
    };
    for (const text of ["Go on 24 October.", "It is on Saturday.", "Doors open at 7 pm.", "Happening this month.", "On May 3 at the theatre.", "The 24th is the big night."]) {
      expect(said(text)).toBe(EVENT_NOTE);
    }
    const fine = "An evening of boleros. You may want to check its page for dates before going.";
    expect(said(fine)).toBe(fine);
  });

  it("leaves a day alone on a card that is not an event", () => {
    const film = { ...good, moments: [{ ...good.moments[0]!, what_to_do: "Watch it together on Sunday." }, ...good.moments.slice(1)] };
    expect(withoutEventDates(film)).toEqual(film);
  });

  it("keeps the strict rule for everything that is not an event, and for the bridge", () => {
    const film = { ...good, moments: [...good.moments.slice(0, 2), { title: "Latin concert in San Antonio", kind: "film" as const, what_to_do: "x", evidence: ["E4"] }] };
    expect(groundingProblems(film, withPage())).toHaveLength(1);
  });
});

describe("a plan still not grounded after its correction", () => {
  const invented = { title: "Opera night", kind: "event" as const, what_to_do: "x", evidence: ["E3"] };

  it("is kept without the unsupported moments, when two or more remain", () => {
    const kept = withoutUnsupportedMoments({ ...good, moments: [...good.moments, invented] }, ledger());
    expect(kept?.dropped).toBe(1);
    expect(kept?.plan.moments.map((m) => m.title)).toEqual(["Coco", "Tamales", "CineFestival"]);
    expect(groundingProblems(kept!.plan, ledger())).toEqual([]);
  });

  it("is dropped when the bridge is the problem, or when too little would remain", () => {
    expect(withoutUnsupportedMoments({ ...good, bridge: { ...good.bridge, title: "What a Wonderful World" } }, ledger())).toBeNull();
    expect(withoutUnsupportedMoments({ ...good, moments: [good.moments[0]!, invented, { ...invented, title: "Jazz night" }] }, ledger())).toBeNull();
  });
});

// After a visit (lib/feedback.ts): "the music was a hit, the film was too long".
describe("the last visit's wishes", () => {
  const wishes: Wishes = { more: [{ group: "music", atLeast: 2 }], avoid: ["film"], noRepeat: ["natalia lafourcade"] };
  const tooFewMusic = "the plan has 1 music item; music landed last time, so include at least 2 (bridge and moments together)";

  it("names every way a grounded plan still goes against them", () => {
    expect(groundingProblems(good, ledger())).toEqual([]);
    expect(groundingProblems(good, ledger(), wishes)).toEqual([
      'bridge "Natalia Lafourcade" was already suggested for an earlier visit; suggest something new',
      'moment 1 "Coco" is a film; after the last visit the family asked for no film this time',
      tooFewMusic,
    ]);
  });

  it("counts songs, albums and artists together as music", () => {
    const musical = { ...good, moments: [{ title: "Coco", kind: "album" as const, what_to_do: "Play the soundtrack.", evidence: ["E2"] }, ...good.moments.slice(1)] };
    expect(groundingProblems(musical, ledger(), { ...wishes, noRepeat: [] })).toEqual([]);
  });

  it("keeps the plan without the moment the last visit ruled out, and says which wish is still unmet", () => {
    const kept = withoutUnsupportedMoments(good, ledger(), { ...wishes, noRepeat: [] });
    expect(kept?.plan.moments.map((m) => m.title)).toEqual(["Tamales", "CineFestival"]);
    expect(kept).toMatchObject({ dropped: 1, unmet: [tooFewMusic] });
  });

  it("never drops a grounded plan over a wish alone", () => {
    const filmFirst = { ...good, bridge: { ...good.bridge, title: "Coco", kind: "film" as const }, moments: [{ ...good.moments[0]!, title: "Natalia Lafourcade", kind: "artist" as const }, ...good.moments.slice(1)] };
    const kept = withoutUnsupportedMoments(filmFirst, ledger(), { more: [], avoid: ["film"], noRepeat: [] });
    expect(kept?.plan.bridge.title).toBe("Coco");
    expect(kept).toMatchObject({ dropped: 0, unmet: ['bridge "Coco" is a film; after the last visit the family asked for no film this time'] });
  });

  it("still drops a plan whose bridge is not in the evidence, wishes or not", () => {
    expect(withoutUnsupportedMoments({ ...good, bridge: { ...good.bridge, title: "What a Wonderful World" } }, ledger(), wishes)).toBeNull();
  });
});

describe("plan shape rules", () => {
  // The gate's step 4 wants four moment cards. The planner writes five, so one can fail a check and four remain.
  const five = (kinds: DraftPlan["moments"][number]["kind"][]): DraftPlan => ({ ...good, moments: kinds.map((kind, i) => ({ title: `Moment ${i + 1}`, kind, what_to_do: "x", evidence: ["E1"] })) });

  it("takes three to five moments from the planner and shows four", () => {
    expect(DraftPlanSchema.safeParse(five(["artist", "film", "dish", "place", "activity"])).success).toBe(true);
    expect(DraftPlanSchema.safeParse(five(["artist", "film", "dish", "place", "activity", "book"])).success).toBe(false);
    expect(DraftPlanSchema.safeParse(five(["artist", "film"])).success).toBe(false);
    expect(withShownMoments(five(["artist", "film", "dish", "place", "activity"])).moments.map((m) => m.title)).toEqual(["Moment 1", "Moment 2", "Moment 3", "Moment 4"]);
    expect(withShownMoments(five(["artist", "film", "dish"])).moments).toHaveLength(3);
  });

  it("gives up something else before a kind the last visit asked for more of", () => {
    const wishes: Wishes = { more: [{ group: "music", atLeast: 3 }], avoid: [], noRepeat: [] };
    expect(withShownMoments(five(["artist", "dish", "artist", "activity", "song"]), wishes).moments.map((m) => m.kind)).toEqual(["artist", "dish", "artist", "song"]);
    expect(withShownMoments(five(["artist", "album", "artist", "artist", "song"]), wishes).moments.map((m) => m.title)).toEqual(["Moment 1", "Moment 2", "Moment 3", "Moment 4"]);
  });

  it("takes the questions as objects or as plain strings, and nothing else", () => {
    const asStrings = { ...good, questions: good.questions.map((q) => q.text_en) };
    expect(DraftPlanSchema.parse(asStrings).questions).toEqual(good.questions);
    expect(DraftPlanSchema.parse(good).questions).toEqual(good.questions);
    expect(DraftPlanSchema.safeParse({ ...good, questions: [1, 2, 3] }).success).toBe(false);
    expect(DraftPlanSchema.safeParse({ ...good, questions: good.questions.slice(0, 2) }).success).toBe(false);
  });

  it("takes up to six questions, so there is a spare when one fails a check", () => {
    const more = (n: number) => ({ ...good, questions: Array.from({ length: n }, (_, i) => ({ text_en: `What is song number ${i + 1} for you?` })) });
    expect(DraftPlanSchema.safeParse(more(5)).success).toBe(true);
    expect(DraftPlanSchema.safeParse(more(7)).success).toBe(false);
  });

  it("flags a moment that repeats the bridge", () => {
    const plan = { ...good, moments: [{ title: "Natalia Lafourcade", kind: "artist" as const, what_to_do: "x", evidence: ["E2"] }, ...good.moments.slice(1)] };
    expect(groundingProblems(plan, ledger())).toEqual(['moment 1 repeats the bridge "Natalia Lafourcade"']);
  });
});

// A real plan on 2026-10-11 called a festival found on the web a "place" and gave it a street address. The rules for
// web leads hung on the label "event", so another label walked past them. The page title and the address here are
// invented; the shape is the real one.
describe("what a card is follows from its evidence, not from its label", () => {
  function withLead() {
    const l = ledger();
    l.add({ source: "tavily", tool: "web_search", label: "web", names: ["Harvest Film Days | Example Arts Center"], entityIds: [], urls: ["https://example.org/harvest"], detail: null, context: "Harvest Film Days at the Example Arts Center, 12 Example St" }); // E4
    l.add({ source: "qloo", tool: "insights", label: "for the grandparent", names: ["Sabrina", "Los Tres Reyes"], kinds: ["movie", "artist"], entityIds: ["Q-M2", "Q-A1"], urls: [], detail: null }); // E5
    return l;
  }
  const ADDRESS = "Visit the Example Arts Center's Harvest Film Days at 12 Example St. Check the schedule online before you go.";
  const withMoment = (moment: DraftPlan["moments"][number]): DraftPlan => ({ ...good, moments: [...good.moments.slice(0, 2), moment] });
  const lead = (kind: DraftPlan["moments"][number]["kind"], evidence = ["E4"]) => withMoment({ title: "Harvest Film Days", kind, what_to_do: ADDRESS, evidence });

  it("says so when a web lead is called a place", () => {
    expect(groundingProblems(lead("place"), withLead())).toEqual(['moment 3 "Harvest Film Days" is named only on a web page, so it is a lead to check: its kind is event, not place']);
  });

  it("makes it an event by rule, and takes the street address off the card", () => {
    const { plan } = tidied(lead("place"), withLead());
    expect(plan.moments[2]).toEqual({ title: "Harvest Film Days", kind: "event", what_to_do: EVENT_NOTE, evidence: ["E4"] });
    expect(groundingProblems(plan, withLead())).toEqual([]);
  });

  it("does the same when it is called an activity and cites the family's own words beside the page", () => {
    expect(tidied(lead("activity", ["E1", "E4"]), withLead()).plan.moments[2]).toMatchObject({ kind: "event", what_to_do: EVENT_NOTE });
    expect(tidied(lead("film"), withLead()).plan.moments[2]).toMatchObject({ kind: "event" });
  });

  it("replaces any figure on an event card: a street number, a price, a year", () => {
    for (const text of ["It is at 12 Example St.", "Tickets are 15 dollars at the door.", "Now in its 40th year."]) {
      expect(tidied(withMoment({ title: "Harvest Film Days", kind: "event", what_to_do: text, evidence: ["E4"] }), withLead()).plan.moments[2]!.what_to_do).toBe(EVENT_NOTE);
    }
  });

  it("wants a dish or an activity to share a word with what the family said", () => {
    const own = (title: string) => groundingProblems(withMoment({ title, kind: "activity", what_to_do: "Do it together.", evidence: ["E1"] }), withLead());
    expect(own("Evening walk")).toEqual(['moment 3 "Evening walk" is not named in its evidence E1']);
    expect(own("A tamale afternoon")).toEqual([]);
  });

  it("makes a film Qloo named a film again, so \"no film this time\" cannot be dodged by a label", () => {
    const hidden = withMoment({ title: "Sabrina", kind: "activity", what_to_do: "Watch it together.", evidence: ["E1", "E5"] });
    expect(groundingProblems(hidden, withLead())).toEqual(['moment 3 "Sabrina" is named in Qloo\'s results: its kind is film, not activity']);
    const { plan } = tidied(hidden, withLead());
    expect(plan.moments[2]!.kind).toBe("film");
    expect(groundingProblems({ ...plan, moments: plan.moments.slice(1) }, withLead(), { more: [], avoid: ["film"], noRepeat: [] })).toEqual(['moment 2 "Sabrina" is a film; after the last visit the family asked for no film this time']);
  });

  it("leaves a song or an album by an artist Qloo named as it is", () => {
    const song = withMoment({ title: "Los Tres Reyes", kind: "song", what_to_do: "Play one together.", evidence: ["E5"] });
    expect(tidied(song, withLead()).plan.moments[2]!.kind).toBe("song");
    expect(groundingProblems(song, withLead())).toEqual([]);
  });

  it("refuses a bridge that is named only on a web page, even beside Qloo evidence", () => {
    const plan = { ...good, bridge: { ...good.bridge, title: "Harvest Film Days", evidence: ["E2", "E4"] } };
    expect(groundingProblems(plan, withLead())).toEqual(['the bridge "Harvest Film Days" is named only on a web page; the bridge must be a name from Qloo evidence']);
  });
});

// lib/wording.ts, on a whole draft. The sentences have the shape of the real ones of 2026-10-11.
describe("a draft is set right by rule before it is checked", () => {
  const claimed: DraftPlan = {
    ...good,
    bridge: { ...good.bridge, why: "{grandparent} will love her songs, the kind of music she adores. {visitor} may like their warmth." },
    moments: [
      { ...good.moments[0]!, what_to_do: "A film in the style you both enjoy." },
      { ...good.moments[1]!, what_to_do: "Share the ritual {grandparent} loves." }, // the family's own favorite: saying so is true
      good.moments[2]!,
    ],
  };

  it("names each claim when a plan comes unrepaired", () => {
    expect(groundingProblems(claimed, ledger())).toEqual([
      'bridge "Natalia Lafourcade" says what they already love or lived ("she adores"), which the family did not tell us; put it as a hope ("may", "might") or name one of their own favorites',
      'moment 1 "Coco" says what they already love or lived ("you both enjoy"), which the family did not tell us; put it as a hope ("may", "might") or name one of their own favorites',
    ]);
  });

  it("takes the claim out, keeps what is left, falls back to plain words, and leaves their own favorite alone", () => {
    const { plan, notes } = tidied(claimed, ledger());
    expect(plan.bridge.why).toBe("{visitor} may like their warmth.");
    expect(plan.moments[0]!.what_to_do).toBe("Watch it together, and stop whenever there is something to talk about.");
    expect(plan.moments[1]!.what_to_do).toBe("Share the ritual {grandparent} loves.");
    expect(notes).toEqual(["Took out 2 sentences that said more about them than the family told us"]);
    expect(groundingProblems(plan, ledger())).toEqual([]);
  });

  // The rule on style covers what the planner writes (bus 007b). Invented sentences, in the planner's manner.
  it("lets no long dash through to a card or a question", () => {
    const dashed: DraftPlan = {
      bridge: { ...good.bridge, why: "{visitor} may like their warmth \u2014 and so may {grandparent}." },
      moments: [{ ...good.moments[0]!, what_to_do: "Watch it together \u2013 slowly \u2013 one evening." }, ...good.moments.slice(1)],
      questions: [{ text_en: "What would you play first \u2014 and why?" }, ...good.questions.slice(1)],
    };
    const { plan } = tidied(dashed, ledger());
    expect(JSON.stringify(plan)).not.toMatch(/[\u2012-\u2015]/);
    expect(plan.bridge.why).toBe("{visitor} may like their warmth, and so may {grandparent}.");
    expect(plan.moments[0]!.what_to_do).toBe("Watch it together, slowly, one evening.");
    expect(plan.questions[0]!.text_en).toBe("What would you play first, and why?");
  });

  // Real, 2026-10-11, on a card for a singer the family had listed: "the same emotional depth she loves in her
  // favorite music". Listing a singer does not make everything said on that card true.
  it("gives no leave to a card for a singer or a film they listed, only to a dish or an activity in their own words", () => {
    const l = ledger();
    l.add({ source: "qloo", tool: "search", label: "search", names: ["Pedro Infante"], kinds: ["artist"], entityIds: ["Q-PI"], urls: [], detail: null }); // E4
    const own = (l.items[0]!.names as string[]).push("Pedro Infante"); // the family listed him
    expect(own).toBe(2);
    const listed = { ...good, moments: [{ title: "Pedro Infante", kind: "artist" as const, what_to_do: "Play a few of his songs together. {visitor} may hear the same depth she loves in her favorite music.", evidence: ["E1", "E4"] }, ...good.moments.slice(1)] };
    expect(tidied(listed, l).plan.moments[0]!.what_to_do).toBe("Play a few of his songs together.");
  });

  it("sets {grandfather} right, and gives a card its plain line when it names anyone else in braces", () => {
    const named = {
      ...good,
      bridge: { ...good.bridge, why: "Her songs may speak to {grandfather} and to {visitor}." },
      moments: [{ ...good.moments[0]!, what_to_do: "Watch it with {uncle}." }, ...good.moments.slice(1)],
      questions: [{ text_en: "Which song would you play for {grandson}?" }, { text_en: "What would {uncle} say?" }, ...good.questions],
    };
    expect(groundingProblems(named, ledger())).toEqual([
      'question 1 names someone in braces other than {grandparent} and {visitor}',
      'question 2 names someone in braces other than {grandparent} and {visitor}',
      'bridge "Natalia Lafourcade" names someone in braces other than {grandparent} and {visitor}',
      'moment 1 "Coco" names someone in braces other than {grandparent} and {visitor}',
    ]);
    const { plan } = tidied(named, ledger());
    expect(plan.bridge.why).toBe("Her songs may speak to {grandparent} and to {visitor}.");
    expect(plan.moments[0]!.what_to_do).toBe("Watch it together, and stop whenever there is something to talk about.");
    expect(plan.questions.map((q) => q.text_en)).toEqual(["Which song would you play for {visitor}?", ...good.questions.map((q) => q.text_en)]);
    expect(groundingProblems(plan, ledger())).toEqual([]);
  });

  it("gives the bridge its plain line when nothing the planner wrote about it can stay", () => {
    const { plan } = tidied({ ...good, bridge: { ...good.bridge, why: "The music {grandparent} grew up with." } }, ledger());
    expect(plan.bridge.why).toBe(PLAIN_WHY);
  });

  const fine = ["Which song would you play first?", "What makes a film worth watching twice?", "What should we cook next time?"];
  const abuela = "What is a story your abuela told that you still carry?";
  const held = "What song would you want playing the first time you held me?";

  it("keeps the questions that assume nothing, in order, and says how many it left out", () => {
    const { plan, notes } = tidied({ ...good, questions: [fine[0]!, abuela, fine[1]!, held, fine[2]!].map((text_en) => ({ text_en })) }, ledger());
    expect(plan.questions.map((q) => q.text_en)).toEqual(fine);
    expect(notes).toEqual(["Left out 2 questions that assumed something about their life"]);
  });

  it("fills up from the plain questions when too few are left, those about the plan first", () => {
    const { plan } = tidied({ ...good, questions: [abuela, fine[0]!, "Do you remember your first dance?"].map((text_en) => ({ text_en })) }, ledger());
    expect(plan.questions.map((q) => q.text_en)).toEqual([fine[0], STOCK_QUESTIONS[0], STOCK_QUESTIONS[1]]);
    expect(groundingProblems(plan, ledger())).toEqual([]);
  });

  it("names the question when a plan comes unrepaired", () => {
    expect(groundingProblems({ ...good, questions: [abuela, fine[0]!, fine[1]!].map((text_en) => ({ text_en })) }, ledger())).toEqual([
      'question 1 assumes a relative ("abuela") that the family did not mention; ask about the plan or their tastes instead',
    ]);
  });
});

// Real, 2026-10-11: a plan for a family typed into the form held, beyond the bridge, only what they had listed
// themselves: three of their own singers and two things in their own words. Everything Qloo had suggested for them
// was in the evidence the planner read. The names here are invented; the shape is the real one.
// Real, 2026-10-12, in the plan recorded for the video: after "more music", two artists stood one above the other
// with the same sentence. The names below are invented.
describe("no two cards of a plan say the same sentence", () => {
  const PLAIN_MUSIC = "Play a little of this music together and see what you each make of it.";
  const card = (title: string, kind: DraftPlan["moments"][number]["kind"], what_to_do: string) => ({ title, kind, what_to_do, evidence: ["E2"] });
  const texts = (plan: DraftPlan) => plan.moments.map((m) => m.what_to_do);

  it("gives a second and a third card of one kind a line of their own", () => {
    const plan = withDistinctLines({ ...good, moments: [card("Singer One", "artist", PLAIN_MUSIC), card("Singer Two", "artist", PLAIN_MUSIC), card("A Song", "song", PLAIN_MUSIC)] });
    expect(texts(plan)[0]).toBe(PLAIN_MUSIC);
    expect(new Set(texts(plan)).size).toBe(3);
    expect(texts(plan).every((t) => t.endsWith("."))).toBe(true);
  });

  it("does the same when what was taken out left two cards with the plain line", () => {
    const claimed: DraftPlan = { ...good, moments: [card("Singer One", "artist", "The music {grandparent} grew up with."), card("Singer Two", "artist", "A voice {visitor} adores."), good.moments[1]!] };
    const tidy = tidied(claimed, ledger()).plan;
    expect(texts(tidy).slice(0, 2)).toEqual([PLAIN_MUSIC, PLAIN_MUSIC]); // the fault, as the rules before this one leave it
    const plan = withDistinctLines(tidy);
    expect(texts(plan)[0]).toBe(PLAIN_MUSIC);
    expect(texts(plan)[1]).not.toBe(PLAIN_MUSIC);
    expect(texts(plan)[2]).toBe("Cook them together.");
  });

  it("changes a sentence the planner itself wrote twice, and nothing that is said once", () => {
    const plan = withDistinctLines({ ...good, moments: [card("Film One", "film", "Watch it one evening."), card("Film Two", "film", "Watch it one evening."), card("Singer One", "artist", "Play one song.")] });
    expect(texts(plan)).toEqual(["Watch it one evening.", "Watch it together, and stop whenever there is something to talk about.", "Play one song."]);
  });

  it("leaves the caution on two web leads as it is: a warning should read the same each time", () => {
    const plan = withDistinctLines({ ...good, moments: [card("Fair One", "event", EVENT_NOTE), card("Fair Two", "event", EVENT_NOTE)] });
    expect(texts(plan)).toEqual([EVENT_NOTE, EVENT_NOTE]);
  });
});

describe("Qloo's own finds beyond the bridge", () => {
  function gathered(insights = true) {
    const l = new Ledger();
    const add = (tool: string, names: string[], kinds: string[], who?: "grandparent" | "visitor") =>
      l.add({ source: "qloo", tool, label: tool, names, kinds, entityIds: names.map((n) => `Q:${n}`), urls: [], detail: null, ...(who ? { asked: { who, kind: kinds[0]!, signalIds: [], entities: [] } } : {}) });
    l.add({ source: "family", tool: "input", label: "own words", names: ["Singer One", "Singer Two", "Singer Three", "spiced tea in the afternoon", "baking"], entityIds: [], urls: [], detail: null }); // E1
    for (const singer of ["Singer One", "Singer Two", "Singer Three"]) add("search", [singer], ["artist"]); // E2, E3, E4
    if (!insights) return l;
    add("insights", ["New Singer X", "Singer Two"], ["artist", "artist"], "visitor"); // E5: artists for the visitor, one of them their own
    add("insights", ["Old Film A", "Old Film B"], ["movie", "movie"], "grandparent"); // E6: films for the grandparent, asked for later
    add("bridge_check", ["The Bridge Film", "Ranked Film", "New Singer X"], ["film", "film", "artist"]); // E7
    return l;
  }
  const own = (title: string, kind: "artist" | "dish" | "activity", evidence: string[]) => ({ title, kind, what_to_do: "Do it together.", evidence });
  const allTheirOwn: DraftPlan = {
    bridge: { title: "The Bridge Film", kind: "film", why: "It may speak to them both.", evidence: ["E7"] },
    moments: [own("Singer One", "artist", ["E1", "E2"]), own("Singer Two", "artist", ["E1", "E3"]), own("Singer Three", "artist", ["E1", "E4"]), own("spiced tea in the afternoon", "dish", ["E1"]), own("baking", "activity", ["E1"])],
    questions: good.questions,
  };
  const titles = (plan: DraftPlan) => plan.moments.map((m) => m.title);

  // The grandparent's list comes first whatever order Qloo was asked in, so the first finds are from both sides.
  it("lists what Qloo suggested and they did not list, one from each list in turn, the grandparent's first", () => {
    expect(qlooFinds(gathered())).toEqual([
      { title: "Old Film A", kind: "film", evidence: ["E6"] },
      { title: "New Singer X", kind: "artist", evidence: ["E5", "E7"] },
      { title: "Old Film B", kind: "film", evidence: ["E6"] },
      { title: "The Bridge Film", kind: "film", evidence: ["E7"] },
      { title: "Ranked Film", kind: "film", evidence: ["E7"] },
    ]);
  });

  it("gives the second and third of their own singers' places to Qloo's finds, with a plain line each", () => {
    const { plan, added } = withQlooFinds(allTheirOwn, gathered());
    expect(added).toBe(2);
    expect(titles(plan)).toEqual(["Singer One", "Old Film A", "New Singer X", "spiced tea in the afternoon", "baking"]);
    expect(plan.moments[1]).toEqual({ title: "Old Film A", kind: "film", what_to_do: "Watch it together, and stop whenever there is something to talk about.", evidence: ["E6"] });
    expect(plan.moments[2]).toEqual({ title: "New Singer X", kind: "artist", what_to_do: "Play a little of this music together and see what you each make of it.", evidence: ["E5", "E7"] });
    expect(groundingProblems(plan, gathered())).toEqual([]);
    // Of the five, the four shown keep both finds.
    expect(titles(withShownMoments(plan, undefined, gathered()))).toEqual(["Singer One", "Old Film A", "New Singer X", "spiced tea in the afternoon"]);
  });

  it("adds finds to a plan that has none, and spares them when four are shown", () => {
    const short = { ...allTheirOwn, moments: [allTheirOwn.moments[0]!, allTheirOwn.moments[3]!, allTheirOwn.moments[4]!] };
    const { plan, added } = withQlooFinds(short, gathered());
    expect(added).toBe(2);
    expect(titles(plan)).toEqual(["Singer One", "spiced tea in the afternoon", "baking", "Old Film A", "New Singer X"]);
    expect(titles(withShownMoments(plan, undefined, gathered()))).toEqual(["Singer One", "spiced tea in the afternoon", "Old Film A", "New Singer X"]);
  });

  it("leaves a plan alone that already holds two finds and one of their own works", () => {
    const fine = { ...allTheirOwn, moments: [allTheirOwn.moments[0]!, { title: "Old Film A", kind: "film" as const, what_to_do: "Watch it.", evidence: ["E6"] }, { title: "New Singer X", kind: "artist" as const, what_to_do: "Play one song.", evidence: ["E5"] }, allTheirOwn.moments[3]!] };
    expect(withQlooFinds(fine, gathered())).toEqual({ plan: fine, added: 0 });
  });

  it("changes nothing when Qloo suggested nothing beyond their own lists", () => {
    expect(withQlooFinds(allTheirOwn, gathered(false))).toEqual({ plan: allTheirOwn, added: 0 });
  });

  it("puts in nothing the last visit ruled out", () => {
    const wishes: Wishes = { more: [], avoid: ["film"], noRepeat: ["New Singer X"] };
    expect(qlooFinds(gathered(), wishes)).toEqual([]);
    expect(withQlooFinds(allTheirOwn, gathered(), wishes).added).toBe(0);
    expect(qlooFinds(gathered(), { more: [], avoid: ["film"], noRepeat: [] }).map((f) => f.title)).toEqual(["New Singer X"]);
  });

  it("without the evidence at hand, shows the first four as before", () => {
    expect(titles(withShownMoments(withQlooFinds(allTheirOwn, gathered()).plan))).toEqual(["Singer One", "Old Film A", "New Singer X", "spiced tea in the afternoon"]);
    expect(titles(withShownMoments(allTheirOwn))).toEqual(["Singer One", "Singer Two", "Singer Three", "spiced tea in the afternoon"]);
  });
});
