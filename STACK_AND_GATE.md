# Stack, host and gate

Status: approved by Sonu on 2026-10-05 (UTC), spend caps included. Written 2026-10-05 (UTC).

Changed while building (same intent, fewer dependencies):
- Token Factory is called with plain `fetch`, not the `openai` package. The smoke tests already prove the raw
  protocol, and `fetch` passes `chat_template_kwargs` and the reasoning fields without type workarounds.
- Rate limits and spend counters use `@upstash/redis` directly through a small storage interface, not
  `@upstash/ratelimit`, so the same code runs on an in-memory store in tests.
- TypeScript 5.9, not 7: version 7 is the new native compiler, which Next 16 may not support yet.
- Live planning is behind an explicit switch (`LIVE_PLANNING=on`). Off by default, so a deploy makes no model call
  until it is switched on. It serves Common Ground and Welcome Table
alike: both run the same engine (favorites in, Qloo and Tavily evidence, a Nemotron plan out).

## Changes from bus 001 (2026-10-05)

- `RATE_LIMIT_SALT` became `HASH_SECRET`. One server secret now keys every one-way hash: the network address for
  rate limits, and the cache keys for Qloo and Tavily lookups.
- Caches store parsed public results only, under hashed keys. Nothing a visitor typed is stored. Logs record an
  error's name and status, not its text.
- `/api/health` reports `counters` (redis, memory or unavailable) and `pausedFor` (off, daily, total or no_counters).
  It reads Redis even while planning is off, so a preview can prove Upstash is wired before anything is switched on.
  Since 2026-10-13 one instance reads it at most once a minute, and the answer says when (`checkedAt`) and which
  commit the build was made from (`build`).
- The daily and total caps have different messages. The page says planning is paused before anyone clicks, and
  offers a saved real plan if one has been recorded.
- The full variable list and the deploy stages are in DEPLOY.md.

## The demo's life (bus 001, point 4)

- **Worst case per address.** As first approved, one address could make 20 plans a day; at the $0.06 plan cap that
  is $1.20 of the $1.50 daily cap. Measured plans cost $0.012 to $0.017, so 20 real plans are about $0.34; the $0.06
  only bounded a runaway plan. Sonu lowered both on 2026-10-05: 10 plans a day and a $0.04 cap, so one address can
  take at most $0.40 a day.
- **The daily cap is shared.** A few busy addresses can pause planning for everyone until 00:00 UTC.
- **The total cap.** $25 at the maximum $1.50 a day lasts 17 days. From an Oct 12 launch it could in theory run out
  by Oct 29, before both judging windows (Qloo Nov 2 to 5 since the rules changed, Nebius Dec 1 to 15).
- **What a judge saw before this change.** "Paused for today, please come back tomorrow", even when the total was
  spent, and an empty page.
- **What a judge sees now.** The page says live planning is paused before anyone clicks. When the total is spent it
  says "paused while its budget is topped up". Once a saved plan is recorded (real Qloo data only), the page offers
  it, labelled as a recording with its date. The saved plan keeps the demo useful: the bridge, the moments, the
  questions, the evidence trail and the agent's steps. What it cannot show is the agent working live.
- **Decided by Sonu on 2026-10-05:** `IP_PLANS_PER_DAY` 10 and `PLAN_CAP_USD` 0.04, still 2.4 times the most
  expensive measured plan. Applied.
- **Raised by Sonu on 2026-10-28 (bus 013):** 20 plans a day from one address and no separate hourly limit
  (`IP_PLANS_PER_DAY=20`, `IP_PLANS_PER_HOUR=20`, Production only), "since we are close to the deadline". I advised
  keeping 10. The worst case per address is again 20 plans at the $0.06 plan cap, $1.20 of the $1.50 daily cap ($3.00
  during Qloo judging); at about one cent a plan, as measured on 2026-10-27 and 2026-10-28, 20 plans are about $0.20.
  In force from the build made that day, once promoted.
- **Reserve:** approved on 2026-10-06; see below.

## Reserve (approved by Sonu on 2026-10-06, built into the code)

Since 2026-10-27 the project is entered in the Qloo hackathon only (RULES_NOTES.md, the top); the schedule below was set
for both and is unchanged in the code. Part of the $25 is held for the two judging windows. The total cap rises on a
fixed schedule in `lib/config.ts` (`BUDGET_SCHEDULE`), so nothing depends on anyone changing a setting on the day.
`TOTAL_CAP_USD` and `DAILY_CAP_USD` still override it. Live planning switches off by itself at the end of Nebius
judging, and `LIVE_PLANNING=on` cannot turn it back on.

| From (UTC) | The rules' own line | Total cap, cumulative | Daily cap | Held for |
|---|---|---|---|---|
| Launch | (none) | $8 | $1.50 | Building, the scripted runs, both submissions, early visitors |
| 2026-11-02 17:00 | Qloo: "November 2, 2026 (12:00 pm Eastern Time)" | $15 | $3.00 | At least $7 for Qloo's judges |
| 2026-11-17 04:45 | Qloo: "November 16, 2026 (11:45 pm Eastern Time)" (the rules now say November 5: RULES_NOTES.md, "Re-read on 2026-10-27") | $15 | $1.50 | The gap; Nebius's share is not touched |
| 2026-12-01 17:00 | Nebius: "Tuesday, December 1, 2026 (9:00 am Pacific Time)" | $25 | $3.00 | At least $10 for Nebius's judges |
| 2026-12-15 20:00 | Nebius: "Tuesday, December 15, 2026 (12:00 pm Pacific Time)" | live planning off | n/a | The page keeps the saved plan |

The full lines, quoted from section 1, "Dates and Timing", of each rules page. Both were re-fetched on
2026-10-06 00:50 UTC and are unchanged from 2026-10-04.

> Source: https://qloo.devpost.com/rules, section 1 "Dates and Timing":
> "Judging Period: November 2, 2026 (12:00 pm Eastern Time) – November 16, 2026 (11:45 pm Eastern Time) (“Judging Period”)."

> Source: https://nebiusglobalaihackathon.devpost.com/rules, section 1 "Dates and Timing":
> "Judging Period: Tuesday, December 1, 2026 (9:00 am Pacific Time) – Tuesday, December 15, 2026 (12:00 pm Pacific Time) (“Judging Period”)."

Conversions:
- Eastern Time on November 2 and 16 is EST (UTC-5), because US daylight time ends on November 1, 2026.
- Pacific Time on December 1 and 15 is PST (UTC-8).
- The schedule pages agree: "November 02 at 12:00pm EST" to "November 16 at 11:45pm EST", and "December 01 at
  9:00am PST" to "December 15 at 12:00pm PST".

Pause messages:
- When a tranche is spent early, the page says when the next one opens, for example "paused until 2 November,
  17:00 UTC".
- After the end of Nebius judging it says "Live planning ended when hackathon judging closed on 15 December 2026."

Tests (`tests/budget.test.ts`) check each boundary to the second. A mutation check confirms that removing the
switch-off fails them.

## Stack

| Part | Choice | Why |
|---|---|---|
| Language | TypeScript, Node 24 | One language for the server and the UI; Node 24 is installed. |
| App | Next.js (App Router) and React | One deploy for the page and the API. Streams the agent's steps to the page as they happen. |
| Models | `openai` npm client pointed at `https://api.tokenfactory.nebius.com/v1` | Token Factory is OpenAI-compatible (checked: all four Nemotron models answer on that one URL). |
| Agent loop | Our own, about 200 lines, no framework | We need four things a framework would make awkward: validate every tool call and hand errors back for a retry (Super sent `type` for `types`); choose model and thinking per call (`enable_thinking` off for routine steps); meter the cost of every call for the spend cap; keep a record of every Qloo and Tavily result as evidence. The Qloo rules accept "an agentic tool"; a framework is not required. |
| Tool schemas | `zod` | One schema validates arguments and generates the tool definitions. |
| Qloo | REST to `https://hackathon.api.qloo.com`, server only | Simpler than the harness's MCP server, which the kit says cannot run in serverless functions. |
| Tavily | REST, basic search only, server only | 1 credit a call, cached. |
| Shared state | Upstash Redis (free tier) | Rate limits, spend counters and caches of Qloo and Tavily results must be shared across serverless instances. |
| Family data | The visitor's own browser (localStorage) | The portrait and the visit history stay on the visitor's device; each request sends what it needs. The server keeps no personal data, which answers "who can read or change each record" (CLAUDE.md rule 8): nobody but the visitor. |
| Tests | Vitest for the engine with recorded API responses; Playwright for the scripted demo against the live URL | Tests run offline and cost nothing; the scripted run tests the real thing. |
| Smoke scripts | `scripts/*.py`, Python standard library only | Already written and in use. |

## Host

**Vercel, Hobby plan (free).**
- Functions can run up to 300 seconds; a full plan is expected to take 20 to 60 seconds.
- No cold-start sleep like the free tiers of Render or Railway. Judges in December get a fast page.
- Every push gets a preview URL. Preview builds can turn on fault injection (forced Qloo or Tavily errors) without
  exposing it in production. It is set by an environment variable, never by a route.
- The Hobby plan is for non-commercial use; a hackathon demo fits.

Fallback if Vercel's limits bite: the same Next.js app as a Node server on Fly.io (about $2 to $5 a month, no
duration limit). Not chosen first because it needs a card and a server to watch until Dec 15.

Considered and not chosen: hosting on Nebius AI Cloud (Serverless Endpoints). It would add a second Nebius service
to the Nebius story. But those endpoints are built for serving models, and the setup and cost for a web app are
unknown. Worth a second look only if there is time after Oct 22.

What Sonu has to do by hand: sign in to Vercel with GitHub (`! npx vercel login`), and create the Upstash Redis
database. Adding it through Vercel's Marketplace sets its environment variables automatically.

## Spend cap and rate limits (numbers for Sonu to approve)

Each plan meters its cost from the `usage` in every model response, priced at the catalogue rates.

| Guard | Proposed limit | When it is reached |
|---|---|---|
| Per plan | stop at $0.06 (Sonu, 2026-10-11; it was $0.04 from 2026-10-05) | That plan ends with what it has so far. |
| Token Factory, per day | $1.50 (roughly 50 to 100 plans) | Live planning pauses until 00:00 UTC. The sample family shows its last good plan, labeled as saved. |
| Token Factory, total until Dec 15 | $25 | The same as above, until Sonu raises it. |
| Per IP address | 20 plans a day, and 20 an hour so that no hourly limit binds (Sonu, 2026-10-28, bus 013; 6 an hour and 10 a day from 2026-10-05, 20 a day before that) | A friendly "try again later" message (HTTP 429). |
| Tavily | no more than 2 basic searches a plan; 30 credits a day; results cached 24 hours | Plans go ahead without events and say so. |
| Qloo | results cached 7 days; 300 calls a day (was 3,000 until the quota was known: 10,000 a month, read on 2026-10-11) | Cached results only. |

Expected cost is about $0.015 a plan, up to $0.03 with retries (API_NOTES.md), plus about $0.01 for each re-plan
after visit feedback.

After the engine was rebuilt later on 2026-10-11 a plan costs $0.007 to $0.011 (API_NOTES.md), so the $0.06 cap now
leaves room for several corrections. Before that:

Measured on real Qloo data on 2026-10-11: $0.021 to $0.035 a plan, with no retry. The $0.04 plan cap left no room
for a second planning call, so Sonu raised it to $0.06 on 2026-10-11 (bus 003). One address can now cost at most
10 plans at $0.06, $0.60 a day, against the $1.50 daily cap; three busy addresses can pause planning for the day.
From 2026-10-28 (bus 013): 20 plans, $1.20 at most, about $0.20 at today's cost of a plan.

Also worth checking: whether the Nebius console can set a budget limit or alert of its own. That would be a second
guard behind the app's cap, for the period after the credit, when the card is billed.

## The gate

Three layers. Each one catches what the one before cannot.

### 1. `check.sh` (offline, free, under about 90 seconds)

The Stop hook runs this at the end of every turn once the file exists, so it must cost nothing and finish fast.
- Type check, lint, and the unit tests on recorded responses: argument validation and retry, the grounding check,
  the spend meter, the rate limiter, routing between models.
- Production build.
- Secret scan of tracked files and of the built client bundle. No key prefix and no `*_API_KEY` value may appear,
  and no `NEXT_PUBLIC_` variable may hold a key.
- Exit 3 when blocked on something only Sonu can fix (the hook then lets the turn end so I can ask).

### 2. The scripted demo run (`npm run demo:e2e`, live, about $0.03 to $0.05 a run)

Playwright against the deployed URL. Run before every show to Sonu and after every production deploy.
1. Open the page. "Try a sample family" (Rosa and Leo) is visible without scrolling at 375 px wide.
2. Click it. The first agent step appears within 3 seconds.
3. **The bridge card comes first**, within 25 seconds: one item both would love, from what Qloo suggested for the
   grandparent, with Qloo's affinity for each of them. If it does not pass the check against what Qloo suggests to
   anyone, its card says so, with the numbers.
4. Four moment cards follow, each with a source chip under "How this plan was made", within 60 seconds in total.
5. Three story questions in Spanish, each with an English gloss. None starts with "Do you remember".
6. Every title, artist, place and event named on a card appears in the run's evidence record (the grounding check).
7. Send feedback: "the music was a hit, the film was too long". The next plan has more music items and no
   full-length film.
8. No console errors, and the cost of the run is logged.
On the preview deploy only, the failure paths: a forced Qloo error, a forced Tavily error, the rate limit, and the
spend cap. Each must show its human message and never a blank screen.

### 3. The rubric (scored before every show to Sonu, logged in GATE.md with date and commit)

| # | Criterion | Check | How |
|---|---|---|---|
| 1 | Tech (Qloo) | The demo path makes live calls to at least four Qloo endpoints (search, tags, insights, compare) | evidence record |
| 2 | Tech (Qloo) | Every item on a card traces to a Qloo or Tavily result | grounding check |
| 3 | Tech (Qloo) | The bridge has Qloo affinity on both sides and is not just famous everywhere (it ranks lower in an unsignaled query). Since bus 015 a bridge that fails this is kept and its card says so | automated, plus a look |
| 4 | Tech (Nebius) | Nemotron Super makes at least 3 validated tool calls; a bad argument is sent back and retried | unit test |
| 5 | Tech (Nebius) | The trace shows the routing (Super for the loop, Ultra for the plan, Nano for the language step); the README explains it | the page, the README |
| 6 | Design | Timings from steps 2 to 4 above | Playwright |
| 7 | Design | 375 px width, keyboard use, AA contrast | Playwright and axe |
| 8 | Design | Every failure has a human message | preview failure paths |
| 9 | Design | Cards are text only, with no third-party images (RULES_NOTES flag 4) | a look |
| 10 | Impact | The landing text names the audience and the problem, with sourced figures | a look |
| 11 | Impact | A real caregiver has tried it; their words are recorded | by hand (open) |
| 12 | Idea | The demo opens on the bridge and its evidence | Playwright step 3 |
| 13 | Idea | Questions in the relative's language with a gloss; they invite, never test | Playwright step 5, plus a read |
| 14 | Idea | Feedback changes the next plan in the stated direction | Playwright step 7 |
| 15 | Security | No key in the repo, the bundle or the logs | check.sh |
| 16 | Security | The rate limit and the spend cap work | unit tests, plus one live check on preview |
| 17 | Security | No admin routes; no personal data stored on the server | review of the route list |
| 18 | Mission | Warm wording, no medical claims, a visible privacy note | a read |

Each criterion also gets a 1 to 5 score for each panel. I show Sonu a build only when every automated item passes,
and I report the manual items as they stand.

## On opening with a bridge item

Agreed, and built into steps 3 and 12. One caution: an item that both of two different audiences like tends to fall
back on what everyone likes. All four Nemotron models answered "What a Wonderful World" to a question like ours.
Check 3 guards against it, and the data probe will show whether Qloo's compare and insights produce a bridge that is
specific rather than merely popular.

**Since 2026-10-28 (Sonu, bus 015) the bridge comes only from what Qloo suggested for the grandparent.** Taken from
both sides, it came from the grandchild's suggestions in 4 of 10 invented families, current pop stars among them
(`submission/FAIR_PROOF.md`). Under the new rule the sample family got the same bridge in 5 runs out of 5 (real
gathering, empty store each time, `tests/bridge-stability.live.test.ts`). It does not pass check 3 on the
grandchild's side, and its card says so with the numbers: check 3 stands at "partly", as before.

## Order of work after the yes

1. Scaffold the app, `check.sh`, Upstash and the Vercel project; deploy a page with the spend cap in place before
   any model call is public.
2. Build the engine against recorded responses (recordings made from the Token Factory and Tavily calls, and Qloo's
   once the key is here).
3. Data probe on the day the Qloo key arrives; switch the engine to live Qloo.
4. By Oct 12: the plain version live (form, Qloo chain, Ultra plan, cards). That is the fallback.
