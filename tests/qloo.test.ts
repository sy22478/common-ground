import { describe, expect, it, vi } from "vitest";
import { keyedHasher } from "@/lib/hash";
import { QlooClient } from "@/lib/qloo";
import { MemoryStore } from "@/lib/store";

// The SHAPES below are those of real responses from hackathon.api.qloo.com: the same field names, nesting and value
// types. The VALUES are invented. Qloo's guide says "Do not store Qloo response data in a public repository", so no
// real response is kept in this repo; the real ones stay in the ignored .qloo/ folder (scripts/smoke_qloo.py).
const SEARCH_SHAPE = {
  results: [
    {
      name: "Example Singer",
      entity_id: "00000000-AAAA-4BBB-8CCC-000000000001",
      types: ["urn:entity:artist"],
      properties: {
        akas: [],
        duration: {},
        external: { lastfm: { id: "example", listeners: 10, scrobbles: 20 }, musicbrainz: { id: "x" }, spotify: { id: "x" }, wikidata: { id: "q0" } },
        image: { url: "https://images.example/00000000-420x-auto.jpg" },
        short_description: "An invented singer, used only as a test value.",
      },
      popularity: 0.93,
      disambiguation: "Example Singer",
      tags: [
        { name: "Example Genre", tag_id: "urn:tag:genre:example", type: "urn:tag:genre", value: "urn:tag:genre:example" },
        { name: "Example Style", tag_id: "urn:tag:style:qloo:example", type: "urn:tag:style:qloo", value: "urn:tag:style:qloo:example" },
      ],
    },
  ],
};

// /v2/insights: results.entities[], each with type "urn:entity" and its kind in subtype, plus query.affinity.
const INSIGHTS_SHAPE = {
  success: true,
  results: {
    entities: [
      {
        name: "An Example Film",
        entity_id: "00000000-AAAA-4BBB-8CCC-000000000002",
        type: "urn:entity",
        subtype: "urn:entity:movie",
        properties: {
          akas: [{ value: "Una película de ejemplo", languages: ["es"] }],
          image: { url: "https://images.example/2.jpg" },
          genres: ["comedy"],
          duration: 100,
          description: "Invented.",
          finale_year: null,
          release_date: "1957-03-01",
          release_year: 1957,
          content_rating: "G",
          release_country: ["Mexico"],
          short_descriptions: [{ value: "Invented.", languages: ["en"] }],
        },
        popularity: 0.61,
        tags: [{ id: "urn:tag:genre:media:example", name: "Example Film Genre", type: "urn:tag:genre:media" }],
        query: { affinity: 0.845402234604886, measurements: { audience_growth: 0 } },
        disambiguation: "1957, Example Director",
        external: { imdb: [{ id: "tt0000000" }] },
      },
      {
        name: "Example Hall",
        entity_id: "00000000-AAAA-4BBB-8CCC-000000000003",
        type: "urn:entity",
        subtype: "urn:entity:place",
        properties: { address: "1 Example Plaza, Example City, TX 00000", is_closed: false, business_rating: 4.5 },
        location: { lat: 0.5, lon: -0.5, geohash: "s00000" },
        popularity: 1,
        tags: [],
        query: { affinity: 0.858 },
        disambiguation: "1 Example Plaza Example City, TX 00000",
      },
      {
        name: "Closed Example Cafe",
        entity_id: "00000000-AAAA-4BBB-8CCC-000000000004",
        type: "urn:entity",
        subtype: "urn:entity:place",
        properties: { address: "2 Example Plaza", is_closed: true },
        popularity: 0.4,
        tags: [],
        query: { affinity: 0.8 },
        disambiguation: "2 Example Plaza",
      },
    ],
  },
};

// /v2/analysis/compare: tags the two sides share, NOT entities. The same name can appear under two subtypes.
const COMPARE_SHAPE = {
  duration: 80,
  results: {
    tags: [
      {
        tag_id: "urn:tag:genre:music:example",
        name: "Example Genre",
        type: "urn:tag",
        subtype: "urn:tag:genre:music",
        entity_id: "00000000-AAAA-4BBB-8CCC-000000000010",
        popularity: 0.99,
        query: {
          score: 0.73,
          "a.signal.interests.entities": [{ entity_id: "A-1", name: "Example Singer", subtype: "urn:entity:artist", disambiguation: "Example Singer" }],
          "b.signal.interests.entities": [{ entity_id: "B-1", name: "Example Rapper", subtype: "urn:entity:artist", disambiguation: "Example Rapper" }],
        },
      },
      { tag_id: "urn:tag:keyword:qloo:example_belonging", name: "Belonging", type: "urn:tag", subtype: "urn:tag:keyword:qloo", entity_id: "T-2", popularity: 0.98, query: { score: 0.6 } },
      { tag_id: "urn:tag:theme:qloo:example_belonging", name: "Belonging", type: "urn:tag", subtype: "urn:tag:theme:qloo", entity_id: "T-3", popularity: 0.98, query: { score: 0.72 } },
      { tag_id: "urn:tag:instrument:music:example", name: "Example Instrument", type: "urn:tag", subtype: "urn:tag:instrument:music", entity_id: "T-4", popularity: 0.9, query: { score: 0.53 } },
    ],
    a: [{ tag_id: "urn:tag:instrument:qloo:example", name: "Example Only On One Side", type: "urn:tag", subtype: "urn:tag:instrument:qloo", entity_id: "T-9", popularity: 0.99, query: { count: "2" } }],
    b: [],
    matchEntities: [],
  },
};

// /v2/tags: results.tags[] with id, name, type, popularity and parents (the kinds of entity the tag describes).
// A word for a food brings back tags for places, and some noise with popularity 0.
const TAGS_SHAPE = {
  duration: 12,
  success: true,
  results: {
    tags: [
      { parents: [{ type: "urn:entity:artist" }, { type: "urn:entity:album" }], type: "urn:tag:genre:music", id: "urn:tag:genre:music:example", name: "Example Genre", popularity: 0.99, properties: { description: "Invented." }, tags: [] },
      { parents: [{ type: "urn:entity:place" }], type: "urn:tag:genre:place", id: "urn:tag:genre:place:example_house", name: "Example House", popularity: 0.97, properties: {}, tags: [] },
      { parents: [{ type: "urn:entity:place" }], type: "urn:tag:specialty_dish:place", id: "urn:tag:specialty_dish:place:example_grill_split", name: "Example Grill Split", popularity: 0, properties: {}, tags: [] },
    ],
  },
};

function client(...replies: { body: unknown; status?: number }[]) {
  const queue = [...replies];
  const fetchImpl = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => {
    const next = queue.length > 1 ? queue.shift()! : queue[0]!;
    return Response.json(next.body, { status: next.status ?? 200 });
  });
  const sleeps: number[] = [];
  const qloo = new QlooClient("test-key", new MemoryStore(), 100, keyedHasher("test-secret"), fetchImpl as unknown as typeof fetch, () => new Date(), async (ms) => {
    sleeps.push(ms);
  });
  return { qloo, fetchImpl, sleeps };
}

describe("Qloo responses, in the shape the real server returns", () => {
  it("search: sends the request that returned 200 on 2026-10-11 and reads the entity", async () => {
    const { qloo, fetchImpl } = client({ body: SEARCH_SHAPE });
    const found = await qloo.search("Example Singer", "artist", 1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://hackathon.api.qloo.com/search?query=Example+Singer&types=urn%3Aentity%3Aartist&take=1");
    expect((init!.headers as Record<string, string>)["X-Api-Key"]).toBe("test-key");
    expect(found).toEqual([
      { id: "00000000-AAAA-4BBB-8CCC-000000000001", name: "Example Singer", kind: "artist", year: undefined, popularity: 0.93, affinity: undefined, note: undefined, tags: ["Example Genre", "Example Style"] },
    ]);
  });

  // A film comes back from /search with properties.akas: its titles in other languages, each { language, value }
  // (seen 2026-10-11; a well known film had dozens). They tell whether a result is what the family named
  // (lib/evidence.ts). Kept for a search only. The values here are invented.
  it("search: keeps the other names a result goes by, once each; insights does not", async () => {
    const film = {
      name: "The Long Harvest",
      entity_id: "00000000-AAAA-4BBB-8CCC-000000000002",
      types: ["urn:entity:movie"],
      properties: { release_year: 1955, akas: [{ language: "es", value: "La larga cosecha" }, { language: "es_ar", value: "La larga cosecha" }, { language: "de", value: "Die lange Ernte" }, { language: "xx" }] },
      popularity: 0.9,
      tags: [],
    };
    const { qloo } = client({ body: { results: [film] } });
    expect((await qloo.search("La larga cosecha", "movie", 5))[0]).toMatchObject({ name: "The Long Harvest", year: 1955, akas: ["La larga cosecha", "Die lange Ernte"] });
    const insights = client({ body: { success: true, results: { entities: [film] } } });
    expect((await insights.qloo.insights({ kind: "movie", signalIds: ["A-1"] }))[0]).not.toHaveProperty("akas");
  });

  it("insights: reads the kind from subtype, the year, the affinity and Qloo's note, and skips a closed place", async () => {
    const { qloo, fetchImpl } = client({ body: INSIGHTS_SHAPE });
    const found = await qloo.insights({ kind: "movie", signalIds: ["A-1", "A-2"], releaseYearMin: 1950, releaseYearMax: 1970, age: "55_and_older", take: 5 });
    expect(fetchImpl.mock.calls[0]![0]).toBe(
      "https://hackathon.api.qloo.com/v2/insights?filter.type=urn%3Aentity%3Amovie&signal.interests.entities=A-1%2CA-2&filter.release_year.min=1950&filter.release_year.max=1970&signal.demographics.age=55_and_older&take=5",
    );
    expect(found).toEqual([
      { id: "00000000-AAAA-4BBB-8CCC-000000000002", name: "An Example Film", kind: "movie", year: 1957, popularity: 0.61, affinity: 0.845402234604886, note: "1957, Example Director", tags: ["Example Film Genre"] },
      { id: "00000000-AAAA-4BBB-8CCC-000000000003", name: "Example Hall", kind: "place", year: undefined, popularity: 1, affinity: 0.858, note: "1 Example Plaza Example City, TX 00000", tags: [] },
    ]);
  });

  it("compare: reads shared traits from results.tags, best score first, one per name", async () => {
    const { qloo, fetchImpl } = client({ body: COMPARE_SHAPE });
    const traits = await qloo.compare(["A-1"], ["B-1"], 2);
    expect(fetchImpl.mock.calls[0]![0]).toBe("https://hackathon.api.qloo.com/v2/analysis/compare?a.signal.interests.entities=A-1&b.signal.interests.entities=B-1");
    expect(traits).toEqual([
      { id: "urn:tag:genre:music:example", name: "Example Genre", kind: "genre:music", score: 0.73 },
      { id: "urn:tag:theme:qloo:example_belonging", name: "Belonging", kind: "theme", score: 0.72 },
    ]);
  });

  it("compare: an answer with no shared tags is an empty list, not an error", async () => {
    const { qloo } = client({ body: { duration: 5, results: { tags: [], a: [], b: [], matchEntities: [] } } });
    expect(await qloo.compare(["A-1"], ["B-1"])).toEqual([]);
  });

  it("tags: reads id, name and type, says which tags describe places, and drops the noise", async () => {
    const { qloo, fetchImpl } = client({ body: TAGS_SHAPE });
    expect(await qloo.tags("example", 5)).toEqual([
      { id: "urn:tag:genre:music:example", name: "Example Genre", type: "urn:tag:genre:music", places: false },
      { id: "urn:tag:genre:place:example_house", name: "Example House", type: "urn:tag:genre:place", places: true },
    ]);
    expect(fetchImpl.mock.calls[0]![0]).toBe("https://hackathon.api.qloo.com/v2/tags?filter.query=example&take=5");
  });

  it("famous: asks for the most popular of a type with no taste signal at all", async () => {
    const { qloo, fetchImpl } = client({ body: INSIGHTS_SHAPE });
    await qloo.famous("movie");
    expect(Object.fromEntries(new URL(fetchImpl.mock.calls[0]![0]).searchParams)).toEqual({ "filter.type": "urn:entity:movie", "filter.popularity.min": "0.9", take: "50" });
  });

  it("insights: a place search carries the tag and the city", async () => {
    const { qloo, fetchImpl } = client({ body: INSIGHTS_SHAPE });
    await qloo.insights({ kind: "place", signalIds: ["A-1", "B-1"], location: "Example City, Texas", tagIds: ["urn:tag:genre:place:example_house"] });
    const url = new URL(fetchImpl.mock.calls[0]![0]);
    expect(Object.fromEntries(url.searchParams)).toEqual({ "filter.type": "urn:entity:place", "signal.interests.entities": "A-1,B-1", "filter.location.query": "Example City, Texas", "filter.tags": "urn:tag:genre:place:example_house", take: "6" });
  });
});

describe("Qloo rate limit (5 calls a second on the hackathon key)", () => {
  it("waits out the second and tries once more on 429", async () => {
    const { qloo, fetchImpl, sleeps } = client({ body: { message: "API rate limit exceeded" }, status: 429 }, { body: SEARCH_SHAPE });
    expect(await qloo.search("Example Singer", "artist", 1)).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([1100]);
  });

  it("gives up after that one retry, with the status and without the key", async () => {
    const { qloo, fetchImpl } = client({ body: { message: "quota exceeded for test-key" }, status: 429 });
    await expect(qloo.search("Example Singer", "artist", 1)).rejects.toMatchObject({ name: "QlooError", status: 429, message: expect.not.stringContaining("test-key") });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
