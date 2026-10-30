import { describe, expect, it } from "vitest";
import { isOwnFavorite, questionProblem, STOCK_QUESTIONS, tasteClaim, translationProblem, withKnownNames, withoutClaims, withoutLongDashes } from "@/lib/wording";

// Each rule here comes from a real plan made on 2026-10-11 that got past every check. The sentences keep the shape of
// the real ones; the titles and places in them are invented or are the sample family's own words (Qloo's guide: no
// Qloo response data in a public repository).
const FAVORITES = ["Pedro Infante", "Roman Holiday", "Javier Solis", "making tamales at Christmas", "Bad Bunny", "Spirited Away", "baking"];

describe("a card may not say what they already love or lived", () => {
  // The saved plan's bridge card said what cinema she "adores". Her favorites were two singers, one film and a dish.
  const REAL_SHAPE =
    "{grandparent} will love its story about family and music, themes that echo the old studio musicals she adores. Its bright animation may speak to {visitor}, who loves Spirited Away.";

  it("takes out the sentence that reads a taste into her favorites, and keeps the one that names a favorite", () => {
    expect(withoutClaims(REAL_SHAPE, FAVORITES)).toEqual({
      kept: "Its bright animation may speak to {visitor}, who loves Spirited Away.",
      found: ["she adores"],
    });
  });

  // From a plan made with the first version of this rule, which let a whole sentence through when it named one
  // favorite anywhere. The favorite has to stand beside the claim it excuses.
  it("is not excused by a favorite named elsewhere in the sentence", () => {
    expect(tasteClaim("It may resonate with {grandparent}'s love for classic cinema and {visitor}'s love for Spirited Away.", FAVORITES)).toBe("{grandparent}'s love for");
    expect(tasteClaim("{visitor} is drawn to its bright animation, the same thing that makes Spirited Away a favorite.", FAVORITES)).toBe("{visitor} is drawn to");
    expect(tasteClaim("Its songs may speak to {grandparent}, who loves Pedro Infante, and to {visitor}, who loves anime.", FAVORITES)).toBe("who loves");
    expect(tasteClaim("Its songs may speak to {grandparent}, who loves Pedro Infante and Javier Solís, and to {visitor}, who loves Spirited Away and Bad Bunny.", FAVORITES)).toBeNull();
    expect(tasteClaim("They echo the Pedro Infante films she adores.", FAVORITES)).toBeNull();
  });

  // Real, 2026-10-11: a card's one sentence had a clean first half before a semicolon. That half is worth keeping.
  it("keeps the half of a sentence that stands before a semicolon", () => {
    expect(withoutClaims("Play a few of their boleros together and let the harmonies fill the room; {grandparent} may enjoy the close vocal blend she knows well.", FAVORITES)).toEqual({
      kept: "Play a few of their boleros together and let the harmonies fill the room.",
      found: ["she knows"],
    });
    expect(withoutClaims("A singer she has always loved; play one song and listen.", FAVORITES).kept).toBe("Play one song and listen.");
  });

  it("leaves a clean text exactly as the planner wrote it", () => {
    const text = "Watch it side by side; stop whenever there is something to talk about.";
    expect(withoutClaims(text, FAVORITES)).toEqual({ kept: text, found: [] });
  });

  it("keeps nothing of a text whose only sentence says what she grew up with", () => {
    expect(withoutClaims("Play a few of their boleros together and let the harmonies spark stories about the music {grandparent} grew up with.", FAVORITES)).toEqual({ kept: null, found: ["{grandparent} grew up"] });
  });

  it("catches each of the phrasings the six real plans used", () => {
    const claims: [string, string][] = [
      ["themes that echo the classic cinema she cherishes", "she cherishes"],
      ["echoing the passion and melodic soul she treasures", "she treasures"],
      ["the vocal-rich style {visitor} enjoys", "{visitor} enjoys"],
      ["the emotionally resonant storytelling you both appreciate", "you both appreciate"],
      ["Both of you love stories that weave family and music together.", "both of you love"],
      ["Latin rhythms and heartfelt songs they both feel", "they both feel"],
      ["it may resonate with her love of old films", "her love of"],
      ["familiar through the shared love of whimsical stories", "the shared love of"],
      ["a tale that feels close to both of their hearts", "close to both of their hearts"],
      ["{grandparent}, who loves classic cinema", "who loves"],
      ["the identity-driven animation style they adore", "they adore"],
      ["the golden era {grandparent} knows", "{grandparent} knows"],
      ["the melodic sound {visitor} responds to", "{visitor} responds to"],
      ["a singer she has always loved", "she has always loved"],
      ["let the sound spark memories of radio nights and family gatherings", "memories of"],
      ["the films and songs that shaped your youth", "shaped your"],
      ["a tune that takes her straight back", "takes her straight back"],
      ["a nod to her heritage", "her heritage"],
    ];
    for (const [sentence, phrase] of claims) expect(tasteClaim(sentence, FAVORITES), sentence).toBe(phrase);
  });

  it("lets a hope, an open question and a named favorite through", () => {
    const fine = [
      "{grandparent} will love its heartfelt story.",
      "Its songs may speak to {grandparent}, and its warmth to {visitor}.",
      "See if {grandparent} likes it, and ask what {visitor} loves about it.",
      "Its boleros may speak to {grandparent}, who loves Pedro Infante.",
      "Watch it side by side, and stop whenever there is something to talk about.",
      "The festival is worth a look before you go.",
      "A film from the years when {grandparent} was young.",
      "{visitor}, who enjoys baking, may like the quiet of it.",
      "Sit close, so {grandparent} feels at ease.",
      "Both of their tastes share Latin music and stories about family.",
    ];
    for (const sentence of fine) expect(tasteClaim(sentence, FAVORITES), sentence).toBeNull();
  });

  it("knows a card that is one of their own favorites, where saying they love it is simply true", () => {
    expect(isOwnFavorite("making tamales at Christmas", FAVORITES)).toBe(true);
    expect(isOwnFavorite("Tamales", ["making tamales at Christmas"])).toBe(true);
    expect(isOwnFavorite("Los Tres Reyes", FAVORITES)).toBe(false);
  });
});

// Real, 2026-10-11: a plan for a grandfather wrote {grandfather} where the page fills in {grandparent}. The page
// would have shown the braces.
describe("the two names the page fills in", () => {
  it("sets right a name that means the same person", () => {
    expect(withKnownNames("Its story may speak to {grandfather}, and to {visitor}.")).toBe("Its story may speak to {grandparent}, and to {visitor}.");
    expect(withKnownNames("{Grandma} may like it, and so may {grandson}.")).toBe("{grandparent} may like it, and so may {visitor}.");
    expect(withKnownNames("Nothing to change for {grandparent} and {visitor}.")).toBe("Nothing to change for {grandparent} and {visitor}.");
  });

  it("refuses a text with any other name in braces, or a stray brace", () => {
    expect(withKnownNames("Play it for {aunt} too.")).toBeNull();
    expect(withKnownNames("Play it for {grandparent too.")).toBeNull();
    expect(withKnownNames("Play it for grandparent} too.")).toBeNull();
  });
});

// Seen on real plans on 2026-10-11: the planner writes long dashes into its sentences. The rule on style covers
// what the page shows. These sentences are invented.
describe("no long dash reaches the page", () => {
  it("turns a dash between words into a comma", () => {
    expect(withoutLongDashes("It may feel close to {grandparent} \u2014 and to {visitor} too.")).toBe("It may feel close to {grandparent}, and to {visitor} too.");
    expect(withoutLongDashes("A gentle film \u2013 slow, warm \u2013 for an evening.")).toBe("A gentle film, slow, warm, for an evening.");
    expect(withoutLongDashes("Play it softly\u2014then ask.")).toBe("Play it softly, then ask.");
    expect(withoutLongDashes("\u00bfQu\u00e9 canci\u00f3n pondr\u00edas primero \u2014 y por qu\u00e9?")).toBe("\u00bfQu\u00e9 canci\u00f3n pondr\u00edas primero, y por qu\u00e9?");
  });

  it("turns a dash between two numbers into a hyphen", () => {
    expect(withoutLongDashes("Films of 1950\u20131970 may suit them.")).toBe("Films of 1950-1970 may suit them.");
  });

  it("leaves no stray comma at an edge or before a full stop", () => {
    expect(withoutLongDashes("\u2014 Play it softly \u2014")).toBe("Play it softly");
    expect(withoutLongDashes("Play it softly \u2014.")).toBe("Play it softly.");
  });

  it("leaves a hyphen and a sentence without a dash alone", () => {
    expect(withoutLongDashes("A slow-cooked dish, shared.")).toBe("A slow-cooked dish, shared.");
  });
});

describe("a question may not assume a fact about their life", () => {
  const context = { titles: ["Los Tres Reyes", "Like Father, Like Son"], said: [...FAVORITES, "San Antonio, Texas", "Spanish"], known: ["Los Panchos", "Shared traits, strongest first: Latin (genre:music)"] };
  const problem = (text: string, over: Partial<typeof context> = {}) => questionProblem(text, { ...context, ...over });

  it("refuses the real one: a story her abuela told, when the family never mentioned her grandmother", () => {
    expect(problem("What is a story your abuela told that you still carry?")).toBe('assumes a relative ("abuela") that the family did not mention; ask about the plan or their tastes instead');
  });

  it("refuses the other real one: a song for the first time she held the visitor", () => {
    expect(problem("What song would you want playing the first time you held me?")).toContain("assumes something the two of them did long ago");
  });

  it("refuses a husband, a hometown, a job, a school, a faith and a loss nobody mentioned", () => {
    const assumed: [string, string][] = [
      ["What did your husband sing to you?", "a husband, a wife or a wedding"],
      ["What music played at your wedding?", "a husband, a wife or a wedding"],
      ["What did your mother cook on Sundays?", "a relative"],
      ["What did you sing to your children?", "a relative"],
      ["What was the cinema like in your hometown?", "where they come from"],
      ["What films did you watch where you grew up?", "where they come from"],
      ["What songs did you hum at your job?", "their work"],
      ["Which song did you learn at school?", "their schooling"],
      ["What did you sing in church?", "their faith"],
      ["What music helped you during the war?", "a loss or a war"],
    ];
    for (const [question, what] of assumed) expect(problem(question), question).toContain(`assumes ${what}`);
  });

  it("refuses a country or a people the family did not name", () => {
    expect(problem("What was your favorite cinema back in Mexico?")).toBe('names "Mexico", which the family did not mention; ask about the plan or their tastes instead');
    expect(problem("Which Mexican singer would you take to a desert island?")).toContain('names "Mexican"');
    expect(problem("Would you sing along to Los Dandys?")).toContain('names "Dandys"'); // "Los" is in a name Qloo gave
  });

  it("lets through what the family said themselves: their own words, the city and the language", () => {
    expect(problem("What do you put in the tamales at Christmas?")).toBeNull();
    expect(problem("What do you put in the tamales at Christmas?", { said: ["Pedro Infante"] })).toContain('names "Christmas"');
    expect(problem("What do you like best about San Antonio?")).toBeNull();
    expect(problem("Which Spanish word do you love the sound of?")).toBeNull();
    expect(problem("What did you sing in church?", { said: ["singing in the church choir"] })).toBeNull();
    expect(problem("What did your mother put in her mole?", { said: ["my mother's mole"] })).toBeNull();
  });

  it("lets through a card's title, whatever words it holds, and a name from Qloo's answers", () => {
    expect(problem("What did you think of Like Father, Like Son?")).toBeNull();
    expect(problem("Would you sing along to Los Panchos or Los Tres Reyes?")).toBeNull();
    expect(problem("Which Latin song makes you want to dance?")).toBeNull();
  });

  it("lets through the three questions of the saved plan, which assume nothing", () => {
    for (const question of [
      "What song would you play for me if we could hear any orchestra right now?",
      "Which holiday kitchen smell takes you straight back to childhood?",
      "If you could step into any animated world for a day, which one would you choose?",
    ]) {
      expect(problem(question), question).toBeNull();
    }
  });

  // Real, 2026-10-11: "What memory comes up when you hear [an artist Qloo suggested]?" She may never have heard them.
  it("refuses a memory of something that is only a suggestion, and allows one of their own favorite", () => {
    expect(problem("What memory comes up when you hear Los Tres Reyes?")).toBe('assumes they already know "Los Tres Reyes", which is only a suggestion; ask what they make of it instead');
    expect(problem("What memory comes up when you make tamales?", { titles: ["making tamales at Christmas", "Los Tres Reyes"] })).toBeNull();
    expect(problem("What does Pedro Infante remind you of?", { titles: ["Pedro Infante"] })).toBeNull();
    expect(problem("Which song by Los Tres Reyes would you play first?")).toBeNull();
  });

  it("still refuses a memory test", () => {
    expect(problem("Do you remember your first dance?")).toBe('tests memory ("do you remember"); invite a story instead');
  });

  it("has plain questions in reserve that pass every rule with no context at all", () => {
    for (const question of STOCK_QUESTIONS) expect(questionProblem(question, { titles: [], said: [], known: [] }), question).toBeNull();
  });
});

describe("a question in the grandparent's language", () => {
  const spanish = (native: string, english = "What was a song that felt like it was written just for you?", relation: "grandmother" | "grandfather" | undefined = "grandmother") => translationProblem("Spanish", relation, native, english);

  // The real one, with "song" for "film": the English "felt like" put word for word, so the song is the one that feels.
  it("catches the real slip: \"que sintió como si\"", () => {
    expect(spanish("¿Cuál fue una canción que sintió como si hubiera sido escrita solo para ti?")).toBe('puts "felt like" word for word ("sintió como si")');
  });

  it("lets the same thought through when it is said as Spanish says it", () => {
    expect(spanish("¿Qué canción sentiste que estaba escrita solo para ti?")).toBeNull();
    expect(spanish("¿Cuál fue una canción que se sintió como si la hubieran escrito solo para ti?")).toBeNull();
    expect(spanish("¿Qué canción te hizo sentir como si la hubieran escrito para ti?")).toBeNull();
  });

  it("catches a question without its opening mark, and one left in English", () => {
    expect(spanish("Qué canción te gusta más?")).toBe("lacks an opening or a closing question mark");
    expect(spanish("What was a song that felt like it was written just for you?")).toBe("is still in English");
  });

  it("catches words that speak to a grandmother as a man, and the other way round", () => {
    expect(spanish("¿Qué te gustaba cantar de niño?", "What did you like to sing as a child?")).toBe("speaks to a grandmother in the masculine");
    expect(spanish("¿Qué te gustaba cantar de niña?", "What did you like to sing as a child?")).toBeNull();
    expect(spanish("¿Qué te gustaba cantar cuando eras pequeña?", "What did you like to sing as a child?", "grandfather")).toBe("speaks to a grandfather in the feminine");
    expect(translationProblem("Spanish", undefined, "¿Qué te gustaba cantar de niño?", "What did you like to sing as a child?")).toBeNull(); // not known: no rule
  });

  // Seen on 2026-10-11 for a grandmother and her grandson: "juntas". Nothing about the visitor is ever sent.
  it("catches a word that makes the two of them women", () => {
    expect(spanish("¿Cuál es tu cosa favorita para hornear juntas?", "What is your favorite thing to bake together?")).toBe("says the two of them are women, which nobody told it");
    expect(spanish("¿Qué te gusta más que horneemos juntos?", "What is your favorite thing to bake together?")).toBeNull();
  });

  // Real, 2026-10-11, in Hindi: the English title of a film came back as the Hindi words for what it means. In a language
  // written in Latin letters a rule can see it. The title here is the sample family's own favorite.
  it("catches a title that was translated, where the language is written in Latin letters", () => {
    const titles = ["Roman Holiday"];
    expect(translationProblem("Spanish", "grandmother", "¿Qué escena de Vacaciones en Roma te gustó más?", "Which scene in Roman Holiday did you like most?", titles)).toBe('changes the title "Roman Holiday"');
    expect(translationProblem("Spanish", "grandmother", "¿Qué escena de Roman Holiday te gustó más?", "Which scene in Roman Holiday did you like most?", titles)).toBeNull();
    expect(translationProblem("Hindi", "grandfather", "रोमन हॉलिडे का कौन सा दृश्य आपको सबसे अच्छा लगा?", "Which scene in Roman Holiday did you like most?", titles)).toBeNull(); // another script: no rule
  });

  it("catches a name added or lost", () => {
    expect(spanish("¿Qué canción te gusta, {grandparent}?", "What song do you like?")).toBe("changes who is named");
    expect(spanish("¿Qué canción le pondrías a {visitor}?", "What song would you play for {visitor}?")).toBeNull();
  });

  it("holds Hindi to the script and to the respectful form of address", () => {
    const hindi = (native: string) => translationProblem("Hindi", "grandfather", native, "Which song do you like most?");
    expect(hindi("आपको कौन सा गाना सबसे ज़्यादा पसंद है?")).toBeNull();
    expect(hindi("तुम्हें कौन सा गाना सबसे ज़्यादा पसंद है?")).toBe("uses the familiar तुम or तू for an elder");
    expect(hindi("तू कौन सा गाना सुनता है?")).toBe("uses the familiar तुम or तू for an elder");
    expect(hindi("Aapko kaun sa gaana sabse zyada pasand hai?")).toBe("is not written in Devanagari");
  });

  it("has no rule for a language it was not taught, beyond the names and the English", () => {
    expect(translationProblem("Tagalog", undefined, "Anong kanta ang pinakagusto mo?", "Which song do you like most?")).toBeNull();
    expect(translationProblem("Tagalog", undefined, "", "Which song do you like most?")).toBe("is empty");
  });
});
