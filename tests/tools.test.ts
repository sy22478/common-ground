import { describe, expect, it } from "vitest";
import { limits } from "@/lib/config";
import { isSameName, Ledger } from "@/lib/evidence";
import type { QlooEntity } from "@/lib/qloo";
import { runToolCall, runToolCalls, startToolCalls, toolSpecs, type ToolContext } from "@/lib/tools";
import { FakeQloo, FakeTavily, call } from "./helpers";

const ctx = (over: Partial<ToolContext> = {}): ToolContext => ({
  qloo: new FakeQloo(),
  tavily: new FakeTavily(),
  ledger: new Ledger(),
  limits: limits({}),
  city: "San Antonio, Texas",
  webSearches: 0,
  ids: { grandparent: [], visitor: [] },
  placeTags: [],
  qlooAnswers: 0,
  qlooFailures: 0,
  ...over,
});

describe("tool calls", () => {
  it("sends a wrong argument name back to the model, then accepts the corrected call", async () => {
    const c = ctx();
    // Nemotron 3 Super did exactly this in the smoke test: "types" where the schema says "type".
    const bad = await runToolCall(call("qloo_search", { query: "Pedro Infante", types: "artist", for: "grandparent" }), c);
    expect(bad.ok).toBe(false);
    expect(bad.content).toMatch(/invalid arguments for qloo_search: type/);
    const good = await runToolCall(call("qloo_search", { query: "Pedro Infante", type: "artist", for: "grandparent" }), c);
    expect(good.ok).toBe(true);
    expect(good.evidence).toBe("E1");
    expect(c.ledger.knowsEntity("Q-PI")).toBe(true);
  });

  it("search: only the best match is evidence, and a result of another name is dropped", async () => {
    const c = ctx();
    const qloo = c.qloo as FakeQloo;
    qloo.search = async () => [
      { id: "Q-1", name: "Spirited Away", kind: "movie", year: 2001, tags: [] },
      { id: "Q-2", name: "Carried Away", kind: "movie", year: 2000, tags: [] },
      { id: "Q-3", name: "Spirited Away", kind: "movie", year: 2022, tags: [] },
    ];
    const out = await runToolCall(call("qloo_search", { query: "Spirited Away", type: "movie", for: "visitor" }), c);
    expect(out.summary).toBe('Qloo search "Spirited Away" (movie): Spirited Away');
    // Two films of that name: the model reads both, and can tell them apart by the year. The near-miss is gone.
    expect(JSON.parse(out.content).results.map((r: { name: string; year: number }) => [r.name, r.year])).toEqual([["Spirited Away", 2001], ["Spirited Away", 2022]]);
    expect(c.ledger.get("E1")).toMatchObject({ names: ["Spirited Away"], display: ["Spirited Away (2001)"] });
    expect(c.ids.visitor).toEqual(["Q-1"]);
    expect(c.ledger.knowsEntity("Q-3")).toBe(true);
    expect(c.ledger.knowsEntity("Q-2")).toBe(false);
  });

  // Real, 2026-10-12, in the second plan recorded for the video. After a visit the gathering model searched Qloo for
  // a habit the family had named, as a place. Qloo's search always answers: the first of five results was a place
  // with one word of the phrase in its name. The code took it for the grandparent's favorite, so its id went out
  // with every later call as one of her signals, and Qloo's suggestions for her changed (4 of 8 names, measured on
  // 2026-10-13). Every name and phrase below is invented.
  describe("a search result is a favorite only if it is called what was asked for", () => {
    const answering = (c: ToolContext, ...found: QlooEntity[]) => {
      (c.qloo as FakeQloo).search = async () => found;
    };
    const place = (id: string, name: string): QlooEntity => ({ id, name, kind: "place", note: "1 Example Rd Example Town, TN 00000", tags: [] });

    it("takes no result for a habit in the family's own words, and tells the model to leave it", async () => {
      const c = ctx();
      await runToolCall(call("qloo_search", { query: "Pedro Infante", type: "artist", for: "grandparent" }), c); // E1
      answering(c, place("Q-LODGE", "The Example Lodge at Harvest Place"), place("Q-FAIR", "Harvest at the Example Fair"));
      const out = await runToolCall(call("qloo_search", { query: "pressing cider at harvest", type: "place", for: "grandparent" }), c); // E2, empty

      expect(out).toMatchObject({ ok: true, summary: 'Qloo search "pressing cider at harvest" (place): nothing by that name', names: [] });
      expect(JSON.parse(out.content)).toEqual({
        evidence: "E2",
        results: [],
        note: 'Qloo has nothing called "pressing cider at harvest". Leave it out: do not search for it again, under this type or another. If it names a food, qloo_tags is the tool for it.',
      });
      // Her signals are her real favorite and nothing else, in what the code keeps and in what goes to Qloo.
      expect(c.ids.grandparent).toEqual(["Q-PI"]);
      expect(c.ledger.knowsEntity("Q-LODGE")).toBe(false);
      expect(c.ledger.supports("The Example Lodge at Harvest Place", ["E2"])).toBe(false);
      await runToolCall(call("qloo_insights", { for: "grandparent", type: "artist", entity_ids: ["Q-PI"] }), c);
      expect((c.qloo as FakeQloo).calls.at(-1)).toBe("insights:artist:Q-PI");
      // And the model cannot bring the id in by hand.
      expect(await runToolCall(call("qloo_insights", { for: "grandparent", type: "artist", entity_ids: ["Q-PI", "Q-LODGE"] }), c)).toMatchObject({ ok: false, summary: "Rejected unknown ids" });
    });

    it("takes the result that carries the name when it is not the first, a slip of one letter and all", async () => {
      const c = ctx();
      answering(c, { id: "Q-1", name: "Javier Montoya Example", kind: "artist", tags: [] }, { id: "Q-2", name: "Javier Solís", kind: "artist", tags: [] });
      const out = await runToolCall(call("qloo_search", { query: "Javier Soliz", type: "artist", for: "grandparent" }), c);
      expect(out.summary).toBe('Qloo search "Javier Soliz" (artist): Javier Solís');
      expect(c.ids.grandparent).toEqual(["Q-2"]);
      expect(c.ledger.knowsEntity("Q-1")).toBe(false);
    });

    it("knows a film by its title in another language, from the other names Qloo gives it", async () => {
      const c = ctx();
      answering(c, { id: "Q-1", name: "The Long Harvest", kind: "movie", year: 1955, tags: [], akas: ["Die lange Ernte", "La larga cosecha"] });
      const out = await runToolCall(call("qloo_search", { query: "La Larga Cosecha", type: "movie", for: "grandparent" }), c);
      expect(out.summary).toBe('Qloo search "La Larga Cosecha" (movie): The Long Harvest');
      expect(c.ids.grandparent).toEqual(["Q-1"]);
      expect(out.content).not.toContain("Die lange Ernte"); // the other names are for matching: the model is not sent them
    });

    it("lets the first result stand when it was asked for in another script and there is nothing to compare", async () => {
      const c = ctx();
      answering(c, { id: "Q-1", name: "Primer Gruppa", kind: "artist", tags: [] }, { id: "Q-2", name: "Something Popular", kind: "artist", tags: [] });
      expect((await runToolCall(call("qloo_search", { query: "Пример Группа", type: "artist", for: "grandparent" }), c)).summary).toBe('Qloo search "Пример Группа" (artist): Primer Gruppa');
      expect(c.ids.grandparent).toEqual(["Q-1"]);
      expect(c.ledger.knowsEntity("Q-2")).toBe(false);
      // With a name in that script to compare with, a result that is called something else is refused as usual.
      answering(c, { id: "Q-3", name: "Drugoe Imya", kind: "artist", tags: [], akas: ["Другое Имя"] });
      expect((await runToolCall(call("qloo_search", { query: "Пример Песня", type: "artist", for: "grandparent" }), c)).summary).toMatch(/nothing by that name$/);
      expect(c.ids.grandparent).toEqual(["Q-1"]);
    });

    it("takes one name of an artist's two, and not one common word of a place's three", async () => {
      const c = ctx();
      answering(c, { id: "Q-1", name: "Marisol Rivas", kind: "artist", tags: [] });
      expect((await runToolCall(call("qloo_search", { query: "Marisol", type: "artist", for: "visitor" }), c)).summary).toMatch(/: Marisol Rivas$/);
      answering(c, place("Q-2", "Empanadas Example Corner"));
      expect((await runToolCall(call("qloo_search", { query: "empanadas", type: "place", for: "visitor" }), c)).summary).toMatch(/nothing by that name$/);
      expect(c.ids.visitor).toEqual(["Q-1"]);
    });
  });

  describe("the same name", () => {
    it.each([
      ["Javier Solis", "Javier Solís", "artist"],
      ["the Example Band", "Example Band", "artist"],
      ["Javier Soliz", "Javier Solís", "artist"], // one letter off in a name of two words
      ["Example Singers", "Example Singers of the North", "artist"], // part of a longer name, and more than half of it
      ["Roman Holiday 1953", "Roman Holiday", "movie"],
      ["Marisol", "Marisol Rivas", "artist"],
      ["Пример Группа", "пример группа", "artist"],
    ])("%s is %s", (asked, found, kind) => {
      expect(isSameName(asked, found, kind)).toBe(true);
    });

    it.each([
      ["pressing cider at harvest", "The Example Lodge at Harvest Place", "place"], // one word shared
      ["empanadas", "Empanadas Example Corner", "place"], // a common word is one word of many names
      ["knitting", "Knittingo", "place"], // one letter off, but a single word has to be exact
      ["Marisol", "Marisol Rivas", "movie"], // one name of two is for artists only
      ["Marisol", "Marisol Rivas and the Example Players", "artist"], // less than half of the name
      ["Пример Группа", "Пример Песня", "artist"],
      ["Example Band", "", "artist"],
    ])("%s is not %s", (asked, found, kind) => {
      expect(isSameName(asked, found, kind)).toBe(false);
    });
  });

  it("compare: shared traits reach the planner as context and can never be the title of a card", async () => {
    const c = ctx();
    await runToolCall(call("qloo_search", { query: "Pedro Infante", type: "artist", for: "grandparent" }), c); // E1
    await runToolCall(call("qloo_search", { query: "Bad Bunny", type: "artist", for: "visitor" }), c); // E2
    const out = await runToolCall(call("qloo_compare", { grandparent_ids: ["Q-PI"], visitor_ids: ["Q-BB"] }), c);
    expect(out).toMatchObject({ ok: true, evidence: "E3", summary: "Qloo compare, what they share: Example Ballad, Example Theme, Example Strings" });
    expect(JSON.parse(out.content).shared_traits[0]).toEqual({ name: "Example Ballad", kind: "genre:music" });
    expect(c.ledger.get("E3")).toMatchObject({ names: [], context: "Shared traits, strongest first: Example Ballad (genre:music); Example Theme (theme); Example Strings (instrument:music)" });
    expect(c.ledger.supports("Example Ballad", ["E3"])).toBe(false);
    expect(c.ledger.summary()).toContain("E3 [qloo:compare] Qloo compare, what their two tastes share: \n   Shared traits, strongest first: Example Ballad (genre:music)");
  });

  it("rejects entity ids the agent never found, without calling Qloo", async () => {
    const qloo = new FakeQloo();
    const out = await runToolCall(call("qloo_insights", { for: "grandparent", type: "movie", entity_ids: ["made-up"] }), ctx({ qloo }));
    expect(out.ok).toBe(false);
    expect(out.content).toMatch(/unknown entity ids made-up/);
    expect(qloo.calls).toEqual([]);
  });

  it("limits web searches per plan", async () => {
    const c = ctx();
    for (let i = 0; i < 2; i++) expect((await runToolCall(call("web_search", { query: `event ${i} san antonio` }), c)).ok).toBe(true);
    const third = await runToolCall(call("web_search", { query: "one more event" }), c);
    expect(third.ok).toBe(false);
    expect((c.tavily as FakeTavily).queries).toHaveLength(2);
  });

  it("reports a missing Qloo key as a tool error, not a crash", async () => {
    const out = await runToolCall(call("qloo_search", { query: "x", type: "artist", for: "grandparent" }), ctx({ qloo: null }));
    expect(out).toMatchObject({ ok: false, content: "error: Qloo is not available right now" });
  });

  it("runs the calls of one reply together, a few at a time, and records them in the order they were made", async () => {
    const c = ctx();
    const qloo = c.qloo as FakeQloo;
    let running = 0;
    let most = 0;
    const finished: string[] = [];
    // The first search is the slowest: its answer comes back last.
    qloo.search = async (query: string): Promise<QlooEntity[]> => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, query === "one" ? 40 : 5));
      running -= 1;
      finished.push(query);
      return [{ id: `Q-${query}`, name: query, kind: "artist", tags: [] }];
    };
    const names = ["one", "two", "three", "four", "five", "six"];
    const started = startToolCalls(names.map((query) => call("qloo_search", { query, type: "artist", for: "grandparent" })), c);
    const outcomes = [];
    for (const commit of started) outcomes.push((await commit)());

    expect(most).toBe(4); // never more than four on the wire: Qloo allows five a second
    expect(finished[0]).not.toBe("one");
    expect(finished.at(-1)).not.toBe("six");
    expect(outcomes.map((o) => o.evidence)).toEqual(["E1", "E2", "E3", "E4", "E5", "E6"]);
    expect(c.ledger.items.map((i) => i.names[0])).toEqual(names);
  });

  it("lets a call use an id found by a search made before it in the same reply", async () => {
    const c = ctx();
    const outcomes = [];
    const reply = [
      call("qloo_search", { query: "Pedro Infante", type: "artist", for: "grandparent" }),
      call("qloo_insights", { for: "grandparent", type: "movie", entity_ids: ["Q-PI"] }),
      call("qloo_insights", { for: "grandparent", type: "artist", entity_ids: ["made-up"] }),
    ];
    for await (const outcome of runToolCalls(reply, c)) outcomes.push(outcome);
    expect(outcomes.map((o) => [o.ok, o.evidence])).toEqual([
      [true, "E1"],
      [true, "E2"],
      [false, undefined],
    ]);
  });

  it("asks Qloo with all of a person's ids, whichever of them the model passes", async () => {
    const c = ctx();
    const qloo = c.qloo as FakeQloo;
    for (const [query, type, who] of [["Pedro Infante", "artist", "grandparent"], ["Roman Holiday", "movie", "grandparent"], ["Bad Bunny", "artist", "visitor"], ["Spirited Away", "movie", "visitor"]]) {
      await runToolCall(call("qloo_search", { query, type, for: who }), c);
    }
    expect(c.ids).toEqual({ grandparent: ["Q-PI", "Q-RH"], visitor: ["Q-BB", "Q-SA"] });

    // The model passes one id, or even one of the other person's: the call still goes out with that person's own.
    await runToolCall(call("qloo_insights", { for: "visitor", type: "movie", entity_ids: ["Q-SA"] }), c);
    await runToolCall(call("qloo_insights", { for: "grandparent", type: "artist", entity_ids: ["Q-PI", "Q-BB"] }), c);
    await runToolCall(call("qloo_insights", { for: "both", type: "movie", entity_ids: ["Q-RH"] }), c);
    await runToolCall(call("qloo_compare", { grandparent_ids: ["Q-RH"], visitor_ids: ["Q-BB"] }), c);
    expect(qloo.calls.slice(4)).toEqual([
      "insights:movie:Q-BB+Q-SA",
      "insights:artist:Q-PI+Q-RH",
      "insights:movie:Q-PI+Q-RH+Q-BB+Q-SA",
      "compare:Q-PI+Q-RH|Q-BB+Q-SA",
    ]);
    // An id nobody found is still refused.
    expect((await runToolCall(call("qloo_insights", { for: "visitor", type: "movie", entity_ids: ["made-up"] }), c)).ok).toBe(false);
  });

  // Qloo's fourth endpoint. A place search without a tag returned the city's landmarks (probe of 2026-10-11); with
  // the tag for a food the family named, it returns somewhere to eat it. The tags and places here are invented.
  describe("a food the family named becomes a kind of place near them", () => {
    const tags = call("qloo_tags", { query: "tamales" });
    const places = call("qloo_insights", { for: "both", type: "place", entity_ids: ["Q-PI"] });
    const searched = async (over: Partial<ToolContext> = {}) => {
      const c = ctx(over);
      await runToolCall(call("qloo_search", { query: "Pedro Infante", type: "artist", for: "grandparent" }), c); // E1
      return c;
    };

    it("keeps the tag that names a kind of place, as context and never as a title, and drops single dishes", async () => {
      const c = await searched();
      const out = await runToolCall(tags, c);
      expect(out).toMatchObject({ ok: true, evidence: "E2", summary: 'Qloo tags for "tamales": Tamale house' });
      expect(c.placeTags).toEqual([{ id: "urn:tag:genre:place:example_tamale_house", name: "Tamale house" }]);
      expect(c.ledger.get("E2")).toMatchObject({ source: "qloo", tool: "tags", names: [], context: 'The kind of place Qloo knows for "tamales": Tamale house' });
      expect(c.ledger.supports("Tamale house", ["E2"])).toBe(false); // a tag cannot be the title of a card
    });

    // Real, 2026-10-11: a search for a spiced tea brought back only dishes from single menus. No place carried the
    // first of them, and the planner made a dish card out of its name.
    it("finds no kind of place in a list of single dishes, and so starts no place search", async () => {
      const c = await searched();
      (c.qloo as FakeQloo).tags = async () => [
        { id: "urn:tag:specialty_dish:place:example_tea_ice_cream", name: "Example Tea Ice Cream", type: "urn:tag:specialty_dish:place", places: true },
        { id: "urn:tag:menu_highlight:qloo:example_tea_and_bun", name: "Example Tea And Bun", type: "urn:tag:menu_highlight:qloo", places: true },
      ];
      expect(await runToolCall(call("qloo_tags", { query: "spiced tea" }), c)).toEqual({ ok: true, content: 'no tag for a kind of place matches "spiced tea". Do not search tags again, and make no place search.', summary: 'Qloo tags for "spiced tea": no kind of place found' });
      expect(c.placeTags).toEqual([]);
      expect(c.ledger.items).toHaveLength(1); // nothing for the planner to make a card from
    });

    it("then looks for that kind of place near the city, for both of them, whatever the model passes", async () => {
      const c = await searched();
      await runToolCall(tags, c);
      const out = await runToolCall(places, c);
      expect((c.qloo as FakeQloo).calls.at(-1)).toBe("insights:place:Q-PI:tags=urn:tag:genre:place:example_tamale_house:near=San Antonio, Texas");
      expect(out.summary).toBe('Qloo place insights for both of them near San Antonio, of the kind "Tamale house": Example Tamale House, Second Example Kitchen');
      expect(c.ledger.get("E3")).toMatchObject({ kinds: ["place", "place"], notes: ["12 Example St Example City, TX 00000", "34 Sample Ave Example City, TX 00000"] });
      expect(c.ledger.noteOf("Example Tamale House", ["E3"])).toBe("12 Example St Example City, TX 00000");
    });

    it("waits for the tag search when the model puts both in one reply", async () => {
      const c = await searched();
      const outcomes = [];
      for await (const outcome of runToolCalls([tags, places], c)) outcomes.push(outcome);
      expect((c.qloo as FakeQloo).calls.at(-1)).toContain("tags=urn:tag:genre:place:example_tamale_house");
    });

    it("says so when Qloo has no kind of place for the word, and allows one tag search a plan", async () => {
      const c = await searched();
      expect(await runToolCall(call("qloo_tags", { query: "boleros" }), c)).toEqual({ ok: true, content: 'no tag for a kind of place matches "boleros". Do not search tags again, and make no place search.', summary: 'Qloo tags for "boleros": no kind of place found' });
      await runToolCall(tags, c);
      expect(await runToolCall(tags, c)).toMatchObject({ ok: false, summary: "One tag search a plan" });
      expect((c.qloo as FakeQloo).calls.filter((x) => x.startsWith("tags:"))).toHaveLength(2);
    });

    it("looks for no place at all when no city was given", async () => {
      const c = await searched({ city: undefined });
      await runToolCall(tags, c);
      expect(await runToolCall(places, c)).toEqual({ ok: false, content: "error: no city was given, so there are no places to look for; continue without them", summary: "No city given, so no places nearby" });
      expect((c.qloo as FakeQloo).calls.some((x) => x.startsWith("insights:place"))).toBe(false);
    });
  });

  // A real search on 2026-10-11 for the sample family's city brought back a family festival at a theatre in another
  // country, and the planner made a card of it. The pages here are invented; the shape is the real one.
  describe("a web result must name the grandparent's city", () => {
    const elsewhere = { title: "Autumn Family Festival - Example Playhouse", url: "https://playhouse.example/autumn-festival", snippet: "Performances, workshops and creative activities for the whole family." };
    const here = { title: "Free fall events downtown - City of San Antonio", url: "https://city.example/news", snippet: "The city invites everyone to the market square." };
    const inUrl = { title: "Film days", url: "https://arts.example/san-antonio/film-days", snippet: "Classic films on a big screen." };
    const searching = (results: (typeof here)[], city = "San Antonio, Texas") => {
      const c = ctx({ city });
      (c.tavily as FakeTavily).search = async () => results;
      return { c, out: runToolCall(call("web_search", { query: "family festival san antonio" }), c) };
    };

    it("keeps the pages that do, in the title, the snippet or the address, and drops the rest", async () => {
      const { c, out } = searching([elsewhere, here, inUrl]);
      expect((await out).names).toEqual([here.title, inUrl.title]);
      expect(c.ledger.items[0]).toMatchObject({ source: "tavily", names: [here.title, inUrl.title], urls: [here.url, inUrl.url] });
      expect(c.ledger.items[0]!.context).not.toContain("Example Playhouse");
    });

    it("says so in plain words, and records nothing, when no page does", async () => {
      const { c, out } = searching([elsewhere]);
      expect(await out).toEqual({ ok: true, content: "no result names San Antonio, so there is no local event to suggest. Do not search the web again: continue without one.", summary: "Web: nothing that names San Antonio, so this plan has no local events" });
      expect(c.ledger.items).toHaveLength(0);
    });

    it("reads the city however it was typed, and does not mistake part of a word for it", async () => {
      expect((await searching([elsewhere, here], "san antonio TX").out).names).toEqual([here.title]);
      expect((await searching([{ ...elsewhere, snippet: "Santa Monica and Antonioni films." }], "San Antonio").out).evidence).toBeUndefined();
    });
  });

  // Real, 2026-10-11: Nemotron 3 Super sent a list of ids as text that begins "=[", three replies running. Each call
  // was refused, as the schema says, and the plan lost its compare and its place search. The ids here are invented.
  describe("a list spelled out as text is read as the list", () => {
    const searched = async () => {
      const c = ctx();
      await runToolCall(call("qloo_search", { query: "Pedro Infante", type: "artist", for: "grandparent" }), c);
      await runToolCall(call("qloo_search", { query: "Bad Bunny", type: "artist", for: "visitor" }), c);
      return c;
    };

    it("accepts the real shape, on a compare and on a place search", async () => {
      const c = await searched();
      const compare = await runToolCall(call("qloo_compare", { grandparent_ids: ["Q-PI"], visitor_ids: '=["Q-BB"]' }), c);
      expect(compare).toMatchObject({ ok: true, summary: "Qloo compare, what they share: Example Ballad, Example Theme, Example Strings" });
      const places = await runToolCall(call("qloo_insights", { for: "both", type: "place", entity_ids: '=["Q-PI", "Q-BB"]' }), c);
      expect(places.ok).toBe(true);
      expect((c.qloo as FakeQloo).calls.at(-1)).toBe("insights:place:Q-PI+Q-BB:near=San Antonio, Texas");
    });

    it("reads a plain JSON list in text too, and still refuses an id nobody found", async () => {
      const c = await searched();
      expect((await runToolCall(call("qloo_insights", { for: "visitor", type: "artist", entity_ids: '["Q-BB"]' }), c)).ok).toBe(true);
      expect(await runToolCall(call("qloo_insights", { for: "visitor", type: "artist", entity_ids: '=["made-up"]' }), c)).toMatchObject({ ok: false, summary: "Rejected unknown ids" });
    });

    it("leaves other text alone: a search for words in brackets is still a search for those words", async () => {
      const c = ctx();
      (c.qloo as FakeQloo).search = async (query) => [{ id: "Q-X", name: query, kind: "artist", tags: [] }];
      expect((await runToolCall(call("qloo_search", { query: "[untitled]", type: "artist", for: "visitor" }), c)).summary).toContain("[untitled]"); // not a list: left as typed
      expect((await runToolCall(call("qloo_search", { query: "Songs [live]", type: "artist", for: "visitor" }), c)).summary).toContain("Songs [live]");
    });
  });

  it("needs to know whose favorite a search is for", async () => {
    const out = await runToolCall(call("qloo_search", { query: "Pedro Infante", type: "artist" }), ctx());
    expect(out.ok).toBe(false);
    expect(out.content).toMatch(/invalid arguments for qloo_search: for/);
  });

  it("rejects malformed JSON and unknown tools", async () => {
    expect((await runToolCall(call("qloo_search", "{not json"), ctx())).ok).toBe(false);
    expect((await runToolCall(call("delete_everything", {}), ctx())).content).toMatch(/no tool named/);
  });

  it("publishes plain JSON schemas with required fields", () => {
    const specs = toolSpecs();
    expect(specs.map((s) => s.function.name)).toEqual(["qloo_search", "qloo_insights", "qloo_compare", "qloo_tags", "web_search"]);
    const search = specs[0]!.function.parameters;
    expect(search.$schema).toBeUndefined();
    expect(search.required).toEqual(["query", "type", "for"]);
  });
});
