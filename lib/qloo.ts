import { QLOO_BASE } from "./config";
import type { Hasher } from "./hash";
import type { Store } from "./store";

// Entity kinds the hackathon key supports for filter.type (developer guide), minus the ones this app does not use.
export const ENTITY_KINDS = ["artist", "movie", "tv_show", "book", "place", "podcast", "destination"] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];
export const urn = (kind: EntityKind) => `urn:entity:${kind}`;

export const AGE_BANDS = ["24_and_younger", "25_to_29", "30_to_34", "35_to_44", "45_to_54", "55_and_older"] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

export interface QlooEntity {
  id: string;
  name: string;
  kind?: string;
  year?: number;
  popularity?: number;
  affinity?: number;
  note?: string; // Qloo's own one-line identifier when it adds something: a film's year and director, a place's address
  tags: string[];
  // The other names Qloo knows it by (a film's titles in other languages). Kept for search results only, and only to
  // tell whether a result is what the family named: they go to no model and onto no card.
  akas?: string[];
}

// Something two tastes share, from /v2/analysis/compare: a tag both sides carry (a genre, a theme, an instrument).
export interface SharedTrait {
  id: string;
  name: string;
  kind: string; // "genre:music", "theme", "instrument:music", "region"
  score?: number;
}

export interface QlooTag {
  id: string;
  name: string;
  type?: string;
  places?: boolean; // the tag describes places (a kind of restaurant, a dish they serve), so it can filter a place search
}

export interface InsightsQuery {
  kind: EntityKind;
  signalIds: string[];
  releaseYearMin?: number;
  releaseYearMax?: number;
  age?: AgeBand;
  location?: string;
  tagIds?: string[]; // only results that carry these tags (filter.tags)
  take?: number;
}

export interface QlooApi {
  search(query: string, kind?: EntityKind, take?: number): Promise<QlooEntity[]>;
  insights(query: InsightsQuery): Promise<QlooEntity[]>;
  compare(a: string[], b: string[], take?: number): Promise<SharedTrait[]>;
  // How much the taste behind the signal ids likes each of the given items: the same items back, each with an affinity.
  affinity(signalIds: string[], itemIds: string[], kind: EntityKind): Promise<QlooEntity[]>;
  // What Qloo suggests to anyone: the most popular of a type, asked for with no taste signal at all.
  famous(kind: EntityKind): Promise<QlooEntity[]>;
  tags(query: string, take?: number): Promise<QlooTag[]>;
}

// How many of the most popular Qloo is asked for: the most one call returns.
export const FAMOUS = 50;

export class QlooError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "QlooError";
  }
}

// This site's own daily allowance of Qloo calls is spent. Qloo itself is fine, and the page must not say otherwise.
export class QlooAllowanceUsed extends QlooError {
  constructor() {
    super(429, "Qloo daily call budget reached");
    this.name = "QlooAllowanceUsed";
  }
}

type Raw = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const numOrUndef = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

// "urn:entity:artist" becomes "artist", the same word the tools use for a type.
const shortKind = (v: unknown) => str(v)?.replace(/^urn:entity:/, "");

// The docs give the envelopes but not the entity fields, so read leniently and keep only what the app uses.
// Checked against real responses on 2026-10-11 (28 calls, shapes pinned in tests/qloo.test.ts):
// - /search: results[] with name, entity_id, types (a list of urn:entity:...), popularity (0 to 1), tags[].name.
// - /v2/insights: results.entities[] with type "urn:entity", subtype "urn:entity:movie", query.affinity (0 to 1).
// - Films carry properties.release_year; artists and places carry no year.
// - disambiguation is the year and director for a film, the address for a place, the name again for an artist.
// - Places carry properties.address and properties.is_closed.
// Not seen yet: a book (properties.publication_year is still a guess).
const MAX_AKAS = 150;
export function normalizeEntity(raw: Raw, withAkas = false): QlooEntity | null {
  const id = str(raw.entity_id) ?? str(raw.id);
  const name = str(raw.name);
  if (!id || !name) return null;
  const props = (raw.properties ?? {}) as Raw;
  if (props.is_closed === true) return null; // a place Qloo marks as closed is not somewhere to send a family
  const query = (raw.query ?? {}) as Raw;
  const year =
    numOrUndef(props.release_year) ??
    numOrUndef(props.publication_year) ??
    (typeof props.release_date === "string" ? Number(props.release_date.slice(0, 4)) || undefined : undefined);
  const tags = Array.isArray(raw.tags)
    ? (raw.tags as Raw[]).map((t) => str(t?.name)).filter((t): t is string => Boolean(t)).slice(0, 8)
    : [];
  const types = Array.isArray(raw.types) ? (raw.types as unknown[]) : [];
  const note = str(raw.disambiguation)?.trim();
  const akas = withAkas && Array.isArray(props.akas) ? [...new Set((props.akas as Raw[]).map((a) => str(a?.value)).filter((v): v is string => Boolean(v)))].slice(0, MAX_AKAS) : [];
  return {
    id,
    name,
    kind: shortKind(types[0]) ?? shortKind(raw.subtype) ?? shortKind(raw.type),
    year,
    popularity: numOrUndef(raw.popularity),
    affinity: numOrUndef(query.affinity),
    note: note && note.toLowerCase() !== name.toLowerCase() ? note.slice(0, 120) : undefined,
    tags,
    ...(akas.length ? { akas } : {}),
  };
}

function entitiesFrom(payload: unknown, withAkas = false): QlooEntity[] {
  const p = (payload ?? {}) as Raw;
  const results = p.results as unknown;
  const list = Array.isArray(results)
    ? results
    : Array.isArray((results as Raw | undefined)?.entities)
      ? ((results as Raw).entities as unknown[])
      : [];
  return list.map((e) => normalizeEntity(e as Raw, withAkas)).filter((e): e is QlooEntity => e !== null);
}

// /v2/analysis/compare answers with tags, not entities (checked 2026-10-11): results.tags[] holds what both sides
// carry, each with tag_id, name, subtype ("urn:tag:genre:music", "urn:tag:theme:qloo") and query.score. The same name
// can come back under two subtypes, and "take" is not honored, so keep the best of each name and cut the list here.
export function sharedTraitsFrom(payload: unknown, take: number): SharedTrait[] {
  const tags = ((((payload ?? {}) as Raw).results as Raw | undefined)?.tags ?? []) as Raw[];
  const best = new Map<string, SharedTrait>();
  for (const t of Array.isArray(tags) ? tags : []) {
    const id = str(t?.tag_id) ?? str(t?.id);
    const name = str(t?.name);
    if (!id || !name) continue;
    const trait: SharedTrait = {
      id,
      name,
      kind: (str(t.subtype) ?? str(t.type) ?? "").replace(/^urn:tag:/, "").replace(/:qloo$/, ""),
      score: numOrUndef(((t.query ?? {}) as Raw).score),
    };
    const seen = best.get(name.toLowerCase());
    if (!seen || (trait.score ?? 0) > (seen.score ?? 0)) best.set(name.toLowerCase(), trait);
  }
  return [...best.values()].sort((x, y) => (y.score ?? 0) - (x.score ?? 0)).slice(0, take);
}

// Results are cached for 7 days to save calls. The cache key is a keyed hash of the request, so the words a
// visitor typed are not stored, and only the parsed public catalogue data is kept, never the raw response.
export class QlooClient implements QlooApi {
  constructor(
    private apiKey: string,
    private store: Store,
    private callsPerDay: number,
    private keyFor: Hasher,
    private fetchImpl: typeof fetch = fetch,
    private now: () => Date = () => new Date(),
    private sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  private async cached<T>(path: string, params: Record<string, string | number | undefined>, parse: (raw: unknown) => T): Promise<T> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, String(v));
    const cacheKey = `qloo:${this.keyFor(`${path}?${qs.toString()}`)}`;
    const hit = await this.store.getJSON<T>(cacheKey);
    if (hit !== null) return hit;

    const dayKey = `qloo:calls:${this.now().toISOString().slice(0, 10)}`;
    const calls = await this.store.incrByFloat(dayKey, 1, 2 * 86400);
    if (calls > this.callsPerDay) throw new QlooAllowanceUsed();

    const send = () =>
      this.fetchImpl(`${QLOO_BASE}${path}?${qs.toString()}`, {
        headers: { "X-Api-Key": this.apiKey, Accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      });
    let response = await send();
    // The key allows 5 calls a second (X-Second-RateLimit-Limit). Two plans running together can pass that, so wait
    // out the second and try once more. Once only: a second 429 is the monthly quota, and waiting will not help.
    if (response.status === 429) {
      await this.sleep(1100);
      response = await send();
    }
    if (!response.ok) {
      const text = (await response.text()).replaceAll(this.apiKey, "[redacted]").slice(0, 300);
      throw new QlooError(response.status, `Qloo ${response.status} on ${path}: ${text}`);
    }
    const parsed = parse(await response.json());
    await this.store.setJSON(cacheKey, parsed, 7 * 86400);
    return parsed;
  }

  async search(query: string, kind?: EntityKind, take = 5): Promise<QlooEntity[]> {
    return this.cached("/search", { query, types: kind ? urn(kind) : undefined, take }, (raw) => entitiesFrom(raw, true));
  }

  async insights(q: InsightsQuery): Promise<QlooEntity[]> {
    return this.cached(
      "/v2/insights",
      {
        "filter.type": urn(q.kind),
        "signal.interests.entities": q.signalIds.join(","),
        "filter.release_year.min": q.kind === "movie" || q.kind === "tv_show" ? q.releaseYearMin : undefined,
        "filter.release_year.max": q.kind === "movie" || q.kind === "tv_show" ? q.releaseYearMax : undefined,
        "filter.publication_year.min": q.kind === "book" ? q.releaseYearMin : undefined,
        "filter.publication_year.max": q.kind === "book" ? q.releaseYearMax : undefined,
        "signal.demographics.age": q.age,
        "filter.location.query": q.kind === "place" || q.kind === "destination" ? q.location : undefined,
        "filter.tags": q.tagIds?.length ? q.tagIds.join(",") : undefined,
        take: q.take ?? 6,
      },
      entitiesFrom,
    );
  }

  // /v2/insights with filter.results.entities: Qloo scores exactly these items against the signals (checked
  // 2026-10-11: 17 films in, the same 17 back, each with query.affinity).
  async affinity(signalIds: string[], itemIds: string[], kind: EntityKind): Promise<QlooEntity[]> {
    return this.cached(
      "/v2/insights",
      { "filter.type": urn(kind), "signal.interests.entities": signalIds.join(","), "filter.results.entities": itemIds.join(","), take: Math.min(50, itemIds.length) },
      entitiesFrom,
    );
  }

  // The same endpoint with no taste signal: a floor on popularity is the only filter it will accept alone (a type by
  // itself is refused with 400; checked 2026-10-11). It answers with its 50 most popular of the type, the same for
  // every family, so one cached answer serves a week of plans. The bridge is held against this list (lib/bridge.ts).
  async famous(kind: EntityKind): Promise<QlooEntity[]> {
    return this.cached("/v2/insights", { "filter.type": urn(kind), "filter.popularity.min": 0.9, take: FAMOUS }, entitiesFrom);
  }

  async compare(a: string[], b: string[], take = 12): Promise<SharedTrait[]> {
    return this.cached("/v2/analysis/compare", { "a.signal.interests.entities": a.join(","), "b.signal.interests.entities": b.join(",") }, (raw) =>
      sharedTraitsFrom(raw, take),
    );
  }

  // Checked 2026-10-11: results.tags[] with id (a urn that starts with the tag's type), name, type, popularity and parents,
  // the kinds of entity the tag describes ("urn:entity:place" for a kind of restaurant or a dish a place serves).
  // Some results are noise with popularity 0 (a menu line that happens to hold the word): those are dropped.
  async tags(query: string, take = 8): Promise<QlooTag[]> {
    return this.cached("/v2/tags", { "filter.query": query, take }, (raw) => {
      const tags = (((raw as Raw).results as Raw | undefined)?.tags ?? []) as Raw[];
      return tags
        .filter((t) => numOrUndef(t.popularity) !== 0)
        .map((t) => ({
          id: str(t.id) ?? str(t.tag_id) ?? "",
          name: str(t.name) ?? "",
          type: str(t.type),
          places: Array.isArray(t.parents) && (t.parents as Raw[]).some((p) => str(p?.type) === "urn:entity:place"),
        }))
        .filter((t) => t.id && t.name);
    });
  }
}
