import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { gatherEvidence, newToolContext, type AgentDeps } from "@/lib/agent";
import { chooseBridge } from "@/lib/bridge";
import { limits } from "@/lib/config";
import { isSameName } from "@/lib/evidence";
import { SAMPLE_FAMILY, youthWindow, type Family } from "@/lib/family";
import { keyedHasher } from "@/lib/hash";
import { stripThinking, TokenFactoryLLM } from "@/lib/llm";
import { QlooClient, type EntityKind, type QlooApi } from "@/lib/qloo";
import { CapReached, SpendGuard } from "@/lib/spend";
import { MemoryStore } from "@/lib/store";
import { liveKey } from "./live-env";

// LIVE, run by hand only (FAIR_PROOF=1, about $0.10): bus 014's fair proof, set out in submission/FAIR_PROOF.md.
// For each invented family, a plain model's pick of the one thing both may love, beside Common Ground's bridge, and
// the measures fixed before the run. Its own store and counters: the live site's are not touched. What Qloo answered
// is kept in .qloo/fair-proof/, never in git.
const FAMILIES: Family[] = [
  SAMPLE_FAMILY,
  {
    grandparent: { birthYear: 1938, relation: "grandfather", language: "Hindi", city: "Edison, New Jersey", favorites: ["Mohammed Rafi", "Mughal-e-Azam", "Lata Mangeshkar", "masala chai"] },
    visitor: { favorites: ["Taylor Swift", "Interstellar", "cricket"] },
    history: [],
  },
  {
    grandparent: { birthYear: 1945, relation: "grandmother", language: "Mandarin", city: "San Francisco, California", favorites: ["Teresa Teng", "The Love Eterne", "Dream of the Red Chamber", "dumplings"] },
    visitor: { favorites: ["Olivia Rodrigo", "Turning Red", "basketball"] },
    history: [],
  },
  {
    grandparent: { birthYear: 1950, relation: "grandmother", language: "Tagalog", city: "Daly City, California", favorites: ["Nora Aunor", "Pilita Corrales", "Himala", "adobo"] },
    visitor: { favorites: ["SZA", "Encanto", "volleyball"] },
    history: [],
  },
  {
    grandparent: { birthYear: 1948, relation: "grandfather", language: "Vietnamese", city: "Houston, Texas", favorites: ["Khanh Ly", "Trinh Cong Son", "pho"] },
    visitor: { favorites: ["Billie Eilish", "Avatar: The Last Airbender", "skateboarding"] },
    history: [],
  },
  {
    grandparent: { birthYear: 1952, relation: "grandmother", language: "Korean", city: "Los Angeles, California", favorites: ["Patti Kim", "Cho Yong-pil", "The Housemaid", "kimchi"] },
    visitor: { favorites: ["Frank Ocean", "Stranger Things", "drawing"] },
    history: [],
  },
  {
    grandparent: { birthYear: 1942, relation: "grandfather", language: "Arabic", city: "Dearborn, Michigan", favorites: ["Umm Kulthum", "Abdel Halim Hafez", "Palace Walk", "mint tea"] },
    visitor: { favorites: ["Drake", "Dune", "soccer"] },
    history: [],
  },
  {
    grandparent: { birthYear: 1944, relation: "grandmother", language: "Polish", city: "Chicago, Illinois", favorites: ["Czeslaw Niemen", "Anna German", "Knife in the Water", "pierogi"] },
    visitor: { favorites: ["Dua Lipa", "Wednesday", "knitting"] },
    history: [],
  },
  {
    grandparent: { birthYear: 1947, relation: "grandmother", language: "Yoruba", city: "Atlanta, Georgia", favorites: ["King Sunny Ade", "Fela Kuti", "Things Fall Apart", "jollof rice"] },
    visitor: { favorites: ["Burna Boy", "Black Panther", "braiding hair"] },
    history: [],
  },
  {
    grandparent: { birthYear: 1949, relation: "grandmother", language: "Japanese", city: "Honolulu, Hawaii", favorites: ["Misora Hibari", "Kyu Sakamoto", "Tokyo Story", "origami"] },
    visitor: { favorites: ["Doja Cat", "Demon Slayer", "baking"] },
    history: [],
  },
];

const QLOO_KIND: Record<string, EntityKind> = { film: "movie", show: "tv_show", artist: "artist", book: "book" };
const STOP_USD = 0.15;

function plainPrompt(f: Family): string {
  const g = f.grandparent;
  return [
    `A ${g.relation ?? "grandparent"} born in ${g.birthYear}, who speaks ${g.language} and lives in ${g.city}, loves: ${g.favorites.join(", ")}.`,
    `Their grandchild loves: ${f.visitor.favorites.join(", ")}.`,
    `Name the one film, TV show, music artist or book that the two of them may both love.`,
    `Answer with JSON only: {"title": "...", "kind": "film" | "show" | "artist" | "book", "year": the year it came out, or the year the artist began}.`,
  ].join("\n");
}

function parsePick(text: string): { title: string; kind: string; year?: number } | null {
  const found = stripThinking(text).match(/\{[\s\S]*\}/);
  if (!found) return null;
  try {
    const raw = JSON.parse(found[0]) as { title?: unknown; kind?: unknown; year?: unknown };
    if (typeof raw.title !== "string" || typeof raw.kind !== "string") return null;
    return { title: raw.title, kind: raw.kind.toLowerCase(), year: typeof raw.year === "number" ? raw.year : undefined };
  } catch {
    return null;
  }
}

// The first search result that is called what was asked for.
async function lookUp(qloo: QlooApi, title: string, kind: EntityKind) {
  const results = await qloo.search(title, kind, 5);
  return results.find((e) => isSameName(title, e.name, kind === "artist" ? "artist" : undefined)) ?? null;
}

describe.skipIf(process.env.FAIR_PROOF !== "1")("the fair proof", () => {
  it("compares a plain model's pick with Common Ground's bridge for ten invented families", async () => {
    const store = new MemoryStore();
    const lim = limits({ PLAN_CAP_USD: "0.06", DAILY_CAP_USD: String(STOP_USD), TOTAL_CAP_USD: String(STOP_USD), QLOO_CALLS_PER_DAY: "800" });
    const qloo = new QlooClient(liveKey("QLOO_API_KEY"), store, lim.qlooPerDay, keyedHasher("fair-proof-2026-10-28"));
    const nebius = liveKey("NEBIUS_API_KEY");
    const results: unknown[] = [];
    let spent = 0;
    let stoppedAt: number | null = null;

    for (const [n, family] of FAMILIES.entries()) {
      const guard = new SpendGuard(store, lim);
      const llm = new TokenFactoryLLM(nebius, guard);
      const deps: AgentDeps = { llm, qloo, tavily: { search: async () => [] }, guard, limits: lim };
      const window = youthWindow(family.grandparent.birthYear);
      try {
        // The plain model, first, so its answer cannot depend on anything Qloo said.
        const reply = await llm.chat({ model: "ultra", messages: [{ role: "user", content: plainPrompt(family) }], thinking: true, maxTokens: 3000, temperature: 0 });
        const plain = parsePick(reply.content);

        // Common Ground's own steps: gather with the Qloo tools, then the bridge by rule.
        const ctx = newToolContext(family, deps);
        await gatherEvidence(family, deps, ctx, null, () => {});
        const choice = await chooseBridge(ctx, null);
        const bridge = choice?.bridge ?? null;
        const bridgeYear = bridge ? ctx.ledger.items.flatMap((i) => i.asked?.entities ?? []).find((e) => e.id === bridge.id)?.year : undefined;

        // The measures, as fixed in submission/FAIR_PROOF.md.
        const kind = plain ? QLOO_KIND[plain.kind] : undefined;
        const inQloo = plain && kind ? await lookUp(qloo, plain.title, kind).catch(() => null) : null;
        const famous = kind ? await qloo.famous(kind).catch(() => []) : [];
        const fameRank = plain ? famous.findIndex((e) => e.id === inQloo?.id || isSameName(plain.title, e.name)) + 1 || null : null;
        const plainYear = inQloo?.year ?? plain?.year;
        const plainYearFrom = inQloo?.year ? "qloo" : plain?.year ? "model" : null;
        const same = Boolean(plain && bridge && (inQloo?.id === bridge.id || isSameName(plain.title, bridge.title) || isSameName(bridge.title, plain.title)));
        const inYouth = (year?: number) => (year === undefined ? null : year >= window.min && year <= window.max);
        let plainAffinity: { grandparent?: number; visitor?: number } | null = null;
        if (inQloo && kind && ctx.ids.grandparent.length && ctx.ids.visitor.length) {
          const [g, v] = await Promise.all([qloo.affinity(ctx.ids.grandparent, [inQloo.id], kind).catch(() => []), qloo.affinity(ctx.ids.visitor, [inQloo.id], kind).catch(() => [])]);
          plainAffinity = { grandparent: g[0]?.affinity, visitor: v[0]?.affinity };
        }

        spent += guard.planSpent;
        results.push({
          n: n + 1,
          language: family.grandparent.language,
          birthYear: family.grandparent.birthYear,
          youth: window,
          plain: plain && { ...plain, qlooId: inQloo?.id ?? null, year: plainYear ?? null, yearFrom: plainYearFrom, fameRank, inYouth: inYouth(plainYear), affinity: plainAffinity },
          qloo: bridge && { title: bridge.title, kind: bridge.kind, id: bridge.id, year: bridgeYear ?? null, inYouth: inYouth(bridgeYear), affinity: { grandparent: bridge.grandparent, visitor: bridge.visitor }, beyondFame: bridge.beyondFame ?? null },
          same,
          costUsd: guard.planSpent,
        });
        console.log(`[proof] family ${n + 1} (${family.grandparent.language}): same ${same}, plain in the 50: ${fameRank ?? "no"}, youth plain ${inYouth(plainYear)} qloo ${inYouth(bridgeYear)}, $${guard.planSpent.toFixed(4)}`);
      } catch (error) {
        spent += guard.planSpent;
        if (error instanceof CapReached) {
          stoppedAt = n + 1;
          break;
        }
        results.push({ n: n + 1, language: family.grandparent.language, error: error instanceof Error ? error.name : "unknown" });
      }
    }

    mkdirSync(".qloo/fair-proof", { recursive: true });
    writeFileSync(".qloo/fair-proof/2026-10-28.json", JSON.stringify({ at: new Date().toISOString(), spentUsd: spent, stoppedAt, results }, null, 1) + "\n");
    console.log(`[proof] spent $${spent.toFixed(4)}${stoppedAt ? `, stopped at family ${stoppedAt} by the $${STOP_USD} stop` : ""}`);
    expect(results.length).toBeGreaterThan(0);
  });
});

// After the first run (2026-10-28, 13:47 UTC) three plain replies gave no pick: each cost what 3,000 tokens of
// thinking cost, so each was most likely cut off at that limit. FAIR_PROOF_RERUN=6,8,10 asks those once more, with
// the same prompt and room for 6,000 tokens. Measures 1 to 3 as before, against the bridge the first run found;
// measure 4 is not taken (it needs that run's Qloo ids). A hard stop at $0.06.
describe.skipIf(!process.env.FAIR_PROOF_RERUN)("the fair proof, the cut replies asked again", () => {
  it("asks the plain model again where its reply was cut", async () => {
    const first = JSON.parse(readFileSync(".qloo/fair-proof/2026-10-28.json", "utf8")) as { results: { n: number; qloo: { title: string; id: string } | null }[] };
    const only = process.env.FAIR_PROOF_RERUN!.split(",").map(Number);
    const store = new MemoryStore();
    const lim = limits({ PLAN_CAP_USD: "0.06", DAILY_CAP_USD: "0.06", TOTAL_CAP_USD: "0.06", QLOO_CALLS_PER_DAY: "100" });
    const qloo = new QlooClient(liveKey("QLOO_API_KEY"), store, lim.qlooPerDay, keyedHasher("fair-proof-2026-10-28"));
    const nebius = liveKey("NEBIUS_API_KEY");
    const results: unknown[] = [];
    let spent = 0;
    for (const n of only) {
      const family = FAMILIES[n - 1]!;
      const bridge = first.results.find((r) => r.n === n)?.qloo ?? null;
      const guard = new SpendGuard(store, lim);
      const llm = new TokenFactoryLLM(nebius, guard);
      const window = youthWindow(family.grandparent.birthYear);
      try {
        const reply = await llm.chat({ model: "ultra", messages: [{ role: "user", content: plainPrompt(family) }], thinking: true, maxTokens: 6000, temperature: 0 });
        const plain = parsePick(reply.content);
        const kind = plain ? QLOO_KIND[plain.kind] : undefined;
        const inQloo = plain && kind ? await lookUp(qloo, plain.title, kind).catch(() => null) : null;
        const famous = kind ? await qloo.famous(kind).catch(() => []) : [];
        const fameRank = plain ? famous.findIndex((e) => e.id === inQloo?.id || isSameName(plain.title, e.name)) + 1 || null : null;
        const plainYear = inQloo?.year ?? plain?.year;
        const same = Boolean(plain && bridge && (inQloo?.id === bridge.id || isSameName(plain.title, bridge.title) || isSameName(bridge.title, plain.title)));
        spent += guard.planSpent;
        results.push({
          n,
          finishReason: reply.finishReason,
          completionTokens: reply.usage.completion_tokens,
          plain: plain && { ...plain, qlooId: inQloo?.id ?? null, year: plainYear ?? null, yearFrom: inQloo?.year ? "qloo" : plain.year ? "model" : null, fameRank, inYouth: plainYear === undefined ? null : plainYear >= window.min && plainYear <= window.max },
          same,
          costUsd: guard.planSpent,
        });
      } catch (error) {
        spent += guard.planSpent;
        if (error instanceof CapReached) break;
        results.push({ n, error: error instanceof Error ? error.name : "unknown" });
      }
    }
    writeFileSync(".qloo/fair-proof/2026-10-28-rerun.json", JSON.stringify({ at: new Date().toISOString(), spentUsd: spent, results }, null, 1) + "\n");
    expect(results.length).toBeGreaterThan(0);
  });
});
