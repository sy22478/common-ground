# Gate log

The gate is defined in STACK_AND_GATE.md (approved by Sonu, 2026-10-05). It has three layers:

1. `check.sh`: offline, free.
2. The scripted demo run (`npm run demo:e2e`) against the live URL.
3. The 18-item rubric.

Every build shown to Sonu is logged here with its date and commit.

## 2026-10-05: spend cap shown working before any model call is public

The real app ran locally on production code, with real Token Factory calls, in-memory counters and tight caps. No
Qloo key yet. Nothing was deployed.

| # | Setup | Request | Result |
|---|---|---|---|
| a | `LIVE_PLANNING=on`, daily cap $0.061, plan cap $0.06, 1 plan an hour per address | `GET /api/health` | `{"livePlanning":true,"planningOpen":true}` |
| b | same | plan from address A | Real Nemotron calls, then a clear error (Qloo not connected); `done` reports **$0.004268** spent |
| c | same | `GET /api/health` | `{"livePlanning":true,"planningOpen":false}` (another $0.06 plan no longer fits under $0.061) |
| d | same | plan from address B | **HTTP 503** `{"error":"cap","message":"Live planning is paused for today to keep costs in check. Please come back tomorrow."}`, no model call |
| e | same | plan from address A again | **HTTP 429**, `Retry-After: 206`, "Please try again in an hour." |
| f | plan cap $0.0015 | plan | Stopped mid-run after **$0.000707**: "This plan reached its cost limit before it finished." The next call's worst case would have passed the cap, so it was never sent |
| g | `LIVE_PLANNING` unset (the default) | plan | **HTTP 503** `{"error":"paused","message":"Live planning is switched off right now."}`; the page still renders |

After (b), the plan was changed to stop before any model call when Qloo is not connected (it had spent $0.004 on
searches that could not succeed). A unit test covers that.

The same checks are repeated on the Vercel preview, with Upstash Redis as the shared counter, before live planning
is switched on there.

Supporting tests (offline, in `check.sh`):

- The spend guard stops at the plan, daily and total caps, and 20 concurrent plans cannot overshoot the daily cap.
- The model client refuses before any network request once a cap is reached. It refunds failed calls, and keeps the
  worst case for calls that time out.
- The route refuses before any model call when switched off, when the input is invalid, when the address is rate
  limited, or when the daily cap cannot fit another plan.
- Mutation check: removing the reservation from the model client, or the switch from the route, makes 4 tests fail.

## What the preview can prove before the Qloo key (bus 001, point 3)

Confirmed in the code at 84a878c: while `LIVE_PLANNING` was off, neither route touched Redis, and without a Qloo
key a plan stopped before any model call. A preview could not show that Upstash works or that the caps hold there.

Now:
- `/api/health` reads Redis whatever the switch says and reports `"counters":"redis"`.
- DEPLOY.md sets out the stages. Stages 1 to 3 run on the preview at no cost: Redis reachable, the shared rate limit
  returns 429, the total-cap pause.
- Stage 4 is a local live test against the real Upstash: concurrent plans cannot overshoot the cap, and a real
  Nemotron call settles its exact cost into Redis.
- Stage 5 waits for the Qloo key: a real plan through the deployed route, the daily-cap pause after real spend, and
  the Playwright scripted run. Production planning waits for stage 5 and Sonu's word.

## 2026-10-11: first build on real Qloo data, scored before showing Sonu

Build: preview `common-ground-9umot6h7k-sy22478.vercel.app` (planning off, saved plan served). The stage results are in
DEPLOY.md, the measurements in API_NOTES.md.

Layer 1, `check.sh`: pass. 80 tests, build, and the secret scans, which now plant a copy of every key and must catch
it. Mutation checks made today: the new search test fails on the old parser, and a planted Qloo key makes the scanner
exit 1.

Layer 2, the scripted run: **not run**. `npm run demo:e2e` does not exist yet, and its real plans would have passed
the $0.25 line. In its place: stages 1, 2, 3 and 5 on the preview by `vercel curl`, and one browser look at the paused
page on this machine (DEPLOY.md).

Layer 3, the rubric, as the build stands:

| # | Check | Now | Evidence |
|---|---|---|---|
| 1 | Live calls to four Qloo endpoints | **No: three** | Real plans called search, insights and compare. None called tags |
| 2 | Every card traces to a result | Yes | The grounding check passed on all four real plans; unit tests |
| 3 | The bridge has affinity on both sides and is not just famous | Partly | By a look: it is in the visitor's list and in the list for both. Whether it ranks lower in an unsignaled query was not checked. Not automated |
| 4 | Super makes 3 validated tool calls; a bad one is sent back | Yes | Unit test; seen live (two corrected calls in the saved plan's run) |
| 5 | The trace shows the routing; the README explains it | **No** | The page lists steps but not which model did them. No README yet |
| 6 | Timings (first step 3 s, bridge 25 s, all 60 s) | **No** | Plans took 26 to 48 s and the bridge arrives with the rest. Not timed in a browser |
| 7 | 375 px, keyboard, AA contrast | Partly | 375 px looked at, no sideways scroll. Keyboard and contrast not checked |
| 8 | Every failure has a human message | Partly | Off, total cap, daily cap, rate limit and plan cap seen on the preview. Forced Qloo and Tavily errors not tried |
| 9 | Cards are text only | Yes | A look |
| 10 | Landing text names the audience and problem, with sources | **No** | One line of lead text |
| 11 | A real caregiver has tried it | **No** | Still nobody |
| 12 | The demo opens on the bridge | Yes | A look at the saved plan |
| 13 | Questions in her language with a gloss; they invite | Yes | Read: three in Spanish with glosses, none a memory test. Gender agreement fixed today |
| 14 | Feedback changes the next plan | **Not checked** | No real plan with a history has been run |
| 15 | No key in the repo, the bundle or the logs | Yes | `check.sh`; the code logs an error's name and status only |
| 16 | The rate limit and the spend cap work | Yes | Unit tests; stages 2, 3 and 5 on the preview |
| 17 | No admin routes; no personal data stored | Yes | The build lists two routes: `/api/health` and `/api/plan` |
| 18 | Warm wording, no medical claims, a privacy note | Partly | A read. The saved plan's event card is a tequila and tacos festival: a poor fit for a grandmother and her grandson |

Scores, 1 to 5, my estimate for this build as a judge would meet it:

| Criterion | Qloo | Nebius | Why |
|---|---|---|---|
| Technological Implementation | 3 | 3 | Three Qloo endpoints live with year windows and shared traits, a validated tool loop across three Nemotron models, cost metering. Tags, signal weights and the after-visit loop are not shown working |
| Design | 2 | 2 | One fixed sample family, no way to enter your own, a 26 to 48 s wait with no early bridge |
| Potential Impact | 2 | 2 | No sourced case on the page, no caregiver's words |
| Quality of the Idea | 4 | 3 | The bridge is real and specific to the family. The Nemotron use is sound but ordinary |

It meets the Oct 12 bar (a plain working version) once it is on the public URL. It is not yet a build to submit.

## 2026-10-11, later: the public build, and the first scripted run (bus 003)

Layer 1, `check.sh`: pass, 94 tests.

Layer 2, the scripted run, now exists (`npm run demo:e2e`, `e2e/demo.spec.ts`) and was run in a real browser against a
preview with planning on: **6 of 8 steps pass.** Step 3 fails (the bridge arrived at 26.5 s, not within 25 s) and step
7 fails (feedback did not add music or remove the film). The four failure paths pass (`e2e/failures.spec.ts`). The
figures are in DEPLOY.md.

Layer 3, what changed in the rubric since the table above:

| # | Check | Was | Now | Evidence |
|---|---|---|---|---|
| 3 | The bridge is specific, with affinity on both sides | Partly | Partly, and less sure | A later real plan (run 6 in API_NOTES.md) chose an artist from the grandmother's side only. The bridge depends on which type the gathering model asks for |
| 6 | Timings | No | No, now measured | First step 0.8 s (pass), all cards 26.4 s (pass), bridge 26.5 s (fail by 1.5 s: it arrives with the rest) |
| 7 | 375 px, keyboard, AA contrast | Partly | Partly | At 375 by 667 the plan button is below the fold. Keyboard and contrast still not checked |
| 8 | Every failure has a human message | Partly | Yes | Rate limit, plan cap, paused, forced Qloo error and forced Tavily error, each seen in a browser |
| 14 | Feedback changes the next plan | Not checked | **No** | Checked by the scripted run: it does not, yet |

Unchanged: 1 (three Qloo endpoints, not four), 5, 10, 11 are still no. So 9 yes, 3 partly, 6 no. The scores stand:
Technology 3 and 3, Design 2 and 2, Impact 2 and 2, Idea 4 and 3.

The public page (planning off, saved plan) is the Oct 12 fallback, and it is live.

## 2026-10-11, last: the scripted run passes (commit b61ebe6)

Layer 1, `check.sh`: pass, 136 tests.

Layer 2, the scripted run: **8 of 8 steps in the last three runs**, two of them on this commit, each on a preview with
planning on. The four runs before them each led to a change (DEPLOY.md).

Layer 3, what changed in the rubric:

| # | Check | Was | Now | Evidence |
|---|---|---|---|---|
| 3 | The bridge has Qloo affinity on both sides and is not just famous | Partly | Partly, the first half now by construction | The bridge is the candidate whose lower Qloo affinity is highest, and the card shows both numbers (for the sample family, in invented figures of the same shape, 0.83 and 0.93). Whether it ranks lower in an unsignaled query is still not checked |
| 6 | Timings | No | Yes | First step 0.2 to 0.8 s, bridge 6.4 to 7.4 s, all cards 9.5 to 11.0 s (sample family, Qloo answers cached). With nothing cached the bridge takes 17 to 21 s |
| 14 | Feedback changes the next plan | No | Yes | Scripted run step 7, the last five runs; `tests/feedback.live.test.ts` |

So 11 yes, 3 partly (3, 7, 18), 4 no (1: three Qloo endpoints, not four; 5: the page does not say which model did
what, and there is no README; 10: no sourced case on the page; 11: no caregiver yet).

Scores, my estimate: Technology 4 and 4 (was 3 and 3: the bridge by affinity on both sides is a real use of Qloo, and
the routing between three Nemotron models now carries the speed and the cost). Design 2 and 2, Impact 2 and 2,
unchanged: still one fixed sample family. Idea 4 and 3, unchanged.

## 2026-10-11, the form (commit 7fbeba0)

`check.sh`: pass, 145 tests. The scripted run: 8 of 8 on this commit. The form: 5 of 5 browser checks (DEPLOY.md).
All four items of the build order Sonu approved are done.

What changed in the rubric: nothing by count (11 yes, 3 partly, 4 no). Item 5's wording is now out of date: the
language step is Nemotron 3 Ultra's, not Nano's, after a side-by-side reading (API_NOTES.md). Nano reads the visit
feedback. The page still does not say which model did what.

Scores, my estimate: Technology 4 and 4. Design 3 and 3 (was 2 and 2): a visitor can now plan for their own family,
the bridge arrives in under 10 s, and feedback changes the next plan. Impact 2 and 2: still no sourced case on the
page and no caregiver's words. Idea 4 and 3.

## 2026-10-11, bus 004: the note, the privacy note, production redeployed (commit 8e717c0)

Layer 1, `check.sh`: pass, 157 tests. Twelve are new: the note is refused with contact details on the page and on
the server; what each model reads; every parameter a request to Qloo or Tavily carries. Three of them were shown to
fail when the code was broken on purpose (the gathering model given the whole family, the city check removed, the
note check removed).

Layer 2: the scripted run, **8 of 8** on a preview of this commit, with the same bridge as before. The form, 6 of 6.
The public page, read only, 3 of 3 on production after the deploy (DEPLOY.md). The four failure paths were not rerun:
they were last run before the engine was rebuilt.

Layer 3, the rubric: unchanged by count, 11 yes, 3 partly, 4 no. One thing is firmer than the rubric asks: what the
family types is now sent on by rule. The model that writes the searches cannot pass the language, grandmother or
grandfather, the birth year or the note to Qloo or Tavily, because it is never given them.

Scores, my estimate: unchanged. Technology 4 and 4, Design 3 and 3, Impact 2 and 2, Idea 4 and 3.

Six real plans were read in full to choose the saved plan. What they showed against the rubric's item on grounding
is in PROGRESS.md ("Found on real plans"): the cards are grounded, but the planner's sentences still say things
about her life that nobody told it, and at least one question in 18 did.

## 2026-10-11, bus 005: the plan findings by rule, then four rubric gaps (commit af79014)

Layer 1, `check.sh`: pass, 225 tests (68 new). Each rule was broken on purpose, 23 in all, and every time at least
one test failed. The source check for the landing text failed 3 of 3 with a figure changed on purpose.

Layer 2, on previews with planning on for that one deployment only:

| Run | Build | Result |
|---|---|---|
| The four failure paths | The first version of the rules, 19:35 UTC | 4 of 4: rate limit, paused, Qloo down ($0.0008, 2.4 s), web search down ($0.0093, 11.5 s) |
| The scripted run | The same | 8 of 8: first step 0.8 s, bridge 7.4 s, plan 9.8 s; music cards 1 to 4, no film; $0.0176 |
| The scripted run | `78b683d`, 20:03 UTC | 8 of 8 on the second try. The first try failed one check, and the fault was the check's: it looked for a step that begins "From the last visit", and each step now begins with who did it |
| Three failure paths | `78b683d` | 3 of 3: paused, Qloo down, web search down ($0.0083, 7.8 s) |
| The scripted run | `af79014`, the final commit, 20:12 UTC | 8 of 8: first step 0.8 s, bridge 6.4 s, plan 8.6 s; the second plan in 16.7 s; music cards 1 to 3, no film; four Qloo endpoints called; every step says who did it; the plan button on the first screen at 375 by 667; $0.0230 |
| The rate-limit path | `af79014`, 20:16 UTC | Pass, $0. It shares its hourly counter with every other run from this machine, which had made 15 requests that hour, so the preview's hourly limit was set to 17: requests 16 and 17 were allowed and the 18th was refused in plain words |

The form: 6 of 6. The public-page check: 3 of 3 against this build run on this machine. Against production it is 1
of 3, as it should be until the redeploy: production still serves the build and the saved plan of bus 004.

One run stopped at the second plan with "You have planned a lot of visits. Please try again tomorrow.": this
machine's test runs had used up the day's 60 plans for one address, the limit set on test previews. The guard did
its job. The last two previews were given a limit of 200 for the day.

Layer 3, the rubric, scored again:

| # | Check | Was | Now | Evidence |
|---|---|---|---|---|
| 1 | Live calls to four Qloo endpoints | No: three | **Yes** | search, tags, insights and compare in every plan for the sample family; the scripted run fails without them. The tag search has a job: a dish they named becomes a place near the grandparent |
| 2 | Every card traces to a result | Yes | Yes, and firmer | What a card is now follows from its evidence, not from its label; a web result must name the city |
| 3 | The bridge has affinity on both sides and is not just famous | Partly | Partly | Unchanged. Whether it ranks lower in an unsignaled query is still not checked |
| 4 | Super makes 3 validated tool calls; a bad one is sent back | Yes | Yes | |
| 5 | The trace shows the routing; the README explains it | No | **Yes** | Every step on the page says Nano, Super, Ultra or Rule, with a line naming the models and Nebius Token Factory; README.md has the table. The scripted run checks both plans |
| 6 | Timings | Yes | Yes | First step 0.2 to 0.8 s, bridge 6.4 to 11.4 s, plan 8.6 to 14.1 s (4 runs in a browser) |
| 7 | 375 px, keyboard, AA contrast | Partly | Partly | The plan button is now on the first screen at 375 by 667. Keyboard and contrast are still not checked |
| 8 | Every failure has a human message | Yes | Yes | Rerun on the rebuilt engine |
| 9 | Cards are text only | Yes | Yes | |
| 10 | Landing text names the audience and the problem, with sources | No | **Yes** | The lead says who it is for; "Why this exists" gives three figures, each in its source's own sentence with a link, read on 2026-10-11 (`lib/sources.ts`) |
| 11 | A real caregiver has tried it | No | No | Still nobody |
| 12 | The demo opens on the bridge | Yes | Yes | |
| 13 | Questions in her language with a gloss; they invite | Yes | Yes, with a known limit | Rules now refuse a question that assumes a fact, and a translation with a slip a rule can see. No native speaker has read them: the page says so, and LANGUAGE_REVIEW.md holds the sentences |
| 14 | Feedback changes the next plan | Yes | Yes | Music 1 to 4, 1 to 3, 1 to 3, 1 to 3; no film |
| 15 | No key in the repo, the bundle or the logs | Yes | Yes | |
| 16 | The rate limit and the spend cap work | Yes | Yes | Both seen again today, the daily limit by accident |
| 17 | No admin routes; no personal data stored | Yes | Yes | |
| 18 | Warm wording, no medical claims, a privacy note | Partly | **Yes** | A card no longer says what either of them loves or lived unless the family said so; the page says it is not a medical tool; the privacy note is field by field. An event from the web can still be a poor fit, and its card says nobody has checked it |

So **15 yes, 2 partly (3, 7), 1 no (11)**. It was 11 yes, 3 partly, 4 no.

Scores, my estimate: Technology 4 and 4 (the fourth endpoint is used for something real, and the routing can be
read off the page; a 5 would want the bridge shown to be more than famous). Design 3 and 3. Impact 3 and 3 (was 2
and 2: the page now makes its case with sources; a caregiver's words would raise it). Idea 4 and 3.

What the build still gets wrong, seen today and not fixed (PROGRESS.md has the list): a plan for a family typed
into the form once had no card from Qloo beyond the bridge, only their own favorites; the planner sometimes writes
"he" or "she" for the visitor, whom it knows nothing about; after "more music" there is still no upper limit.

## 2026-10-11, bus 006: production redeployed, then the four remaining gaps (commit 3481985)

**Production.** Redeployed at 20:42 UTC on Sonu's word, planning off: deployment `heky0cciv`
(`dpl_AU4UjjTBS61vZqfkisyQwrupbVXb`), built from commit `bde1964`, with the saved plan recorded in bus 005. Checked
on the public URL: health, the refused plan request, the page at 375 px, the form paused, the saved plan loading and
passing the rules, the three figures with their links, private paths, headers (DEPLOY.md has each result). The four
gaps below came after it and are not in production.

Layer 1, `check.sh`: pass, 246 tests (21 new). Thirteen more rules broken on purpose, each caught by a test. The
keyboard and contrast checks failed 5 of 9 with the ring, the grey and the link colour broken on purpose; the source
check reported all three figures missing when each was changed.

Layer 2, on previews with their settings on one deployment each, all removed afterwards:

| Run | Build | Result |
|---|---|---|
| The scripted run | `6265710`, 21:23 UTC | 8 of 8, with the checks for rubric items 1, 3 and 5: first step 0.8 s, bridge 11.4 s, plan 13.7 s; music cards 1 to 4, no film; $0.0194 |
| Rate limit, paused, Qloo down | `6265710` | 3 of 3 |
| Web search down | `6265710` | Did not run: 429. The preview had the usual six plans an hour, and this machine had made ten that hour. My setting, not a fault in the app |
| Web search down | `3481985`, the final commit, with 60 an hour | Pass. The plan arrives without events and says why. $0.0104, 11.2 s |
| The scripted run | `3481985`, 21:27 UTC | 8 of 8: first step 0.8 s, bridge 9.9 s, plan 12.5 s; the second plan in 22.7 s, its bridge at 20.0 s; music cards 1 to 3, no film; $0.0251 |

`npm run demo:e2e:a11y`: 9 of 9. The form: 6 of 6. The public-page check: 4 of 4 on production just after the
redeploy, and 4 of 4 against the final build on this machine. Against production now it is 3 of 4, because the page
there still shows the 2018 figure that gap d replaced.

Layer 3, the rubric, scored again:

| # | Check | Was | Now | Evidence |
|---|---|---|---|---|
| 1 | Live calls to four Qloo endpoints | Yes | Yes | The scripted run checks it |
| 2 | Every card traces to a result | Yes | Yes, and fuller | A plan now holds at least two of Qloo's own finds beyond the bridge, by rule. Five real plans for a family typed into the form held three or four; the plan that prompted this held none |
| 3 | The bridge has affinity on both sides and is not just famous | Partly | **Yes, by its own test, with a limit I state** | Measured for the first time. The bridge is held against the 50 that Qloo suggests to anyone: it is not one of them, and each taste likes it more than the middle of them. The code prefers such a candidate, the card shows the comparison, the scripted run checks it. The limit: Qloo's affinity runs high for famous things with any taste. Scored directly, two of those 50 beat the sample family's bridge on its lower side. The bridge is still chosen for taste, because it is chosen from what Qloo suggested for each of them and not from everything |
| 4 | Super makes 3 validated tool calls; a bad one is sent back | Yes | Yes | A list sent as text is now read as the list (seen live: three refusals running) |
| 5 | The trace shows the routing; the README explains it | Yes | Yes | |
| 6 | Timings | Yes | Yes | First step 0.8 s, bridge 9.9 and 11.4 s, plan 12.5 and 13.7 s. The comparison in item 3 costs the bridge about three seconds when nothing is cached |
| 7 | 375 px, keyboard, AA contrast | Partly | **Yes** | axe-core 4.13: no WCAG 2.1 A or AA fault on six views, light and dark. Tab reaches all 22 controls in order, each with a ring, wholly on the screen. The whole path works from the keyboard. Contrast of every text pair is 4.77 to 1 or better. Not checked: a screen reader, a browser other than Chromium, zoom to 200% |
| 8 | Every failure has a human message | Yes | Yes | All four paths rerun on this bus's build |
| 9 | Cards are text only | Yes | Yes | |
| 10 | Landing text names the audience and the problem, with sources | Yes | Yes | The figure on distance is now from AARP's 2026 study, read today. The 2018 line it replaces said more than the newer study supports |
| 11 | A real caregiver has tried it | No | No | Still nobody |
| 12 to 18 | | Yes | Yes | Unchanged |

So **17 yes, 0 partly, 1 no (11)**. It was 15 yes, 2 partly, 1 no.

Scores, my estimate: Technology 4 and 4. Design 3 and 3: the page is now checked for keyboard and contrast and a
visitor's own family gets a fuller plan, but nobody outside this session has used it. Impact 3 and 3. Idea 4 and 3.
The two things that would move these are both Sonu's to arrange: a caregiver, and a native reader.

## 2026-10-11, bus 007: the second redeploy, and rubric item 3 scored again (commit 73baa96)

**Production.** Redeployed at 22:08 UTC on Sonu's word, planning off: deployment `aukiltl2p`
(`dpl_3DLFqLJxSx5iUitEU7j2EqKZP8Zg`), built from commit `73baa96` with the recording made by that build. Before it:
`check_sources.py` found every quote, `check.sh` passed (246 tests), no planning variable in any scope, 52 files in
the dry run and none of them private. Checked on the public URL (DEPLOY.md has each result): health, the refused plan
request, the public-page run 4 of 4, keyboard and contrast 9 of 9 against production itself, the 2026 AARP line with
its question and its link, link contrast 6.38 to 1 in the dark colours, the "For scale" line on the saved plan's
bridge card, 16 private paths, the headers. `heky0cciv` is kept for a rollback.

**Rubric item 3, on Sonu's decision: partly.** In bus 006 I scored it yes "by its own test, with a limit I state".
The test is real and it passes: the bridge is not one of the 50 that Qloo suggests to anyone, and each taste likes
it more than the middle of them. The limit is why it is partly and not yes: Qloo's affinity runs high for famous
things with any taste. Scored directly, two of those 50 beat the sample family's bridge on its lower side. So the
test shows the bridge is not simply the most popular thing on offer, and it does not show that the grandparent's
taste, more than the film's fame, is what makes it fit. What would make it yes: evidence other than a number, for
example what the bridge shares with her favorites in Qloo's compare. Not built.

So **16 yes, 1 partly (3), 1 no (11)**. Every other row stands as scored in bus 006. Scores, my estimate, unchanged:
Technology 4 and 4, Design 3 and 3, Impact 3 and 3, Idea 4 and 3.

No model call was made for this section: the redeploy and its checks cost nothing.

**Later in bus 007 (2026-10-12): the submission drafts, the video take, one rule.**

- Layer 1, `check.sh`: pass, 251 tests (5 new, for the rule that lets no long dash reach the page). The plan test
  fails when the rule is taken out.
- Layer 2: the video take (`scripts/record_video.mjs`, 22:26 UTC) made the scripted run's two plans on a test preview
  of the app code that is in production, and its checks passed: the first plan the work of Super, Ultra and a rule;
  after "the music was a hit, the film was too long", Nano read the visit and the second plan had more music (1
  item, then 3), no film and nothing repeated; no console error. $0.0203. It is not the scripted run: it checks
  fewer things, and the run of 8 steps was not repeated, since no app code had changed.
- Layer 3, the rubric: unchanged at 16 yes, 1 partly, 1 no. Two things seen in the take belong with item 2 (every
  card traces to a result): two cards of the second plan carry the same plain sentence, and the trace shows a wrong
  match from a Qloo search of the family's own phrase (PROGRESS.md, "Next steps").
- The drafts are in `submission/`. Against the rubric they change nothing: they describe the build, limits and all.

## 2026-10-13, bus 008: the two faults seen in the video take (commit 0dc1d40)

Both causes were found before anything was changed; API_NOTES.md, "Bus 008", has the evidence for each.

Layer 1, `check.sh`: pass, 277 tests (26 new). With each fix taken out in turn, its tests fail: six for the repeated
sentence, five for the search result.

Layer 2, on one test preview with its settings on that deployment alone, removed afterwards:

| Run | Build | Result |
|---|---|---|
| The scripted run | `0dc1d40`, 04:02 UTC | 8 of 8, with two checks added on both plans: no two cards say the same sentence, and every search took something of the name it asked for. First step 0.2 s, bridge 10.4 s, plan 13.0 s; the second plan in 23.5 s. Music cards 2 to 4, no film. $0.0228 |
| The take's second request, sent again | `0dc1d40` | A plan in 12.5 s, six searches, each for a real favorite or what had landed. $0.0087 |
| An invented family with a favorite Qloo cannot have | `0dc1d40` | Qloo gave five near-misses; none was taken; the model did not search again; a plan in 18.6 s. $0.0093 |

Also, at no cost: the 21 real answers of Qloo's search kept on this machine, through the search tool
(`tests/search-names.live.test.ts`): 16 favorites taken, 3 that are not entities refused, 2 with no answer. And every
recorded plan still passes the wording rules (`tests/recorded.live.test.ts`).

Not rerun: the four failure paths, keyboard and contrast, the form. Nothing they cover was changed.

Layer 3, the rubric: 16 yes, 1 partly, 1 no, as before. Item 2 (every card traces to a result) is the one these
faults touched, and it is surer now: a search result of another name can no longer become a signal or a card.

This build is not in production. Production is untouched, as bus 008 asks.

## 2026-10-13, bus 009: the switch of Oct 27 prepared, and the gate run on one build (commit 4d4849f)

Three things were built, each with a test that fails without it, and then the whole gate was run on the commit.

| What | The test that fails without it |
|---|---|
| `/api/health` reads the counters at most once a minute (`lib/health.ts`) | With the cache taken out, 5 of the 9 health tests fail: a second request reads again, the header gives no time to keep, a cap shows at once, a failed read is not asked again |
| The public check holds a page to planning on or off (`PLANNING=`) | The check as it was fails 2 of 4 against a page with planning on. The new one passes there and on production as it is, and fails 2 of 4 when held to the other |
| A build names its commit; a gate runs on one build at its own address (`npm run gate:build`); the public check takes `BUILD=` | With the commit taken out of `/api/health` its test fails. The gate fails on a build of another commit (3 failed on an old preview), and the public check held to this commit fails on production, which names none |

**The gate on commit `4d4849f`**, on five test previews with planning on in their own settings, all removed
(DEPLOY.md, "Bus 009", has each run):

| Layer | Result |
|---|---|
| `bash check.sh` | Pass, 284 tests |
| The four failure paths | 4 of 4: rate limit $0, paused $0, Qloo down $0.0008 in 2.5 s, web search down $0.0085 in 12.3 s |
| The gate on one build (`npm run gate:build`, `GATE_PLAN=1`) | 6 of 6: the build names the commit; planning on and open, counters in Redis; a bad request refused; the recording as in this folder; 18 private paths 404; one plan in 14.8 s for $0.0109 |
| The public check, `PREVIEW=1 PLANNING=on BUILD=<commit>` | 4 of 4 |
| The scripted run | 8 of 8: first step 0.2 s, bridge 13.4 s, plan 16.4 s; second plan 14.8 s; music 1 to 3, no film; four Qloo endpoints; $0.0240 |
| Keyboard and contrast | 9 of 9 on this machine's build |
| The form | Not rerun: nothing it covers changed |

Cost: $0.0443 for five plans and one forced failure.

**Rubric: 16 yes, 1 partly, 1 no,** unchanged: nothing a judge sees has changed. What changed is how the build is
checked and switched.

What this gate does not show. The two steps of the switch that touch production, a production build kept off the
public address and its promotion, were not run: bus 009 leaves production untouched, and they cannot be tried on a
preview. And no browser reaches a production build at its own address, so on the day the browser checks run on a
preview of the same commit and on the public address after promoting (DEPLOY.md, "Switching planning on").

This build is not in production. Production is untouched, as bus 009 asks.

## Build log

| Date | Commit | check.sh | Scripted run | Rubric | Notes |
|---|---|---|---|---|---|
| 2026-10-05 | 84a878c | pass (36 tests, build, both secret scans) | not yet (no deploy) | not scored yet | Engine on real Nemotron with synthetic Qloo: $0.0167 and 20 s per plan, grounded |
| 2026-10-05 | ea6929d | pass (46 tests, build, both secret scans) | not yet (no deploy) | not scored yet | Privacy, variable list, health counters, pause messages, saved-plan fallback |
| 2026-10-05 | c5a2d5a | pass (46 tests, build, secret scans, .vercelignore check) | not yet (no deploy) | not scored yet | New limits (10 a day, $0.04); .vercelignore keeps .env out of CLI deploys |
| 2026-10-06 | bb703dd | pass | production page live, planning off: health, 503 and 404s checked by curl | not scored yet | First deploy: public page, no env vars, no `.env` uploaded (checked in Vercel's file list) |
| 2026-10-06 | e90aebd | pass (58 tests) | not yet | not scored yet | Budget schedule and auto-off; mutation check on the auto-off |
| 2026-10-06 | (this commit) | pass (58 tests) | stage 4 passed on the real Upstash (4 of 4) | not scored yet | Redis connected; tests isolated from the shared database |
| 2026-10-11 | 6ac0ca3 and the commit after it | pass (80 tests) | not run; stages 1, 2, 3 and 5 passed on the preview | scored above: 8 yes, 4 partly, 6 no or not checked | First real Qloo data: real plans at $0.021 to $0.031 in 26 to 48 s; compare, events and gender fixed |
| 2026-10-11 | 339f605 (in production), ecdad3e and the commit after it | pass (94 tests) | 6 of 8 steps; 4 of 4 failure paths | 9 yes, 3 partly, 6 no | Public page live with planning off and the saved plan; plan cap $0.06; scripted run written and run |
| 2026-10-11 | b61ebe6 | pass (136 tests) | 8 of 8 steps, the last three runs | 11 yes, 3 partly, 4 no | Feedback step, gathering in 4 replies, bridge by Qloo affinity: a plan in 10 s for under $0.01 |
| 2026-10-11 | 7fbeba0 and the commit after it | pass (145 tests) | 8 of 8 steps; form 5 of 5 | 11 yes, 3 partly, 4 no | A form for the visitor's own family; the questions written by Ultra with the respectful form of address |
| 2026-10-11 | 8e717c0 (in production) | pass (157 tests) | 8 of 8 steps; form 6 of 6; public page 3 of 3 | 11 yes, 3 partly, 4 no | The note refuses contact details; the privacy note says what goes where and the code is narrowed to match; production redeployed with planning off and a new saved plan |
| 2026-10-11 | af79014 | pass (225 tests) | 8 of 8 steps on the final commit; failure paths 4 of 4 on the first version of the rules, 3 of 3 again on `78b683d` and the rate limit on `af79014`; form 6 of 6; public page 3 of 3 on this machine's build | 15 yes, 2 partly, 1 no | Four plan findings checked by rule; README; who did each step; Qloo's tag search for an outing; landing text with three sourced figures. Production not redeployed: that waits on Sonu |
| 2026-10-11 | bde1964 (in production); 3481985 (the gaps, not yet deployed) | pass (246 tests) | 8 of 8 steps on the final commit; failure paths 4 of 4; keyboard and contrast 9 of 9; form 6 of 6; public page 4 of 4 after the redeploy | 17 yes, 0 partly, 1 no | Production redeployed with planning off. Then: Qloo's finds by rule, keyboard and contrast, the bridge held against fame, the 2026 figure on distance |
| 2026-10-11 | 73baa96 (in production) | pass (246 tests) | Not rerun: no code changed since the 8 of 8 on `3481985`. On production itself: public page 4 of 4, keyboard and contrast 9 of 9 | 16 yes, 1 partly, 1 no | Production redeployed with the final build and its recording, planning off. Rubric item 3 scored partly on Sonu's decision, with the limit stated |
| 2026-10-12 | 08d7e5d (not in production; the app code in production is 73baa96) | pass (251 tests) | The video take: two live plans, its 7 checks passed. The 8-step run not repeated | 16 yes, 1 partly, 1 no | Submission drafts for both hackathons in `submission/`; the video recorded (2:42, captions, no voice); a rule against long dashes in what the planner writes; README says where Token Factory helped |
| 2026-10-13 | 0dc1d40 (not in production) | pass (277 tests) | 8 of 8 steps, with two checks added for the faults of the take; two more live plans on the same preview | 16 yes, 1 partly, 1 no | No two cards of a plan say the same sentence; a search result is a favorite only if it is called what was asked for |
| 2026-10-13 | 4d4849f (not in production) | pass (284 tests) | 8 of 8 steps; failure paths 4 of 4; the gate on one build 6 of 6 with a real plan; public page 4 of 4 with planning on; keyboard and contrast 9 of 9 | 16 yes, 1 partly, 1 no | For the switch of Oct 27: the health route reads its counters once a minute; the public check holds a page to planning on or off and to a commit; a build names its commit and a gate runs on the one build that is promoted |
