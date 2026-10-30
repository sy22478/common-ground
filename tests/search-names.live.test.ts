import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { limits } from "@/lib/config";
import { Ledger } from "@/lib/evidence";
import { normalizeEntity, type EntityKind, type QlooEntity } from "@/lib/qloo";
import { runToolCall, type ToolContext } from "@/lib/tools";
import { FakeQloo, FakeTavily, call } from "./helpers";

// Run by hand, no cost and no network: puts every real answer of Qloo's search that is kept on this machine
// (.qloo/NNN-search-*.json, written by scripts/smoke_qloo.py) through the search tool as the agent uses it, and
// checks which searches end with a favorite and which with "nothing by that name". It is the way to see the rule in
// lib/evidence.ts (isSameName) work on real answers. What Qloo answered is read here and never written here: the
// lists below hold only what was asked, in the words of a family or of a probe.
//
//   npx vitest run --config vitest.live.config.ts tests/search-names.live.test.ts
const files = existsSync(".qloo") ? readdirSync(".qloo").filter((f) => /^\d+-search-.*\.json$/.test(f)).sort() : [];

// A favorite by its name, a name with a slip, a name in another script: each should end with something.
const A_FAVORITE = ["Pedro Infante", "Roman Holiday", "Lata Mangeshkar", "Mohammed Rafi", "Javier Solis", "Bad Bunny", "Spirited Away", "Studio Ghibli", "Burna Boy", "Океан Ельзи", "Jamala", "Javier Soliz", "Elvis", "the Beatles", "Amelie", "千と千尋の神隠し"];
// A habit or a dish in the family's own words, searched as a place: Qloo answers with places that share a word.
const NOT_AN_ENTITY = ["making tamales at Christmas", "tamales", "baking"];

it.skipIf(!files.length)("takes every real favorite searched so far, and none of the places that only share a word", async () => {
  const lines: string[] = [];
  const wrong: string[] = [];
  for (const file of files) {
    const { request, body } = JSON.parse(readFileSync(`.qloo/${file}`, "utf8")) as { request: { params: Record<string, string> }; body: { results?: unknown } };
    const query = request.params.query!;
    const type = (request.params.types ?? "urn:entity:artist").replace("urn:entity:", "") as EntityKind;
    const raw = (Array.isArray(body.results) ? body.results : ((body.results as { entities?: unknown[] } | undefined)?.entities ?? [])) as Record<string, unknown>[];
    const answered = raw.map((e) => normalizeEntity(e, true)).filter((e): e is QlooEntity => e !== null);
    const qloo = new FakeQloo();
    qloo.search = async () => answered;
    const ctx: ToolContext = { qloo, tavily: new FakeTavily(), ledger: new Ledger(), limits: limits({}), webSearches: 0, ids: { grandparent: [], visitor: [] }, placeTags: [], qlooAnswers: 0, qlooFailures: 0 };
    const out = await runToolCall(call("qloo_search", { query, type, for: "grandparent" }), ctx);
    const taken = ctx.ids.grandparent.length === 1;
    const firstResult = taken && ctx.ids.grandparent[0] === answered[0]?.id;
    lines.push(`${file}: "${query}" (${type}), ${answered.length} answered, ${taken ? `taken${firstResult ? "" : ", and not the first result"}` : "nothing by that name"} | ${out.summary}`);
    if (A_FAVORITE.includes(query) && !taken) wrong.push(`"${query}" is a favorite and was not taken`);
    if (NOT_AN_ENTITY.includes(query) && taken) wrong.push(`"${query}" is not an entity and something was taken for it`);
    if (!answered.length && taken) wrong.push(`"${query}" had no answer and something was taken`);
  }
  // The report names what Qloo answered, so like everything in .qloo/ it stays out of the repo.
  writeFileSync(".qloo/search-names-report.txt", lines.join("\n") + "\n");
  console.log(`${files.length} real searches read; report in .qloo/search-names-report.txt`);
  expect(wrong).toEqual([]);
});
