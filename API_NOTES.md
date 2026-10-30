# API notes

Results of real calls. Re-run with `uv run python scripts/smoke_nebius.py <models|ping|tools|plan|nothink>` and
`uv run python scripts/smoke_tavily.py ["query"]`. Both scripts read keys from the environment or `.env` and never
print them.

## Nebius Token Factory (2026-10-05, UTC)

Base URL `https://api.tokenfactory.nebius.com/v1`, header `Authorization: Bearer $NEBIUS_API_KEY`, OpenAI-compatible.

**One base URL serves all four Nemotron models.** `GET /models` lists 25 models, including all four NVIDIA ones, and
a real chat call to each returned 200 from that base URL. This holds even though the catalogue places Nano and
Lightning in eu-north1 and Super and Ultra in us-central1. No regional URLs are needed.

| Model | Call | Status | Seconds | Tokens in / out (reasoning) | Cost |
|---|---|---|---|---|---|
| `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` | one-sentence answer | 200 | 1.77 | 32 / 93 (not reported) | $0.000024 |
| `nvidia/Nemotron-3_5-Lightning` | same | 200, cut off at 400 tokens | 1.92 | 32 / 400 (400) | $0.000098 |
| `nvidia/nemotron-3-super-120b-a12b` | same | 200 | 1.31 | 32 / 107 (71) | $0.000106 |
| `nvidia/Nemotron-3-Ultra-550b-a55b` | same | 200 | 1.12 | 32 / 87 (51) | $0.000293 |
| Super | function calling, one tool | 200, `finish_reason: tool_calls` | 1.29 | 432 / 67 (28) | $0.000190 |
| Ultra | full visit plan as JSON from sample evidence | 200 | 4.48 | 343 / 1,614 (1,040) | $0.005185 |
| Lightning, Super, Nano | thinking off | 200 each | 1.2 to 1.8 | 32 / 27 to 53 (0) | $0.000079 total |

Total spent on these checks: about $0.006.

Findings that shape the build:

1. **Reasoning tokens are billed as output** and can be most of it: Ultra's plan used 1,040 reasoning tokens out of
   1,614. `chat_template_kwargs: {"enable_thinking": false}` turns thinking off per call (checked on Lightning,
   Super and Nano: 0 reasoning tokens). Use it for routine steps; keep thinking on for the final plan.
2. **Lightning puts its thinking in the answer text** ("Here's a thinking process: ...") instead of a separate
   field, and ran out of budget before answering. Use it only with thinking off, or use Nano for fast calls (Nano
   keeps its reasoning out of `content`).
3. **Function calling works on Super, but arguments do not always match the schema.** Asked to use a parameter named
   `types`, it sent `type`. The agent loop must validate every tool call and return the error to the model for a
   retry, not trust the arguments.
4. **Every model gave the same generic answer** to "a good song to share with a grandparent": "What a Wonderful
   World" (Super, Ultra, Nano; Lightning with thinking off said "Somewhere Over the Rainbow"). This is the LLM-only
   baseline the Qloo judges warn about, and a good before-and-after line for the demo.
5. Latency: about 1 to 2 seconds per short call, 4.5 seconds for a full plan on Ultra.

### Expected cost per plan (estimate, to be measured on the real engine)

| Step | Model | Assumption | Cost |
|---|---|---|---|
| Agent loop: resolve favorites, call Qloo and Tavily | Super, thinking mostly off | 6 turns, about 3,000 input and 150 output tokens each | $0.006 |
| Write the plan | Ultra, thinking on | 4,000 input, 1,800 output | $0.009 |
| Story questions in the relative's language | Nano, thinking off | 1,000 input, 400 output | $0.0002 |
| **One plan** | | | **about $0.015** |
| Retries and longer tool results (x2 margin) | | | up to $0.03 |
| Re-plan after visit feedback | | about two-thirds of a plan | about $0.01 |

At $0.015 to $0.03 a plan, the $27 of credit covers roughly 900 to 1,800 plans. The spend cap still has to exist
before any public demo, because the linked card keeps paying after the credit runs out.

### Measured on the engine (2026-10-05, synthetic Qloo data)

`npm run test:live` runs the full agent on real Nemotron, with Qloo stood in by synthetic data, and records the
replies to `tests/fixtures/engine-synthetic.json`, which an offline test replays.

| Run | Calls | Time | Cost | Notes |
|---|---|---|---|---|
| 1 | 8 Super, 1 Ultra, 1 Nano | 16 s | $0.0120 | Super made one tool call per reply and used up the 8-round limit before the shared insight and event search |
| 2 | 7 Super, 1 Ultra, 1 Nano | 20 s | $0.0148 | After asking for batched calls: 5 searches in one reply; full sequence completed |
| 3 | 10 Super, 1 Ultra, 1 Nano, 1 Super | 20 s | $0.0167 | Nano's translation added a stray name placeholder; the check caught it and Super redid it |

So a plan costs about $0.015 to $0.017, close to the estimate. Ultra's plan call is about half the cost (1,500 to
2,300 output tokens, mostly reasoning).

## Tavily (2026-10-05, UTC)

`POST https://api.tavily.com/search`, header `Authorization: Bearer $TAVILY_API_KEY`. Free plan, 1,000 credits a
month. Basic search costs 1 credit, advanced costs 2.

| Query | Settings | Status | Seconds | Credits |
|---|---|---|---|---|
| "classic Mexican film screening San Antonio October 2026" | basic, 3 results, `include_usage` | 200 | 1.54 | 1 |

No refusal over the missing billing address. Results were relevant pages (Guadalupe Cultural Arts Center's
CineFestival, Hola Mexico Film Festival, a San Antonio film festival). `published_date` was empty for all three, so
the agent must read the date from the page text and confirm it is current before showing an event. Cache results,
keep to basic search, and cap credits per day.

## Qloo (2026-10-11, UTC)

Base URL `https://hackathon.api.qloo.com`, header `X-Api-Key`, GET with query parameters. Re-run with
`uv run python scripts/smoke_qloo.py search "Pedro Infante" artist 1` (or `get <path> name=value ...`, or `count`).
The script counts every call, answers a repeated call from its private copy, and never prints the key.

**No Qloo response data is kept in this repo.** Qloo's guide (FAQ, as updated 2026-10-07): "Private server-side
caching is fine and there is no time limit on how long you can keep cached responses. Do not store Qloo response data
in a public repository". So this file records statuses, timings, limits and field names only. The raw responses are in
the ignored `.qloo/` folder on this machine, and `tests/qloo.test.ts` pins the response shapes with invented values.

**First call:** `GET /search?query=Pedro+Infante&types=urn:entity:artist&take=1` returned **200** in 0.37 s, with the
right artist. The key works on the hackathon server.

**Limits, from the response headers** (the key email and the guide give no numbers):

| Header | Value | Meaning |
|---|---|---|
| `X-Second-RateLimit-Limit` | 5 | calls a second |
| `X-Month-RateLimit-Limit` | 10000 | calls a month; `X-Month-RateLimit-Reset` counted down from 2,592,000 s (30 days) |
| `X-Month-RateLimit-Remaining` | 9972 after the probe | 28 probe calls, all 200. A plan uses 11 or 12 more |

The app's own limit is now 300 Qloo calls a day (it was 3,000 while the quota was unknown), so it cannot use up the
month by itself. The guide says limits "can be raised on a per-user basis" by asking in Discord #api-help.

**Calls made (28, all 200):**

| Endpoint | Calls | Seconds | Result list | Notes |
|---|---|---|---|---|
| `/search` | 12 | 0.26 to 0.98 | `results[]` | `types` and `take` work. Every favorite tried resolved at rank 1, accents or not ("Javier Solis"). A Ukrainian band was found only in Cyrillic, not in its Latin spelling |
| `/v2/insights`, films and artists | 8 | 1.3 to 8.7 | `results.entities[]` | `filter.release_year.min/max`, `signal.demographics.age=55_and_older` and mixed artist and film signals all work |
| `/v2/insights`, places | 4 | 1.1 to 7.7 | `results.entities[]` | `filter.location.query` accepts "San Antonio, Texas", "Houston", "Chicago"; `filter.tags` works |
| `/v2/insights`, `filter.type=urn:heatmap` | 1 | 2.0 | `results.heatmap[]` | 200, not 403: 541 cells for one city |
| `/v2/analysis/compare` | 2 | 0.8 | `results.tags[]` | **Returns tags, not entities.** `take` is not honored (52 and 24 tags came back) |
| `/v2/tags` | 1 | 0.6 | `results.tags[]` | `filter.query` works; some results are noise (dish names) |

**Field names the app reads** (the docs give the envelopes but not these):

- Search entity: `name`, `entity_id`, `types` (a list such as `["urn:entity:artist"]`), `popularity` (0 to 1),
  `disambiguation`, `tags[]` (`name`, `tag_id`, `type`, `value`), `properties` (for a film: `release_year`,
  `release_date`, `content_rating`, `akas[]`).
- Insights entity: the same, except the kind is in `subtype` (`"urn:entity:movie"`) with `type: "urn:entity"`, tags
  carry `id` instead of `tag_id`, and `query.affinity` (0 to 1) is added. Places add `properties.address`,
  `properties.is_closed` and `location`.
- `disambiguation` is the year and director for a film, the address for a place, and the name again for an artist.
- Compare: `results.tags[]` with `tag_id`, `name`, `subtype` (`"urn:tag:genre:music"`, `"urn:tag:theme:qloo"`) and
  `query.score`, plus which entities on each side carry the tag. The same name can come back under two subtypes.
  `results.a` and `results.b` hold each side's own tags; `results.matchEntities` was empty both times.
- Tag search: `results.tags[]` with `id`, `name`, `type`.

**What this changed in the code** (`lib/qloo.ts`, `lib/tools.ts`, each with a test):

1. Compare was parsed as a list of entities and so returned nothing. It now returns the shared traits, which the
   planner reads as context for the bridge.
2. The kind is read from `types` (search) or `subtype` (insights) and shortened to `artist`, `movie`, `place`.
3. Qloo's `disambiguation` goes to the planner as a note, so it can tell a film from its remakes and say where a
   place is without adding that from memory.
4. Only the best search match counts as evidence; the near-misses on a name no longer reach a card.
5. A closed place is skipped. A 429 is retried once after 1.1 s (5 calls a second is easy to pass with two plans).
6. Still unchecked: books (`properties.publication_year` is a guess) and `urn:entity:destination` in `/search`,
   whose documented `types` list does not include it.

### Measured on the engine with real Qloo data (2026-10-11)

| Run | Where | Calls | Time | Cost | Result |
|---|---|---|---|---|---|
| 1 | local | not recorded | 44 s | $0.0307 | No plan: the grounding check rejected the draft and its correction. The engine then dropped the whole plan; it now keeps it without the unsupported moment |
| 2 | local | 7 Super, 1 Ultra, 1 Nano, 1 Super | 48 s | $0.0215 | Plan. The event card was a festival that had ended three months earlier |
| 3 | local | 10 Super, 1 Ultra, 1 Nano | 48 s | $0.0293 | Plan, no event. Two Spanish questions addressed the grandmother in the masculine |
| 4 | preview | not recorded | 37 s | $0.0269 | Plan through the deployed route. The event card gave a festival a date that was a ticket-sale date on its home page (checked by reading the page) |
| 5 | preview | not recorded | 26 s | $0.0233 | Plan through the deployed route, with the fixes for 1 to 4. This is the saved plan |

So a real plan costs **$0.021 to $0.031**, about twice the synthetic figure: real results are longer, Super takes 7 to
10 replies, and Ultra used up to 3,286 of its 3,500 output tokens. Each plan made 11 or 12 Qloo calls and 1 Tavily
search. Under the $0.04 plan cap there is no room for a second Ultra call, so a correction is usually not possible;
the engine now falls back to the first draft without its unsupported moments. Sonu to decide: raise the cap, or cut
the gathering cost first (fewer, fuller replies from Super).

The first four plans chose the same bridge: one film that Qloo returns both for the visitor alone and for the two of
them together. It is specific to this family, not a title that is popular everywhere. **The bridge is not stable,
though.** A plan recorded later that day (run 6 below) asked for artists for both of them instead of films, and its
bridge was an artist from the grandparent's side only. Which bridge comes out depends on which type the gathering
model asks for.

Later runs on 2026-10-11 (bus 003, cap per plan now $0.06):

| Run | Where | Time | Cost | Result |
|---|---|---|---|---|
| 6 | local | 42 s | $0.0217 | Plan. Bridge: an artist, see above. One question assumed the grandparent grew up in the city she lives in now |
| 7 | preview, Qloo forced to fail | 2 s | $0.0007 | No plan, by design: three failures and no answer, so the agent stopped after one model call and said Qloo is not answering |
| 8, 9 | preview, Tavily forced to fail | 33 s, 22 s | $0.0352, $0.0222 | Plan without events. The model tried the web search twice each time |
| 10 | preview, scripted run, plan 1 | 26 s | $0.0244 | Plan. Bridge: a film |
| 11 | preview, scripted run, plan 2 (after feedback) | 27 s | $0.0344 | Plan. Bridge: an artist. Still one film, although the feedback said the film was too long |

Through the deployed route only 14 Qloo calls reached Qloo that day, across eight plans: the sample family's lookups
come from the 7-day cache in Redis. `uv run python scripts/spend_status.py` reads the app's own counters: $0.1671
spent through deployed routes by the end of the day.

### After the rebuild of the engine (2026-10-11, later the same day)

Three things were rebuilt, in this order: the feedback step, gathering, and the choice of the bridge. What was
measured on real services afterwards:

| What | Before | After |
|---|---|---|
| Gathering (Nemotron 3 Super) | 7 to 12 replies, one or two calls each, the calls run one by one: about $0.012 to $0.018 | 4 replies (5 searches; 4 insights and the compare; the web search; "done"), a reply's calls run together: about $0.004 |
| The plan (Nemotron 3 Ultra) | Thinking on: 8 to 13 s and about $0.01. Once it wrote its thinking into the answer, used all 3,500 tokens and gave no plan | First draft with thinking off: 2 to 3 s and $0.003. Thinking only for a draft the checks send back |
| One plan, nothing cached | 42 to 48 s, $0.021 to $0.035 | 20 to 27 s, $0.008 to $0.009 (4 runs) |
| One plan through the deployed route, sample family (Qloo answers cached) | 26 s, $0.024 | 9.5 to 11.5 s, $0.007 to $0.009 (5 runs) |
| The bridge card | With the rest of the plan | As soon as it is chosen: 6 to 9 s on the deployed route, 17 to 21 s with nothing cached |
| The bridge itself | Chosen by the planner: changed from run to run, often from the grandparent's side only | Chosen by Qloo's numbers (below): the same film, with the same two affinities, in 7 runs out of 7 once the signals were fixed |
| After "the music was a hit, the film was too long" | No more music, still a film | More music cards every time (1 to 3, 1 to 4 or 3 to 4), no film, nothing repeated: the last 5 scripted runs out of 5. One run before them went 3 to 3, when "more" was capped at three |

**How the bridge is chosen** (`lib/bridge.ts`). Qloo is asked, with `filter.results.entities`, how much each person's
taste likes what it suggested for the other. Checked on 2026-10-11: 17 film ids in, the same 17 back, each with
`query.affinity`. Every candidate then has an affinity with each of them, and the bridge is the one whose lower
affinity is highest. For the sample family, in invented figures of the same shape (the measured ones stay on this
machine), the winner has 0.83 with the grandparent's favorites and 0.93 with the visitor's, and the next three
candidates are at 0.80, 0.80 and 0.79 on their lower side. Two things learned on the way:

- Qloo's own list "for both" (one call with both people's signals) leans to whoever gave more signals and to films
  that are simply famous. It is no longer asked for.
- The winner changed when the model passed only some of a person's favorites as signals. Searches now say whose
  favorite they are for, and every call for a person goes out with all of that person's ids.

A plan now makes 14 Qloo calls when nothing is cached: 5 searches, 4 insights, 1 compare and 4 for the bridge check.

**How the model spreads its calls** was not steady at first: in 1 run of 6 it made one call per reply (12 replies).
Temperature 0, `parallel_tool_calls` and a prompt that names the replies settled it at 4 replies in the 7 runs since
(`tests/gather.live.test.ts` tries this stage alone for a third of a cent). A reminder sent after a single-call
reply made things worse when it came late: the model invented 13 further calls. It is now sent only after a first
reply.

**Which model writes the questions in the grandparent's language.** The same three questions were put into Hindi and
Spanish by each Nemotron model, thinking off, with the agent's own instruction:

| Model | Hindi | Spanish | Seconds | Cost |
|---|---|---|---|---|
| Nano | Stilted in one question | Two slips ("qué fue la primera película"; "se siente como hogar") | 1.3 to 1.9 | $0.00003 |
| Super | One gender disagreement | One slip ("que aún sienta como hogar") | 0.8 to 1.0 | $0.0001 |
| Ultra | Natural, no slip found. Added a name once, which the check catches | Natural, no slip found | 0.7 to 0.9 | $0.0004 |

Ultra writes them now. This is my reading as someone who is not a native speaker of either language: a native
reader should look at both before the submission. Before the instruction asked for it, the Hindi addressed a
grandfather with the familiar "tum"; it now uses "aap".

**A family typed into the form** (invented: a Hindi-speaking grandfather born in 1938; a visitor who loves an American
pop singer, an animated film and baking). Nothing cached: 24 s, $0.010, 14 Qloo calls. The bridge by Qloo's numbers
was a film with 0.78 for the grandparent's favorites and 0.94 for the visitor's (invented figures of the same shape;
the measured ones stay on this machine). Three questions in Devanagari.

**What the fast planner gets wrong**, seen in real drafts and now either checked or ruled out in its instructions:
it repeats the bridge as a moment (that moment is left out, no second call), it once said the grandparent "has loved
his voice for years" about a suggestion, it once asked about "Abuelo" although nobody had mentioned a grandfather,
and it wrote that an item "appears in Qloo insights for each of them" when it did not.

Web events are the weak part. Tavily returns different pages for the same query from one call to the next, a page's
snippet does not say when an event happens, and one result was not a fit for a family visit. Event cards are now
leads to check: any date or time is replaced by a plain caution and the card links to its pages.

### What is sent where (2026-10-11, bus 004)

The page says this field by field ("What is sent, and where"), and `tests/privacy.test.ts` holds the code to it.

| To | What | Where in the code |
|---|---|---|
| Nemotron 3 Nano | The earlier visits: each card's title and kind, which landed, and the note | `lib/feedback.ts` |
| Nemotron 3 Super, gathering with tools | Both lists of favorites; the years of the grandparent's youth and the city (in its instructions); the earlier cards and which landed; after a visit, what to ask for more of and what to leave out, as worked out in code from Nano's answer | `searcherText` and `gatherPrompt` in `lib/agent.ts` |
| Nemotron 3 Ultra, planning and the questions | Everything the browser sent: favorites, birth year, language, city, grandmother or grandfather, the earlier visits with their notes; and the evidence gathered | `familyText` in `lib/agent.ts` |
| Nemotron 3 Super, second try at a question | The English questions, the language, grandmother or grandfather. It has no tool there | `translateQuestions` |
| Qloo | `/search`: the words the gathering model wrote (a favorite, or a title that landed), a type, a count. `/v2/insights`: a type, Qloo's own ids, release years, the age band, a count, and the city for places only. `/v2/analysis/compare` and the bridge check: ids only. `/v2/tags`: a keyword | `lib/qloo.ts` |
| Tavily | The search the gathering model wrote, and three fixed settings. Nothing when no city was given | `lib/tavily.ts`, `web_search` in `lib/tools.ts` |
| Never | The two names: they stay in the browser | `app/family-form.tsx` |

Before this, the gathering model read the whole family and the notes, so the page's promise would have rested on the
model not copying them into a search. It now cannot: it is not given the language, grandmother or grandfather, the
birth year itself or a note. The years of youth still give the birth year away exactly, and the page says so
("worked out from the birth year").

Measured after the change, same day:

| What | Result |
|---|---|
| Gathering alone, invented Qloo data (`tests/gather.live.test.ts`) | 4 replies, as before: 5 searches; 4 insights and the compare; the web search; "done". $0.0037 |
| The feedback step, real Qloo data, on this machine (`tests/feedback.live.test.ts`) | Music cards 1 to 4, no film, nothing repeated. 20 s, $0.0082, 11 Qloo calls. No tool call carried a word of the note |
| The scripted run on a preview | 8 of 8; the same bridge with the same two affinities; $0.0208 for the two plans |
| Six plans for the sample family through the deployed route | The same bridge in all six; 8 to 12 s and $0.0091 to $0.0108 each |

One residue: a card's title comes back from the browser after a visit and, if it landed and is a film, a singer, a
show, a book or a place, is searched in Qloo. A title must name something in the evidence, but it may hold more
words than the name. So a planner that wrote part of a note into a title could, in principle, send those words to
Qloo on the next plan. Not seen; noted so the promise is not claimed to be wider than it is.

### Bus 005: the tag search, places, and the wording rules (2026-10-11, evening)

**`/v2/tags` and places.** Two calls by hand, then through the engine. As before, no value from a response is kept
here: the responses are in `.qloo/`.

| What | Result |
|---|---|
| `/v2/tags?filter.query=<a dish>&take=8` | 200 in 0.3 s. Each tag has `id`, `name`, `type`, `popularity` and `parents`, the kinds of entity it describes. For a dish, all eight described places: two named a kind of place (one `urn:tag:genre:place...`, one `urn:tag:category:place...`), the rest were a cuisine, dishes and menu lines |
| `/v2/insights` with `filter.type=urn:entity:place`, `filter.tags=<the kind-of-place tag>`, `filter.location.query=<the city>` | 200 in 0.7 s: 5 of 5 were places of that kind, in that city, each with an address. Without a tag the same search had returned the city's landmarks (probe of the morning) |
| The same with both people's ids as signals | Places of the same kind, but a different list: Qloo ranks them by the two tastes |
| `/v2/tags` for a spiced tea | Only dishes from single menus, no kind of place. A place search with the first of them returned nothing, and the planner made a dish card from the tag's name. The code now uses a tag only when its type names a kind of place, and shows the planner nothing otherwise |

So the fourth endpoint has a job in the plan: when the family names a dish and gives a city, the outing is somewhere
near the grandparent that serves it (`qloo_tags` and `qloo_insights` in `lib/tools.ts`). The tag is chosen in code.
The card shows Qloo's own address and "Check that it is open before you go". A plan now makes 16 Qloo calls when
nothing is cached: 5 searches, 1 tag search, 4 insights, 1 place search, 1 compare and 4 for the bridge check.

**What the gathering model does with it** (`tests/gather.live.test.ts`, invented Qloo data): 3 replies. The first
holds the five searches and the tag search, the second the four insights, the compare, the place search and the web
search. $0.0030.

**The wording rules on real plans.** The rules in `lib/wording.ts` were written from six plans recorded in the
afternoon and then held against every recording on this machine (`tests/recorded.live.test.ts`, no cost):

| Recordings | Made by | What the rules catch in them |
|---|---|---|
| Six, 16:51 UTC | The engine before the rules | 16 things in six plans: a sentence about what one of them "adores", "cherishes", "treasures", "knows" or "grew up with" in every plan, two questions that assumed a fact, one Spanish slip; and 4 web leads that a recording now leaves out, one of them labelled a place |
| Three, 19:50 UTC | The first version of the rules | 4 things: "her love for classic cinema" beside a favorite of his, "close to both of their hearts", "songs they both feel", and a question about the memory of an artist Qloo had only suggested. The rules were tightened for each |
| Four, 20:08 UTC | The engine as it is now | Nothing |

What the planner does now that its instructions say the same as the rules: of 14 plans read after the change, 6
needed nothing taken out and 8 had one to four sentences taken out or a question left out. None was sent back for
it: the repair is done in code and costs no model call.

**Cost and time, measured today on the engine as it is now:**

| What | Result |
|---|---|
| A first plan, nothing cached, on this machine (6 runs, two families) | 20 to 25 s, the bridge at 16 to 21 s; $0.0080 to $0.0102 |
| A first plan through the deployed route, sample family (11 runs) | 8 to 14 s, the bridge at 6 to 11 s (4 runs timed in a browser); $0.0087 to $0.0110. One took 15 s and $0.016: its first draft was sent back |
| The plan after feedback, deployed route (3 runs) | 11 to 16 s; $0.0081 to $0.0131 |
| The planner's first draft | 1,750 to 2,300 tokens in and 450 to 700 out, in 2 to 3 s. Five questions instead of three add about 40 tokens |

**What was learned about the questions in translation** (LANGUAGE_REVIEW.md has the sentences):

- The model that translates adds a form of address the English did not have ("abuela"). Left as it is, and put to
  the native reader.
- It once made the two of them women ("juntas") for a grandmother and a grandson. Nothing about the visitor is
  ever sent, so a rule now refuses the feminine forms for the two of them together.
- It once translated a film's English title into Hindi words, and once gave a film its real Spanish release title.
  A rule keeps a card's title unchanged where the language is written in Latin letters; in another script no rule
  can tell a title written by sound from one translated by meaning.

**What is sent where, changed in bus 005.** `/v2/tags` now gets one or two words for a dish the family named, and a
count. A place search gets a type, the ids of both people, the tag, the city and a count. With no city there is no
place search at all. The page and `tests/privacy.test.ts` say the same.

### Bus 006: Qloo's finds, the bridge against fame, the tool-call slip (2026-10-11, late evening)

As before, no value from a Qloo response is kept here. The page shows the two affinities of a bridge and, since this
bus, what the most popular score beside it; those are on the page, not in these notes.

**Why a plan held none of Qloo's finds beyond the bridge.** The trace of that plan (a family typed into the form)
shows the planner had all of them: four lists of suggestions and the bridge check were in the evidence it read. It
wrote five moments, and every one was something the family had listed. The instruction against that had no check
behind it. Since the bus 005 change the planner is also shown, as its example of a sentence that is allowed, one
that names a favorite; that may have pulled it further towards their own lists, though one trace cannot show it.
The rule and its tests are in `lib/plan.ts` (`withQlooFinds`) and `tests/plan.test.ts`.

| Runs for the same family, real services | Qloo's finds among the four cards shown | Their own listed works | Cost |
|---|---|---|---|
| The plan that prompted this (bus 005) | 0 | 3 | $0.0080 |
| A second plan before the rule (bus 005) | 2 | 1 | $0.0095 |
| Six plans with the rule and the finds named to the planner | 3, 3 or 4 | 0 | $0.0101 to $0.0151 |

In those six the code never had to put a find in: naming them to the planner was enough. The rule is what holds if
it is not. The first three of the six cost more than the last three because gathering took 5 or 6 replies: the
model tried again after "nothing found" answers from the tag search and the web search. Those answers now say not
to, and gathering is back to 3 or 4 replies.

**A list sent as text.** In one of those runs Nemotron 3 Super sent `"visitor_ids": "=[\"id\", \"id\"]"`: the list as
a piece of text that begins with an equals sign. The schema refused it, as it should, and the model sent the same
thing in its next two replies. That plan had no compare evidence and no place search. `lib/tools.ts` now reads such
text as the list it spells before the schema sees it. Seen in one of the runs made in this bus.

**The bridge against what Qloo suggests to anyone** (`lib/bridge.ts`, rubric item 3).

| Asked | Answer |
|---|---|
| `/v2/insights` with a type and nothing else | 400: "at least one valid signal or filter is required" |
| The same with a floor on popularity (`filter.popularity.min=0.9`), films | 200: the 50 most popular films, the same list a span of years alone returns. Artists: 200 as well |
| Is the sample family's bridge on that list? | No. One of the visitor's own favorites is |
| How much do the two tastes like those 50 films? (`filter.results.entities`, once for each person) | Every one of them gets a high affinity from both. The middle of the list is about a tenth below the bridge on each side. On the visitor's side the bridge is above all of them. On the grandparent's side three of them are above it. Taking the lower of the two sides, as the bridge rule does, two of the 50 beat the bridge |

What follows from it:

- Qloo's affinity runs high for famous things whatever the taste, so the two numbers on the bridge card say less
  than they seem to. They now stand beside what the most popular score.
- The bridge is "more than famous" by this measure: it is not one of the 50, and each taste likes it more than the
  middle of them. The code prefers such a candidate and the scripted run checks it.
- It is not more than that. The sample family's bridge is itself a very well known film. It was chosen from what
  Qloo suggested for each of the two people, each list drawn from that person's own taste (and, for the grandparent,
  from the years of their youth), not from everything Qloo knows. That narrowing is what keeps a blockbuster from
  winning on a number that is high for everyone.
- A plan now makes 22 Qloo calls when nothing is cached (it was 16): two more for each type, to score the most
  popular against each taste. The list of the most popular is the same for everyone and is cached for a week. At
  300 calls a day that is 13 families nobody has asked about before; the month's 10,000 allow about 450.

**Keyboard and contrast** (`e2e/a11y.spec.ts`). The colour pairs, by the WCAG formula:

| Pair | Light | Dark | Needed |
|---|---|---|---|
| Text on the page | 14.3 | 14.9 | 4.5 |
| Small grey text on a card | 5.96 | 6.93 | 4.5 |
| Grey text on a chip | 5.04 | 6.31 | 4.5 |
| A link on the page (the lowest pair) | 4.77 | 6.38 | 4.5 |
| The button's words | 5.06 | 6.38 | 4.5 |
| A step that failed | 5.12 | 9.58 | 4.5 |
| Example text in a field, the edge of a field | 5.96 | 6.93 | 4.5 and 3 |
| The focus ring against the page | 4.77 | 6.38 | 3 |

Before this bus: a link in the dark colours 1.87, example text in a dark field 3.58, the edge of a field about 1.3.
Not checked: a screen reader, a browser other than Chromium, zoom to 200%.

**The landing text's figure on distance.** AARP's 2018 line ("Over half have at least one grandchild who lives more
than 200 miles away") has a successor. In the 2026 study the bands are "201 - 499 miles" and "500 miles or more",
answered by 11% and 29%, and a grandparent could name both. So at most 40% have a grandchild more than 200 miles
away, where the 2018 line said over half. The page now quotes the 2026 question and its "500 miles or more" line.

### Bus 007: the video take, and Token Factory's docs (2026-10-12)

As before, no value from a Qloo response is kept here.

**Two plans through a test preview, for the video** (22:26 UTC, the sample family, Qloo's answers cached from the day
before): $0.0203 together, 7 Qloo calls and 2 Tavily credits. Each plan was on the page within the time its
captions allow, 23 seconds for the first and about 20 for the second; the recorder does not time them more closely.
The checks the scripted run makes on the feedback step passed: more music (1 item, then 3), no film, nothing
repeated.

**Seen in the second run's steps:** the gathering model searched Qloo for the family's own phrase about a dish, as a
place, and got an unrelated place whose name shares one word with the phrase. In the first run it had rightly left
that phrase to the tag search. Whether the id then went out as one of the grandparent's signals is not shown by the
take. Not fixed.

**Token Factory's documentation, read for the feedback draft** (https://docs.tokenfactory.nebius.com/llms.txt and
five of its pages):

| Looked for | Found |
|---|---|
| A way to switch thinking off, or any page on reasoning | Nothing in the index of 269 lines. The app uses `chat_template_kwargs: {"enable_thinking": false}`, found by trying it on 2026-10-05 |
| `parallel_tool_calls` | Not on the function calling page. It works on Nemotron 3 Super |
| A strict mode for tool arguments | None on the function calling page. The structured output page documents `"strict": true` for `response_format` with `json_schema`, which the app does not use: it asks for a JSON object and checks it itself |
| A spending limit | The billing page describes charging the card automatically at a threshold and at the start of a month. No limit at which a key stops. The console itself was not looked at |

### Bus 008: the two faults seen in the video take (2026-10-13)

As before, no value from a Qloo response is kept here. The answers are in `.qloo/`.

**Fault a: two cards of one plan with the same sentence.**

| Evidence | What it shows |
|---|---|
| The take's own list of steps for its second plan | "Took out 3 sentences that said more about them than the family told us", and no "Put in ... of Qloo's own finds". So the planner had written the cards, and a rule had taken a sentence from three of them |
| `lib/plan.ts` as it was | A card left with no sentence got the plain line for its kind, and there was one line for each kind. Two music cards that both lost their sentence read the same. A find put in by the code said that line too |
| The 38 plans recorded on this machine before the take | 8 of 152 cards carry a plain line, in 6 plans. No plan had two of one kind, so the fault had not shown. After "more music" a plan holds three or four music cards, and it shows |
| Two tests that already existed | Each produced two cards with one sentence and looked at only one of them |

Fixed in `lib/plan.ts` (`withDistinctLines`): a card that repeats an earlier one takes the next plain line of its
kind, and each kind has two to four. What it does not fix: such a card is still plain. The planner goes on writing
what they "love" or "grew up with", and the rule goes on taking the sentence out whole.

**Fault b: a search for the family's own phrase took an unrelated place.**

| Asked | Answer |
|---|---|
| What does Qloo's `/search` give for the habit the family named, as a place? (one call, 2026-10-13) | Five places. Each shares one word with the phrase, in its name or its address. None is what the family meant |
| What did the code do with them? (`lib/tools.ts` as it was) | It took the first result as that person's favorite without looking at its name. Its id joined her signals for every later call. Every result's id was also open to the model |
| Does one wrong signal matter? Her three real favorites as signals, then the same with that place added (artists, 8 asked for) | 4 of the 8 names differ |
| And under the take's own signals, her three favorites and the artist that had landed (6 asked for)? | 2 of the 6 names differ, and the order of the other four changes: a different artist comes first. The take's list is, name for name and in order, the one with the wrong place among the signals. A plan takes its finds from the top of each list, so the family saw a different artist card than they would have |
| Is the slip steady? The take's second request, sent again to the fixed build | No. This time the model left the phrase to the tag search, as it is told to. The list for the grandparent came back in the order Qloo gives without the wrong signal |
| How do real favorites come back? The 12 real searches kept before that day | Each of the ten that Qloo answered came back first under its own name, accents aside. A name asked in Cyrillic came back in Cyrillic |
| Nine more searches made to try the rule (2026-10-13) | A name with one letter wrong: the right artist is second, another artist first. One name of an artist's two: found. A film asked by its Japanese title: found, under its English name. A dish and a habit, as places: places that only share the word. A name in Devanagari: nothing |

Fixed in `lib/tools.ts` and `lib/evidence.ts` (`isSameName`): a result counts only if its name, or one of the other
names Qloo gives a film, is what was asked for. Run over all 21 real answers
(`tests/search-names.live.test.ts`, no cost): the 16 favorites are taken, one of them from second place, and the
dish, the habit and the phrase are not.

**On a test preview of the fixed build** (2026-10-13, 04:00 to 04:03 UTC, removed afterwards):

| Run | Result | Cost |
|---|---|---|
| The take's second request again | A plan in 12.5 s. Six searches, each for a real favorite or the artist that landed. Four cards, four sentences | $0.0087 |
| The scripted run | 8 of 8, with two checks added for these faults on both plans. First plan 13.0 s; second 23.5 s, with four music cards and no two sentences the same | $0.0228 |
| An invented family with a favorite Qloo cannot have | Qloo's search gave five near-misses for the invented name. The tool answered "nothing by that name", the model did not search again, and a plan arrived in 18.6 s from her one real favorite | $0.0093 |

**A correction.** The message of commit `0dc1d40` says one card of the take's plan "is from the list that only the
wrong signal gives". That is more than was measured. The artist on that card is in Qloo's list with or without the
wrong signal: the wrong signal moved it from fourth place to first, and the plan takes from the top. The table above
has it right. The commit is pushed and its message stands as written.

**Limits of the rule.** A habit whose words happen to be the whole name of something in Qloo would still be taken.
A favorite typed as one word of a film's or a place's longer name is no longer found. A name asked in a script
Qloo answers in another, with no other name to compare, is taken as before.
