# Deploying

## Environment variables (the complete list)

Names only. Never paste a value into chat, a commit or an issue.

`.env.example` lists only the three API keys. This session's permission rule for `.env.*` blocks reading or writing
that file, so this table is the complete list. Every variable is read on the server only; none uses a `NEXT_PUBLIC_`
prefix.

| Name | Secret | Who sets it | Where the value comes from | Needed |
|---|---|---|---|---|
| `NEBIUS_API_KEY` | yes | Sonu | Token Factory console, API keys. A separate key for Vercel lets it be revoked on its own. | For planning |
| `QLOO_API_KEY` | yes | Sonu | The Qloo hackathon key email | For planning: without it a plan stops before any model call |
| `TAVILY_API_KEY` | yes | Sonu | app.tavily.com, API keys | Optional: without it plans skip local events |
| `HASH_SECRET` | yes | Sonu | Any long random string, made in your own terminal (`openssl rand -hex 32`), not in this session, so it never lands in the transcript | Yes in production: without it planning answers 503 |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | the token is | The Upstash integration (set 2026-10-06 for `common-ground-redis`, all three environments) | Vercel Marketplace, Upstash for Redis | Yes in production: without them planning answers 503 |
| `KV_REST_API_READ_ONLY_TOKEN`, `KV_URL`, `REDIS_URL` | yes | The Upstash integration | Same | Not read by the app; the secret scan checks them |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | the token is | The Upstash integration, automatically | Same. Depending on when the database is made, the integration sets this pair or the `KV_` pair; the app reads either. | As above |
| `LIVE_PLANNING` | no | Sonu, or Claude through the CLI | The word `on`. Anything else, or unset, means no model call is ever made. From 2026-12-15 20:00 UTC planning is off whatever this says. | Leave unset until the gate says so |
| `PLAN_CAP_USD` | no | nobody (default 0.06) | Sonu, 2026-10-11 (bus 003). It was 0.04 from 2026-10-05, which left a real plan no room for one correction | Optional override |
| `DAILY_CAP_USD` | no | nobody (default: the schedule, $1.50 or $3.00 during judging) | `BUDGET_SCHEDULE`, approved 2026-10-06 | Optional override; set only to change the schedule |
| `TOTAL_CAP_USD` | no | nobody (default: the schedule, $8, then $15 from Qloo judging, $25 from Nebius judging) | `BUDGET_SCHEDULE`, approved 2026-10-06 | Optional override; set only to change the schedule |
| `IP_PLANS_PER_HOUR` | no | Sonu through the CLI: `30`, Production only, since 2026-10-29 01:40 UTC (bus 017); `20` from 2026-10-28 (bus 013) | Sonu, 2026-10-28: "no limits per hour". 30, the daily figure, so it never binds first; 0 would allow none. The default, 6, was approved 2026-10-05 | Set for Production. Builds made from 2026-10-29 01:41 UTC have 30; from 2026-10-28 08:46 UTC, 20; before, 6 |
| `IP_PLANS_PER_DAY` | no | Sonu through the CLI: `30`, Production only, since 2026-10-29 01:33 UTC (bus 017); `20` from 2026-10-28 (bus 013) | Sonu, 2026-10-28 (bus 017): "Let's keep working on Qloo by increasing the limit to 30 from 20." Before that (bus 013): "Let's change it to 20 per day". The default, 10, was approved later on 2026-10-05 (it was 20 before) | Set for Production. Builds made from 2026-10-29 01:41 UTC have 30; from 2026-10-28 08:46 UTC, 20; before, 10 |
| `TAVILY_PER_PLAN` | no | nobody (default 2) | Approved 2026-10-05 | Optional override |
| `TAVILY_PER_DAY` | no | nobody (default 30) | Approved 2026-10-05 | Optional override |
| `QLOO_CALLS_PER_DAY` | no | nobody (default 300) | The key allows 10,000 calls a month (read from its response headers, 2026-10-11). Was 3,000 while the quota was unknown | Optional override |
| `FORCE_ERRORS` | no | Claude, on a test preview only | `qloo`, `tavily` or both: that service fails on every call, without being called; `allowance` refuses every Qloo call as this site's own daily allowance does. For the scripted run's failure paths. Production ignores it (`VERCEL_ENV=production`) | Never in Production |
| `NODE_ENV` | no | Vercel | Set by the platform | Do not set |

In the Vercel dashboard, mark the secret ones as Sensitive, so their values cannot be read back after saving. Set
each for both Preview and Production unless a step says otherwise. For local live tests, `npx vercel env pull
.env.local` copies them into an ignored file. The secret scan (`scripts/scan_secrets.py`) checks the repo and the
build output against the values in both `.env` and `.env.local`.

## Current deployment (2026-10-11 UTC)

**As of bus 007 (2026-10-11 22:08 UTC): production runs the final build of bus 006, redeployed on Sonu's word, with
planning off.**

- Deployment `aukiltl2p` (`dpl_3DLFqLJxSx5iUitEU7j2EqKZP8Zg`), created 2026-10-11 22:07:47 UTC, built from commit
  `73baa96` with a clean tree, plus the recording made by that build
  (`.qloo/saved-plan-2026-10-11T2128b.json`, copied to `public/saved-plan.json`, which git ignores).
- The build before it, `heky0cciv` (`dpl_AU4UjjTBS61vZqfkisyQwrupbVXb`, commit `bde1964`), is kept for a rollback, as
  are `oty4f9lvv`, `pokhqrs49` and `m99wf5qqn`.
- Before the deploy: `uv run scripts/check_sources.py` found every quote on its page; `bash check.sh` passed (246
  tests); `vercel env ls` showed no `LIVE_PLANNING`, cap, limit or `FORCE_ERRORS` variable in any scope; a dry run
  listed 52 files, the saved plan among them, and nothing from `.env*`, `.qloo`, `scripts`, `tests`, `e2e` or
  `.claude`. No variable was set.
- Checked on the public URL, with no login, at 22:09 to 22:11 UTC:

  | Check | Result |
  |---|---|
  | `/api/health` with a fresh address | `{"livePlanning":false,"planningOpen":false,"pausedFor":"off","counters":"redis"}` |
  | `POST /api/plan` | 503, "Live planning is switched off right now." |
  | `npm run demo:e2e:public` | 4 of 4: planning off; the saved plan identical to the one in this folder; the saved plan as served passes the wording rules; the page at 375 px with the paused notice in view, the form paused, the three figures each with its link, no console error, no request to another server |
  | `e2e/a11y.spec.ts` against the public URL | 9 of 9 |
  | The 2026 AARP line | Shows the question as asked, the line "500 miles or more 29%", and a link to the annotated questionnaire (PDF). The 2018 line is gone |
  | Link contrast, measured on the page | 6.38 to 1 in the dark colours, 4.77 to 1 in the light (AA asks 4.5) |
  | The saved plan | The bridge card shows Qloo's affinity for each of them and the "For scale" line; 19 of 19 steps say who did them; the moments are a film, an artist, a place and an activity |
  | Private paths (16, among them `/.env`, `/PROGRESS.md`, `/lib/sources.json`, `/scripts/_env.py`, `/tests/helpers.ts`) | All 404 |
  | Headers | `x-frame-options: DENY`, `x-content-type-options: nosniff`, `referrer-policy`, HSTS |
  | `vercel inspect` on the public URL | `dpl_3DLFqLJxSx5iUitEU7j2EqKZP8Zg`, target production |
  | Long dashes (bus 007b) | None in the served HTML or in the saved plan (counted on 2026-10-12, 02:16 UTC) |

- Checked again on 2026-10-12 at 02:17 UTC: health as above, `POST /api/plan` 503, `vercel inspect` unchanged, the
  16 private paths 404, the four headers present.
- **Everything up to `73baa96` is in production.**

To redeploy, on Sonu's word: `uv run scripts/check_sources.py`, `bash check.sh`, `vercel deploy --dry --prod --yes`
and read the file list, `vercel deploy --prod --yes` from this folder, then
`DEMO_URL=https://common-ground-beryl.vercel.app npm run demo:e2e:public` (4 of 4 expected) and the checks in the
table above. Planning stays off: no variable is to be set. `public/saved-plan.json` already holds the recording
that is in production.

The rest of this section describes production as it was deployed in bus 004; where it names `oty4f9lvv` as
production, read an earlier build.

- **Production, public:** https://common-ground-beryl.vercel.app, live since 2026-10-11 02:54 UTC. **Redeployed on
  2026-10-11 at 16:55 UTC** on Sonu's word (bus 004): deployment `oty4f9lvv` (`dpl_4eps9x74mJp4cNGXwCBLB2Q5Mv5k`),
  built from commit `8e717c0` plus the saved plan, which git ignores. Live planning is off. It carries the rebuilt
  engine, the form, the note check, the field-by-field privacy note and a saved plan made by the current engine.
- **Checked on the public URL, with no login, at 16:56 UTC:**
  - `/api/health` with a fresh address each time: `{"livePlanning":false,"planningOpen":false,"pausedFor":"off","counters":"redis"}`.
  - The page: 200, and its HTML holds the new "What is sent, and where" section.
  - `npm run demo:e2e:public`, 3 of 3 (table below): planning off and `POST /api/plan` refused; the saved plan
    identical to the local file; the page at 375 px.
  - `/.env`, `/.env.local`, `/PROGRESS.md`, `/package.json`, `/.qloo/calls.jsonl`, `/scripts/_env.py`,
    `/scripts/scan_qloo_data.py`, `/api/admin`, `/session_state/SESSION_STATE.md`, `/e2e/public.spec.ts` and
    `/tests/helpers.ts`: 404.
  - Headers: `x-frame-options: DENY`, `x-content-type-options: nosniff`, `referrer-policy`, HSTS.
  - `vercel inspect` on the public URL names `dpl_4eps9x74mJp4cNGXwCBLB2Q5Mv5k`, target production.
- **Before the deploy:** `vercel env ls` showed no `LIVE_PLANNING`, cap, limit or `FORCE_ERRORS` variable in any
  scope, and a dry run listed 47 files to upload: the saved plan among them, and nothing from `.env*`, `.qloo`,
  `scripts`, `tests`, `e2e` or `.claude`.
- **Before going public (CLAUDE.md rule 8), as it stands with planning off:**
  - No paid API call is reachable: the plan route answers 503 before it reads anything.
  - Keys are on the server only (the scans of the build output and of `public/`; no `NEXT_PUBLIC_` key).
  - Two routes exist, `/api/health` and `/api/plan`. No admin route.
  - Nothing a visitor can do changes a record. `/api/health` reads two counters from Redis; the saved plan is a
    static file anyone may read.
  - Weighed then, closed on 2026-10-13 (bus 009): `/api/health` read Redis on every request with no cache, so
    heavy traffic could use up Upstash's free quota, and planning would then answer 503 (it fails closed). One
    instance now reads the counters at most once a minute (`lib/health.ts`).
- **Previews** are protected by Vercel Authentication: a plain request gets a 302 to the login page.
  - From this machine: `vercel curl <path> --deployment <url>`.
  - From a browser test: the header `x-vercel-trusted-oidc-idp-token` with the short-lived `VERCEL_OIDC_TOKEN`.
    The token lasts 12 hours. `vercel env pull .env.local --yes` renews it. The scripted run sends it to the
    preview's own origin only, and the public check never sends it at all.
- **Deployments that exist now (2026-10-13 13:50 UTC, `vercel ls`):** production (`aukiltl2p`); the production
  builds before it (`heky0cciv`, kept for a rollback, then `oty4f9lvv`, `pokhqrs49`, `m99wf5qqn`); and three
  previews with planning off (`doofewnm7`, `9umot6h7k`, `7lxnc8zno`). Every preview built with planning on, one in
  bus 004, 15 in bus 005, 7 in bus 006, one each in bus 007 and bus 008 and 5 in bus 009, was removed
  after its run.
- No `LIVE_PLANNING`, cap, limit or `FORCE_ERRORS` variable exists in any environment, and since bus 005 none is
  ever put there. A test preview gets its settings on that one deployment:
  `vercel deploy --target=preview --yes -e LIVE_PLANNING=on -e IP_PLANS_PER_DAY=60 -e IP_PLANS_PER_HOUR=30`.
  Nothing is stored in a scope, so there is nothing to take off afterwards, and several previews with different
  settings can be built at the same time. Checked: such a preview's `/api/health` says `livePlanning` true, and
  `vercel env ls` lists nothing new. The preview is removed after its run (`vercel rm <url> --safe --yes`).
  `LIVE_PLANNING` is never set in Production without Sonu's word.
- A plain `vercel deploy` makes a preview. `vercel deploy --target=preview --yes` says so outright, and
  `vercel deploy --dry --target=preview --yes` lists the files first.

### The freeze until the switch

**Sonu, 2026-10-14 (bus 010):** "No change to the app's code or its configuration until the Oct 27 switch, except a
fix Sonu approves by name. Any approved fix means the browser gate runs again on the new commit before the switch."

**Which paths.** Read off what a deploy uploads. A dry run on 2026-10-14 (`vercel deploy --dry --target=preview --yes
--json`; it builds nothing, and `vercel ls` listed the same eight deployments after it) names 53 files.

| | Paths | Why |
|---|---|---|
| Frozen | `app/`, `lib/`, `next.config.ts`, `package.json`, `package-lock.json`, `tsconfig.json`, `.vercelignore`, `eslint.config.mjs`, `vitest.config.ts`, `vitest.live.config.ts` | The app, and the configuration that goes up with it |
| Frozen | `public/saved-plan.json` | Uploaded and served. Git does not track it, so a digest stands in: its SHA-256 begins `173a545d3b26` (`main`). On the branch `bridge-grandparent`, in `../qloo-bridge`: `a5ef93fe54d3`, recorded 2026-10-28 at 17:28 UTC under the new rule (bus 015) |
| Frozen, outside the folder | Vercel: the variables in every scope and the project's settings, Deployment Protection and Trusted Sources among them. Upstash: the database and its settings. The keys. The Vercel CLI on this machine, 62.4.0 | What the build runs with, and the tool whose own help the step list was read from. The one change is the switch itself, `LIVE_PLANNING=on` at step 4, on Sonu's word |
| Free | `submission/`, `scripts/`, `tests/`, `e2e/`, `playwright.config.ts`, `.claude/` | Never uploaded: `.vercelignore` names them, and the dry run lists each as ignored |
| Free | The records: the twelve `.md` files at the top, `LICENSE`, `session_state/`, and `check.sh` | Uploaded with the source, but the app reads none of them (`app/` and `lib/` read one file, `lib/sources.json`) and no address serves them: the gate asks for three and gets 404 |
| Free | The video, its frames and its pictures: `.qloo/submission/` | Ignored by git and by Vercel. Git holds no `video/` folder; the script and the narration are in `submission/` |

- A test preview's settings are given to that one deployment (`-e`) and stored nowhere, so the browser gate changes
  no configuration.
- Two files written by the tools go up as well: `next-env.d.ts` and `tsconfig.tsbuildinfo`. They change when the
  checks run, not when someone edits. Every build so far went up with them. Whether the build reads the second was
  not checked.
- The checks themselves (`tests/`, `e2e/`, `scripts/`, `check.sh`) are not the app, so Sonu's words leave them free.
  My own rule for them: a check is changed only where it is wrong, and the report says so.

**Does a commit to `submission/`, or a new take of the video, change the build that goes live?**

- **Its files: no.** `submission/` is not uploaded, and the video cannot be committed at all.
- **Its name: yes.** Vercel tells a build the commit of the folder it was made from, `/api/health` reports it, and
  the gate holds the candidate to it. Any commit after the browser gate, to a draft or to a record, would give the
  candidate a commit that the browser gate never ran on.

**How the two stay apart.**

1. **Until "Run the browser gate":** the free paths are committed on `main` as always, because the gate runs on the
   head of that day. That the freeze held is shown at step 1. This prints nothing, or only a fix Sonu approved by
   name:

   `git diff --stat e5167cd HEAD -- app lib next.config.ts package.json package-lock.json tsconfig.json .vercelignore eslint.config.mjs vitest.config.ts vitest.live.config.ts`

   and `sha256sum public/saved-plan.json` begins as in the table. `e5167cd` was the head when Sonu gave his word.
   Between it and `4d4849f`, the commit the whole gate passed on in bus 009, the same command prints nothing.
2. **From "Run the browser gate" until step 8 is done:** `main` does not move, and this folder holds nothing
   uncommitted. The gate on the candidate fails otherwise: it wants `git status --porcelain` empty, and HEAD equal
   to `origin/main` and to the commit the build names. Anything written in that window goes on a side branch in a
   second folder: `git worktree add ../qloo-drafts -b drafts`, committed and pushed there, then `git merge drafts`
   on `main` once the switch is done.

   Tried on this machine on 2026-10-14: a draft commit on a side branch in a second folder left this folder's
   `git status` empty and its HEAD where it was; the branch was deleted again. **Not tried:** pushing a side
   branch. No push has made a deployment on this project so far: `vercel ls` lists only the eight made from the
   CLI.

### Switching planning on: at the Oct 27 review, on Sonu's word

**Decided by Sonu on 2026-10-13 (bus 008):** live planning goes on in production at the Oct 27 review, with a
redeploy then, and stays on through judging. Moved by one day in bus 011: the browser gate on 2026-10-27, the
candidate and the promotion on 2026-10-28. Free testing must hold until 2026-11-06 04:45 UTC, the end of Qloo's
judging. **Not before the review: until then production stays as it is,** with no redeploy and no variable.

**The plan (bus 009, 2026-10-13):** production is built once with planning on and kept off the public address. The
gate runs on that one build. Then that same build is given the public address. What was checked is what goes live.

**What Sonu types.** A word to this session each time. Nothing below happens without it.

| When | Sonu types | What it starts |
|---|---|---|
| The UTC day before the review. The code is frozen already; from this word on `main` does not move | "Run the browser gate" | Steps 1 and 2. Test previews only, about 5 US cents. Production is not touched |
| At the review | "Build the candidate" | Steps 3 to 6. `LIVE_PLANNING=on` is stored for Production, and one production build is made that the public address does not serve yet. One plan, about one cent |
| After reading what the gate found | "Promote" | Steps 7 and 8. The public address serves the candidate, and anyone can plan, under the caps |
| Then, on his phone, on mobile data | Opens https://common-ground-beryl.vercel.app and taps "Plan a visit for Rosa and Leo" | His own look: the first card in about 15 seconds, the plan in about 20. About one cent |
| Later | "New take" | The video again, on the public page with planning on. About two cents |

If he would rather type the commands himself, the three that change something are steps 4, 5 and 7, each with `!`
in front in this session.

**The day before. Nothing in production changes.**

1. The commit that will go live: `git status` shows nothing, and it is pushed. The freeze held ("The freeze until
   the switch" above): its `git diff` prints nothing but a fix Sonu approved by name, and the saved plan's digest
   is the one noted there. `uv run scripts/check_sources.py`, then `bash check.sh`. **No commit on `main` after
   this until the switch is done:** a build names the commit it was made from, and the candidate must name the
   commit that was gated. What the gate finds is kept in `.qloo/gate/` and written into the records after the
   switch. Anything else written meanwhile goes on the side branch.
2. The browser gate on previews of that commit, each with its settings on that deployment alone and removed after
   its run (the commands are under "Bus 009" below):
   - the four failure paths, `rate-limit` first in its clock hour;
   - on one preview with planning on: `GATE_URL=<preview> GATE_PLAN=1 npm run gate:build` (6 of 6), the public
     check with `PREVIEW=1 PLANNING=on BUILD=$(git rev-parse HEAD)` (4 of 4), and `npm run demo:e2e` (8 of 8);
   - `npm run demo:e2e:a11y` against this machine's build (9 of 9).

   **Why the day before.** Production allowed one address 6 plans an hour and 10 a UTC day (20 and 20 from bus 013,
   2026-10-28), and every preview counts in the same database. These runs make 8 plan requests from this machine. On
   the day itself that would leave 2, and the candidate's plan and a new take need 3. If the gate has to run on the
   day after all, the candidate's plan waits for the next clock hour, the take for the next UTC day, and Sonu's own
   plan goes over mobile data.

**At the review.**

3. Nothing moved: `git status` shows nothing; `git rev-parse HEAD` is the gated commit and equals
   `git rev-parse origin/main`; the saved plan's digest is the one noted at step 1; `vercel env ls` shows no
   planning variable; `vercel env pull .env.local --yes` renews the token.
4. Store the switch: `vercel env add LIVE_PLANNING production --value on --no-sensitive --yes`. It reaches builds
   made from then on. The build the public address serves does not change: Vercel's docs say "Any change you make to
   environment variables are not applied to previous deployments, they only apply to new deployments." Check:
   `/api/health` on the public address still says `livePlanning` false.
5. Build the candidate: `vercel deploy --dry --prod --yes` and read the file list (the saved plan in it; nothing
   from `.env*`, `.qloo`, `scripts`, `tests`, `e2e`, `.claude` or `submission`). Then
   `vercel deploy --prod --skip-domain --yes`. Check: `vercel inspect <candidate>` says target production;
   `vercel inspect https://common-ground-beryl.vercel.app` still names `dpl_3DLFqLJxSx5iUitEU7j2EqKZP8Zg`; a plain
   request to the candidate's own address gets Vercel's login.
6. The gate on the candidate: `GATE_URL=<candidate> GATE_PLAN=1 npm run gate:build`. Six checks, all through
   `vercel curl`: it is built from this folder's commit, with nothing uncommitted or unpushed; it is one ready
   deployment; planning is on and open, the counters are in Redis, and a bad request is refused past the switch;
   it serves the recording that is in this folder; 18 private paths answer 404 and the security headers are there;
   and one plan for the sample family arrives through its own route, inside a minute and under its cap, and passes
   the wording rules. Sonu reads the result.
7. On "Promote": `vercel promote <candidate> --yes`.
8. On the public address, one after the other and unhurried (see "Vercel's firewall" below):
   - `GATE_URL=https://common-ground-beryl.vercel.app GATE_SAME_AS=<candidate> npm run gate:build`: the public
     address serves the very deployment that was gated, built from this commit, with planning on and open.
   - `DEMO_URL=https://common-ground-beryl.vercel.app PLANNING=on BUILD=$(git rev-parse HEAD) npm run demo:e2e:public`:
     4 of 4.
   - `DEMO_URL=https://common-ground-beryl.vercel.app npm run demo:e2e:a11y`: 9 of 9.
   - Sonu's plan by hand.
9. Afterwards: the records, with what the gate found; `vercel ls` (the build before, `aukiltl2p`, is kept); the new
   take (`submission/NARRATION.md` says which lines change); version A of "What is live and what is a recording"
   in both Devpost texts; the README's line that planning is off.

**If something is wrong.**

- Before promoting, nothing is public: `vercel env rm LIVE_PLANNING production --yes` and
  `vercel rm <candidate> --safe --yes`. Production is as it was.
- After promoting: `vercel rollback --yes` puts the public address back on the build before, which has planning
  off. Vercel's docs: "Hobby users can roll back to the immediately previous deployment" and "After a rollback,
  Vercel turns off auto-assignment of production domains", so the next production build needs `vercel promote`
  too. The slower way, used many times here: `vercel env rm LIVE_PLANNING production --yes`, then
  `vercel deploy --prod --yes`.
- If `--skip-domain` or `vercel promote` does not do what the docs say: `vercel deploy --prod --yes`, the way every
  production build so far was made, and step 8 at once.

**What was tried, and what was not.**

- Tried on 2026-10-13, on test previews and read-only on production: everything in steps 1, 2, 6 and 8 except
  that the builds were previews, the same-deployment check included (the public address against `aukiltl2p`
  passes, against `heky0cciv` fails).
- **Run for the first time on 2026-10-27:** `vercel deploy --prod --skip-domain` and `vercel promote`, each as the
  docs say ("The candidate", above). **Never run on this project:** `vercel rollback`. From
  Vercel's docs, fetched on 2026-10-13 by a helper that returned the quotes (I did not read the pages through
  myself); the flags are in the installed CLI's own help: `--skip-domain` "will disable the automatic promotion (aliasing) of the
  relevant domains to a new production deployment. You can use `vercel promote` to complete the domain-assignment
  process later"; promoting "a production deployment which has never served production traffic" does not rebuild
  it: "Vercel will instantly promote the deployment; it doesn't require a rebuild."
- **No browser can reach the candidate before it is promoted.** A production build at its own address is behind
  Vercel's login (a plain request to `aukiltl2p` and to `heky0cciv` got a 302 to the login), and the short-lived
  token opens previews only: the same request with the token got 403, `TRUSTED_SOURCES_ENVIRONMENT_MISMATCH`.
  `vercel curl` gets in. So the candidate is gated without a browser, and the browser checks run on a preview of
  the same commit and on the public address after promoting. The project's Trusted Sources setting could let the
  token in (development to production). That is a change to who can open production builds, for one run.
  **Sonu, 2026-10-14 (bus 010): leave it off.** The candidate stays gated through `vercel curl` and a preview of
  the same commit.

**Vercel's firewall (seen 2026-10-13, 13:50 UTC).** Two runs of the gate, seconds apart, each asked the public
address for 18 private paths; a third had done so eight minutes earlier. All answered 404 until, two thirds of the
way through the last run, Vercel began to answer this machine with its checkpoint page (403, `x-vercel-mitigated:
challenge`) on every page of the site. It did so for 9 to 12 minutes: still at 13:59, gone at 14:02. A headless
browser did not get past the page in 9 seconds; whether an ordinary browser does was not checked. Once it had
lifted, the public check passed 4 of 4 on production again. Requests through `vercel curl` to a build's own address
were answered as usual all the while. Nothing in the project was changed by it. The gate now asks for private paths
only at a build's own address, about one a second through the CLI, and both checks stop with a plain message when
they meet the checkpoint. On the day: run each check on the public address once, and not again and again.

To switch it off again: `vercel env rm LIVE_PLANNING production --yes` and `vercel deploy --prod --yes`. This is the
plan for after Qloo's judging (Sonu, 2026-10-28, option B): once 2026-11-06 04:45 UTC has passed, on his word at
the time. `lib/config.ts` stays as it is.

While it is on, through judging: watch `/api/health` and `uv run python scripts/spend_status.py`. The budget
schedule (`lib/config.ts`) allows $1.50 a day and $8 in total until Qloo's judging opens on 2026-11-02, then $3.00
a day and $15. A family nobody has asked about before costs 22 Qloo calls: the app's 300 a day allow 13 such
families, and the key's 10,000 a month about 450. `/api/health` answers from one reading of the counters for up to
a minute, so the page may show the plan button for that long after a cap is reached; the plan route then refuses
with the reason and the page shows the recording. Upstash's free plan allows 500,000 commands a month (its pricing
page, 2026-10-13): one instance asked without pause now spends at most 2,880 of them a day on the health route.
Not bounded by this: a request to `/api/plan` that passes the form's checks costs two to four commands for the
rate limit even when it is refused.

### First deploy (2026-10-06 UTC)

- Vercel project `sy22478/common-ground`, linked from this folder (`.vercel/`, git-ignored).
- **Production, public:** https://common-ground-beryl.vercel.app (also `common-ground-sy22478.vercel.app`).
  - The first `vercel deploy` of a new project goes to production, not preview.
  - No environment variables are set yet, so live planning is off and no model call is possible.
- GitHub is not connected: Vercel's GitHub app has no access to the private repo. Pushes do not deploy; deploys go
  out from the CLI.
- `vercel link` wrote `.env.local` with a short-lived `VERCEL_OIDC_TOKEN` and appended `.vercel` and `.env*` to
  `.gitignore`.
  - `.vercel` is kept.
  - `.env*` was removed because it overrode the `!.env.example` exception; the existing `.env` and `.env.*` rules
    already cover `.env.local`.
  - The secret scan now also checks the OIDC token.

Checked on the production URL: the page returns 200; `/api/health` returns
`{"livePlanning":false,"planningOpen":false,"pausedFor":"off","counters":"unavailable"}`; `/api/plan` returns 503
"switched off"; `/saved-plan.json`, `/.env`, `/PROGRESS.md` and `/package.json` return 404. The deployment's file
list (Vercel API, `/v6/deployments/<id>/files`) has 58 files and no `.env` file of any kind.

## Redis (2026-10-06)

- `common-ground-redis`: Upstash for Redis, Free plan, region iad1, connected to `common-ground` in Development,
  Preview and Production. Checked from the CLI: `vercel env ls` lists the five variables in all three environments,
  and `vercel integration list` shows the resource as Available.
- One database serves all three environments.
  - The app's spend counters are shared on purpose: the money is the same whichever environment spends it.
  - Tests never use the app's keys. Offline tests blank the Redis variables, so they always use memory.
  - The live Upstash test works under its own `test:<time>:` prefix. It checks that nothing is left under that
    prefix and that the app's real counters are unchanged.
- **Stage 4 passed** (2026-10-06, `tests/upstash.live.test.ts`, 4 of 4):
  - 20 concurrent plans could not overshoot a $0.10 daily cap on the real database (3 accepted).
  - One real Nemotron Nano call settled its exact cost into Redis.
  - Nothing was left under the test prefix, and the app's counters were unchanged.
- `vercel env pull` and `vercel link` re-add `.env*` to `.gitignore` whenever it is missing, so it stays, followed by
  `!.env.example`.

## Secrets in Vercel

- `HASH_SECRET` (2026-10-06): Production and Preview, type Sensitive. It was generated and piped into
  `vercel env add` in one command, so the value was never printed or saved. One value serves both environments,
  so the shared database sees consistent hashes.
- `NEBIUS_API_KEY` (2026-10-07): Production and Preview, Sensitive. Sonu chose to reuse the local key (option B); it was
  copied with `scripts/push_env.py` and never printed.
- API keys: `scripts/push_env.py SOURCE TARGET production preview` reads a key from `.env` or `.env.local` and pipes it
  into `vercel env add --sensitive`, printing only ok or FAILED with the value redacted.
- `TAVILY_API_KEY` (2026-10-11): Production and Preview, Sensitive, reusing the local key (option B, chosen by the
  machine on Sonu's "proceed"; Sonu can reverse it).
- `QLOO_API_KEY` (2026-10-11): Production and Preview, Sensitive. Sonu saved the key into `.env` himself; it was
  copied with `scripts/push_env.py` and never printed. `vercel env ls` shows all four secrets as Secret in both.
- The secret scan plants a copy of every key it knows and must catch it (`scripts/scan_secrets.py --self-test`, in
  `check.sh`), so a new key is known to be covered, by name, on every run.

## What a CLI deploy uploads

`vercel deploy` uploads every file in the folder except Vercel's default list and `.vercelignore`. Vercel's default
list covers `.env.local` and `.env.*.local`, but not `.env`, and it does not read `.gitignore`
(vercel.com/docs/deployments/build-features, "Ignored files and folders"). So `.vercelignore` names `.env` and
`.env.*` explicitly, and `check.sh` fails if either line is removed. Without it, a CLI deploy from this folder would
have uploaded the local keys with the source.

Checked with a dry run on 2026-10-11: 44 files go up. `.env`, `.env.local`, `.claude`, `.qloo`, `scripts` and `tests`
are ignored. Again on 2026-10-14: 53 files, and `submission`, `e2e` and `playwright.config.ts` are ignored too.
"The freeze until the switch" above sorts the 53 into what is frozen and what is free.

## The saved plan and other Qloo data

Qloo's guide says "Do not store Qloo response data in a public repository" (RULES_NOTES.md, flag 8). So:

- `.qloo/` (raw probe responses, plan traces) is ignored by git and by Vercel.
- `public/saved-plan.json` is ignored by git but **uploaded by a CLI deploy from this folder**, and served. A deploy
  from a fresh clone would have no saved plan: the paused page then shows only its notice. `check.sh` scans `public/`
  for key values because git no longer lists that file.
- To make it, either way through `lib/saved.ts`, which is tested offline:
  - `npx vitest run --config vitest.live.config.ts tests/saved-plan.live.test.ts` makes one real plan here (about
    $0.03) and saves it.
  - `SAVED_PLAN_STREAM=<file>` in front of the same command makes no call: it reads the saved event stream of a plan
    made through a deployed route.
- **Event cards are left out of the saved plan** (Sonu, 2026-10-11, bus 003): an event found on the web is an
  unchecked lead, and a recording stays up for weeks. The file records how many were left out and the page says so.
  Nothing else in the plan is changed. Live plans keep their event cards.
- **The saved plan now on the public page** was made on 2026-10-11 at 16:51 UTC through the deployed route of a
  preview of commit `8e717c0`, with one event card left out. It shows Qloo's two affinities on the bridge card.
  - Six recordings were made, about a cent each ($0.058 in all, 8 to 12 s each). All six have the same bridge with
    the same two affinities. Nothing in a recording is edited: one is chosen.
  - Chosen by these tests, set before reading them: no question assumes a fact about her life; at most one moment is
    a work or artist they listed themselves; the Spanish reads cleanly to me; and as many cards as possible are
    Qloo's own finds.
  - The first recording was kept: three of its four cards are Qloo's finds and the fourth is her own dish. Its
    weak points: one sentence says what kind of cinema she "adores", which is read into her favorites, and its
    questions are more playful than about her life.
  - Why not the others: one had a question that assumed a fact about her family; one made a web lead into a place
    card with a street address; one had a grammar slip in a Spanish question, as far as I can judge; one made two of
    their own favorites into moments; one used a verb mood I would not trust. PROGRESS.md lists these as findings.
  - The plan before it (01:31 UTC, the engine before the rebuild) and all six streams are in `.qloo/`.
- **The saved plan waiting in this folder for the redeploy** (bus 005) was made on 2026-10-11 at 20:07 UTC through
  the deployed route of a preview of commit `78b683d`. It is not on the public page yet.
  - A recording is now held to the wording rules whatever engine made it (`savedPlanProblems` in `lib/saved.ts`).
    The recording test refuses to save a plan that breaks them, and `check.sh` fails while the file in `public/`
    does. Held to them, the plan now in production fails on two sentences ("she adores", "grew up with").
  - Seven recordings were made in two rounds, about a cent each. The three of the first round were made with the
    first version of the rules and each still broke a rule that was then tightened, so none was kept.
  - Of the four of the second round, chosen by tests set before reading them: it passes the rules (all four do);
    no question is about a card the recording leaves out; at most one moment is a work or artist they listed
    themselves; it has the place card; and the Spanish reads cleanly to me. Two were set aside: one had four
    sentences taken out, which left two cards with only their plain line; one asked what she likes most about the
    place, which she may never have seen.
  - Of the two left, the second was kept. Its cards: two of Qloo's finds, her own dish, and a place from Qloo's
    tag search with Qloo's address. Its steps show a rule taking a sentence out. Its weak point: one card says
    the two of them "share" a rhythm, which is Qloo's reading of their tastes and not something they said.
  - The streams are in `.qloo/saved-stream-2026-10-11T1950*.txt` and `T2008*.txt`. This plan went to production in
    bus 006 and is the one in `public/` now (`.qloo/saved-plan-2026-10-11T2008b.json` is a copy).
- **The saved plan waiting for the next redeploy** (bus 006) is `.qloo/saved-plan-2026-10-11T2128b.json`, made at
  21:28 UTC through a preview of commit `3481985`. It is kept out of `public/` so that this folder and production
  still hold the same plan, which the read-only check compares.
  - Eight recordings were made in two rounds, about a cent each. The four of the first round held, beyond the
    bridge, only finds from the visitor's side; the order in which finds are offered was changed for that, and none
    of the four was kept.
  - Of the four of the second round, by the same tests as before: one asked which filling she favours at a place
    that its own plan did not show, so it was set aside. Of the three left, the one with the place card was kept:
    a mariachi group from the grandmother's list, a film from the visitor's, the place from Qloo's tag search
    with its address, and her own dish. Its weak points: one card says only "Play their mariachi recordings."
    after a sentence was taken out, and one speaks of "the flavors of home".
  - It carries the comparison with Qloo's 50 most popular on its bridge card, and who did each step.

## What each stage can prove

| Stage | Needs | Proves | Cost |
|---|---|---|---|
| 1. Preview (or production, as now), `LIVE_PLANNING` unset | Vercel, Upstash connected | The page renders; `/api/plan` answers 503 "switched off"; `/api/health` reports `"counters":"redis"`, so the deployed function reaches Upstash although planning is off | $0 |
| 2. Preview, `LIVE_PLANNING=on`, `IP_PLANS_PER_HOUR=2`, `PLAN_CAP_USD=0` (Preview scope only) | 1, `HASH_SECRET`, `NEBIUS_API_KEY` | The third request from one address gets 429. The counter lives in Upstash and is shared across serverless instances. Now that the Qloo key is set, `PLAN_CAP_USD=0` is what keeps the allowed plans free: each stops before its first model call | $0 |
| 3. Preview, `LIVE_PLANNING=on`, `TOTAL_CAP_USD=0.01`, no `PLAN_CAP_USD` (Preview scope only) | 2 | `/api/plan` answers 503 "paused until 2 November, 17:00 UTC, when its next budget opens"; `/api/health` says `"pausedFor":"total"`; the page offers the saved plan if one is deployed | $0 |
| 4. Local live test against the real Upstash (`npx vitest run --config vitest.live.config.ts tests/upstash.live.test.ts`) | `.env.local` from `vercel env pull` | 20 concurrent plans cannot overshoot a daily cap on real Redis. One real Nemotron call settles its exact cost into Redis. Uses its own key prefix, deleted afterwards | under $0.0001 |
| 5. Preview, real plans | **the Qloo key** | A real plan end to end through the deployed route. Then, with a tight `DAILY_CAP_USD`, the next request gets 503 and health says `"pausedFor":"daily"`. Then the scripted Playwright run (`npm run demo:e2e`, two plans) | about $0.03 a plan |
| 6. Production, `LIVE_PLANNING=on` | 5 passed, Sonu's word | Public planning | expected about $0.016 a plan |

Each stage needs its own deploy: Vercel applies a changed variable only to the next build.

### Results on the preview (2026-10-11 UTC)

| Stage | Deployment | Result |
|---|---|---|
| 1 | `7lxnc8zno` | Pass. Page 200; health `"livePlanning":false,"counters":"redis"`; `/api/plan` 503 "switched off"; `/.env`, `/.env.local`, `/saved-plan.json`, `/PROGRESS.md`, `/package.json`, `/.qloo/calls.jsonl` and `/scripts/_env.py` all 404 |
| 2 | `u3k7liksh` | Pass. Requests 1 and 2 were allowed and stopped at `"costUsd":0`; request 3 got 429 with `Retry-After: 3275` |
| 3 | `6fe3juek2` | Pass. Health `"pausedFor":"total"`; `/api/plan` 503 with the total-cap message; page 200. No saved plan existed yet |
| 5, real plan | `g7a1ealwy` | Pass, with a fault found. 200, 17 events, a plan in 37 s for $0.0269. Its event card gave a wrong date (API_NOTES.md), fixed in the next build |
| 5, real plan again | `331ad10dd` | Pass. 200, 18 events, a plan in 26 s for $0.0233. Two bad tool arguments were sent back and corrected. The date guard replaced the event card's sentence. This plan is the saved plan |
| 5, daily cap | `enbihgmvn` | Pass. After $0.0502 of real spend that day and `DAILY_CAP_USD=0.06`: health `"pausedFor":"daily"`; `/api/plan` 503 "paused for today"; `/saved-plan.json` 200 and identical to the local file |
| 5, scripted Playwright run | `gujwxy8lo` | **Run on 2026-10-11 03:06 UTC: 6 of 8 steps pass.** See below |

One browser check was made instead, at no cost: the same build run on this machine with planning off, at 375 px wide.
The paused notice shows without scrolling, there is no plan button, "See a plan this agent made" opens the saved
plan with its recording note, the event card shows its caution and three source links (`target="_blank"`,
`rel="noopener noreferrer"`), the questions carry `lang="es"`, the page does not scroll sideways, the console is
clean, and the only requests are three GETs. The deployed preview was checked by `vercel curl` only, not in a browser.

### The scripted run (2026-10-11 03:06 UTC, `npm run demo:e2e`, two real plans, $0.0588)

| Step | Result | Measured |
|---|---|---|
| 1. Sample family visible without scrolling at 375 px | Pass | The plan button itself is below the fold at 375 by 667 |
| 2. First agent step within 3 s | Pass | 0.8 s |
| 3. Bridge card first, within 25 s | **Fail** | It is first, but it arrived at 26.5 s, with the rest of the plan |
| 4. Four moment cards, each with a source chip, within 60 s | Pass | 26.4 s |
| 5. Three questions in Spanish with glosses, none a memory test | Pass | |
| 6. Every card named in the run's evidence | Pass | Checked in the test from the event stream, not by the server |
| 7. Feedback changes the next plan | **Fail** | The feedback was sent. Music items stayed at 1 and the next plan still had a film (two films before, one after) |
| 8. No console errors; cost logged | Pass | Plan 1 $0.0244, plan 2 $0.0344 |

Plan 1 used three Qloo tools: search, insights and compare. Tags was not called.

### The scripted run after the engine was rebuilt (2026-10-11, 03:42 to 04:15 UTC)

Run seven more times as the engine changed, each on a fresh preview with planning on. **The last three runs pass all
8 steps**: one on commit `076b8e8` and two on the final build, `b61ebe6`.

| Step | Measured in those three runs |
|---|---|
| 2. First agent step within 3 s | 0.2 to 0.8 s |
| 3. Bridge card first, within 25 s | 6.4 to 7.4 s, the same bridge each time, with Qloo's two affinities on the card |
| 4. Four moment cards within 60 s | Four cards; the whole plan in 9.5 to 11.0 s |
| 7. Feedback changes the next plan | Music cards 1 to 3, 1 to 4 and 1 to 3; no film; the second plan in 8.8 to 22.4 s |
| 8. Cost | $0.016 to $0.020 for the two plans |

Of the four runs before them, three failed one step and one passed with a bridge that was not steady. Each led to a
change:

| Run (UTC) | Failed | What changed |
|---|---|---|
| 03:42 | Step 3: the bridge at 25.01 s | Gathering in 4 replies, the bridge chosen in code and shown early, the planner fast first |
| 04:05 | Step 7: music 3 to 3 | "More" can reach four cards of a kind, not three |
| 04:07 | None, but the bridge was an artist where a run on this machine gave a film | Every call for a person goes out with all of that person's ids |
| 04:11 | Step 4: three moment cards | The planner writes five moments and four are shown |

One more run on the build with the form (`7fbeba0`, 04:27 UTC): 8 of 8 again, the same bridge at 8.4 s, music cards 1
to 4, $0.021 for the two plans.

### On the build now in production (commit `8e717c0`, 2026-10-11 16:50 UTC)

`npm run demo:e2e` on preview `nv0m6vjh0`, built with planning on in Preview scope only: **8 of 8**.

| Step | Measured |
|---|---|
| 2. First agent step within 3 s | 0.8 s |
| 3. Bridge card first, within 25 s | 10.4 s; the same bridge, with the same two affinities, as on the build before |
| 4. Four moment cards within 60 s | Four cards; the whole plan in 14.1 s |
| 7. Feedback changes the next plan | Music cards 1 to 5, no film; the second plan in 12.6 s |
| 8. Cost | $0.0208 for the two plans |

What changed in the engine since the last run: the model that gathers no longer reads the language, grandmother or
grandfather, the birth year or the note (API_NOTES.md). No new Qloo call reached Qloo: the sample family's lookups
came from the cache. The failure paths below were last run before the engine was rebuilt; `tests/faults.test.ts`
covers a dead Qloo and a dead web search on the current engine, without a browser.

### Bus 005: the runs on the wording rules and on the final build (2026-10-11, 19:35 to 20:15 UTC)

Fifteen previews in all, each built with its settings on that deployment only and removed after its run.

| Run | Build and preview | Result |
|---|---|---|
| Rate limit | The first version of the rules, `2f5klabej` | Pass, $0. Two plans stop at the $0 plan cap, the third gets "Please try again in an hour." |
| Paused | The same, `gquux4s2g` | Pass, $0 |
| Qloo down | The same, `r46m1ck3k` | Pass. $0.0008, 5 tool calls, done in 2.4 s |
| Web search down | The same, `l7udf6efh` | Pass. The plan arrives without events and says why. $0.0093, 11.5 s |
| Scripted run | The same, `qavlmqqpg` | 8 of 8. First step 0.8 s, bridge 7.4 s, plan 9.8 s; music cards 1 to 4, no film; $0.0176 |
| Scripted run, twice | `78b683d`, `de5mrsu9w` | 8 of 8 on the second try: first step 0.2 s, bridge 8.9 s, plan 11.3 s; music 1 to 3; $0.0227. The first try ($0.0191) failed one check through the check's own selector |
| Paused, Qloo down, web search down | `78b683d`, `l8iwsuof5`, `3eove0ke8`, `dwch9qu0m` | 3 of 3. Web search down: $0.0083, 7.8 s |
| Scripted run | `af79014`, `lhbsubqzr`, 60 plans a day | Stopped at the second plan: 429, "Please try again tomorrow." This machine's runs had used the day's 60 plans for one address. The first plan was fine ($0.0091) |
| Rate limit | `af79014`, `p57avogby`, hourly limit 17 | Pass, $0. This address had made 15 requests that hour, so the limit was set two above: requests 16 and 17 were allowed and stopped at the $0 plan cap, the 18th got "Please try again in an hour." A refused request counts too |
| Scripted run | `af79014`, `nrv5gxj5p`, 200 plans a day | 8 of 8. First step 0.8 s, bridge 6.4 s, plan 8.6 s; second plan 16.7 s; music 1 to 3, no film; four Qloo endpoints; every step labelled; the plan button on the first screen; $0.0230 |

The builds named `78b683d` and `af79014` were deployed from this folder as it stood at those commits, but for two
comment lines in `lib/tools.ts`: they quoted the name of a Qloo tag, and were reworded in the three commits not yet
pushed, so that the name never reached the repository. No line of code differs.

What the scripted run checks that it did not before: the four Qloo endpoints (rubric 1), who did each step on both
plans (rubric 5), and the caution on a place card.

Three guards were met by accident, each working as built: the day's limit of plans for one address (above); the
day's 30 web searches, reached at about 20:10 UTC, after which a plan says the web search is not answering and goes
on without events; and the hourly limit, which is why the rate-limit path was rerun with a limit set two above that
hour's count.

### Bus 006: the runs on the final build (2026-10-11, 21:20 to 21:30 UTC)

Seven previews, each with its settings on that deployment only, all removed after their runs.

| Run | Build and preview | Result |
|---|---|---|
| Rate limit | `6265710`, `p54rwr9so` | Pass, $0. Run first in its clock hour |
| Paused | `6265710`, `2qftsy3rp` | Pass, $0 |
| Qloo down | `6265710`, `5507slmgy` | Pass. About $0.0008 |
| Web search down | `6265710`, `fmgy1a8y9` | Did not run: 429. The preview had six plans an hour and this machine had made ten |
| Scripted run | `6265710`, `8o5y29uyt` | 8 of 8. First step 0.8 s, bridge 11.4 s, plan 13.7 s; second plan 17.4 s; music 1 to 4, no film; $0.0194 |
| Web search down | `3481985`, `g5zgibolz`, 60 plans an hour | Pass. $0.0104, 11.2 s |
| Scripted run | `3481985`, `f24m78154` | 8 of 8. First step 0.8 s, bridge 9.9 s, plan 12.5 s; second plan 22.7 s, its bridge at 20.0 s; music 1 to 3, no film; the bridge held against the 50 most popular, with the comparison on the card; $0.0251 |

The builds named `6265710` were deployed from this folder as it stood at that commit, but for two comment lines
that gave figures from Qloo's answers and were reworded before anything was pushed. No line of code differs.

Settings for the next round: give every preview that makes plans `IP_PLANS_PER_DAY=300` and `IP_PLANS_PER_HOUR=60`
after a day or an hour of many runs, and `TAVILY_PER_DAY=60` if the day's 30 web searches are used up. Run
`rate-limit` first in a clock hour with `IP_PLANS_PER_HOUR=2`.

**Keyboard and contrast** (`npm run demo:e2e:a11y`, no cost, against any build): 9 of 9 on this machine's build of
`3481985`. It answers the two API routes itself. What it checks is in GATE.md, item 7.

**The sources** (`uv run scripts/check_sources.py`, no cost): every quote found on its page, the PDF among them, at
21:33 UTC.

### Bus 007: the video take (2026-10-12, 22:23 to 22:30 UTC)

One test preview, `9dpgox8d6`, built from the working tree at commit `1d6f22e` (no file under `app/`, `lib/` or
`public/` differed from the production build, `73baa96`), with its settings on that deployment alone:
`vercel deploy --target=preview --yes -e LIVE_PLANNING=on -e IP_PLANS_PER_DAY=300 -e IP_PLANS_PER_HOUR=60 -e
TAVILY_PER_DAY=60`. Its `/api/health` said `livePlanning` true; `vercel env ls` listed nothing new; production
still answered with planning off. Then:

`vercel env run -- sh -c 'PREVIEW_URL=<the preview> KEEP_FRAMES=1 npm run demo:video'`

| What | Result |
|---|---|
| First try | Stopped before any plan: the page was Vercel's login. The token in `.env.local` had expired at 04:49 UTC, and `vercel env run` loads that file over the fresh values it downloads. `vercel env pull .env.local --yes` renewed it. No cost |
| The take | Two plans, $0.0203 (the counters went from $0.7407 to $0.7610), 7 Qloo calls, 2 Tavily credits. Its 7 checks on the two plans passed (GATE.md). 162.4 s |
| Afterwards | `vercel rm <the preview> --safe --yes`. `vercel ls` shows production, its four earlier builds and the three old previews with planning off |

`DRY=1 npm run demo:video` films the public page alone, at no cost, and was run three times first to try the camera.
What the take is and where its files are: `submission/VIDEO.md`.

### Bus 008: the runs on the two fixes (2026-10-13, 04:00 to 04:03 UTC)

One test preview, `5b5lpje0j`, built from commit `0dc1d40` with the usual settings on that deployment alone
(`-e LIVE_PLANNING=on -e IP_PLANS_PER_DAY=300 -e IP_PLANS_PER_HOUR=60 -e TAVILY_PER_DAY=60`). The first try at
building it answered "Not authorized" although the CLI was signed in; the second try, a minute later, built it.
Its `/api/health` said `livePlanning` true. Removed after the runs; `vercel env ls` lists no planning variable and
production still answers with planning off.

| Run | Result |
|---|---|
| `vercel curl /api/plan --deployment <preview> -X POST -d @<the take's second request>` | A plan in 12.5 s, $0.0087 |
| `vercel env run -- sh -c 'DEMO_URL=<preview> npm run demo:e2e'` | 8 of 8, $0.0228 |
| The same `vercel curl`, for an invented family with a favorite Qloo cannot have | A plan in 18.6 s, $0.0093 |

Four plans, $0.0409 by the app's counters ($0.7610 to $0.8019), 18 Qloo calls and 4 Tavily credits.

### Bus 011: the browser gate on commit `1d76540` (2026-10-27, 10:23 to 10:29 UTC)

Sonu's word "Run the browser gate" came with bus 011, for 2026-10-27. Written on the side branch `drafts`, since
`main` stays at the gated commit until the switch is done.

**Step 1.** The freeze held: the `git diff` of "The freeze until the switch" printed nothing, and the saved plan's
digest begins `173a545d3b26`. `uv run scripts/check_sources.py` found every quote. `bash check.sh` passed, 284
tests. `git status` empty; `HEAD` and `origin/main` both `1d76540737a7e3153cae0c739980063551b9fd56`.

**Step 2.** Five previews of that commit, built from the clean folder, each with its settings on that deployment
alone, all removed after the runs (`vercel rm --safe`).

| Run | Preview and its settings | Result |
|---|---|---|
| `DEMO_CASE=rate-limit`, the first plan requests of the clock hour | `b6holloyo`: `-e LIVE_PLANNING=on -e IP_PLANS_PER_HOUR=2 -e PLAN_CAP_USD=0 -e IP_PLANS_PER_DAY=300` | Pass, $0 |
| `DEMO_CASE=paused` | `1ylpcgs4q`: `-e LIVE_PLANNING=on -e TOTAL_CAP_USD=0.01` | Pass, $0 |
| `DEMO_CASE=qloo-down` | `c2sj75vhr`: `-e LIVE_PLANNING=on -e FORCE_ERRORS=qloo -e IP_PLANS_PER_DAY=300 -e IP_PLANS_PER_HOUR=60` | Pass. $0.0008, 5 tool calls, done in 5.6 s |
| `DEMO_CASE=tavily-down` | `55xlytvc1`: the same with `FORCE_ERRORS=tavily` and `-e TAVILY_PER_DAY=60` | Pass. $0.0130, 25.0 s |
| `GATE_URL=<preview> GATE_PLAN=1 npm run gate:build` | `n249riwa7` (`dpl_3E8oyU1AbeeMF7uMJiC3kymKgcpW`): `-e LIVE_PLANNING=on -e IP_PLANS_PER_DAY=300 -e IP_PLANS_PER_HOUR=60 -e TAVILY_PER_DAY=60` | 6 of 6. The build names `1d76540`; planning on and open; counters in Redis; 18 private paths 404; one plan for the sample family in 19.3 s for $0.0143 |
| `PREVIEW=1 PLANNING=on BUILD=<commit> npm run demo:e2e:public` | The same preview | 4 of 4. Five new addresses answered from one reading of the counters; the plan button on the first screen |
| `npm run demo:e2e` | The same preview | Pass. First step 0.2 s, bridge 14.4 s, plan 16.8 s; second plan 17.4 s; music 1 to 3 and no film after the feedback; Qloo's search, tags, insights, compare and the bridge check; $0.0187 for both |
| `DEMO_URL=http://localhost:3213 npm run demo:e2e:a11y` | This machine's build of the same commit | 9 of 9 |

**Spend, by the app's counters:** $0.0468 ($0.8462 to $0.8930). 31 Qloo calls, since the answers cached in bus 009
had expired, and 4 Tavily credits. **Afterwards:** `vercel ls` lists the same eight deployments as before; `vercel
env ls` lists no planning switch, cap, limit or `FORCE_ERRORS`; the public address still serves
`dpl_3DLFqLJxSx5iUitEU7j2EqKZP8Zg` (`aukiltl2p`). The records of each run are in `.qloo/gate/2026-10-27/`.

**For 2026-10-28.** This machine made 8 plan requests on 2026-10-27; production counts them per UTC day, so the
candidate's plan and the new take start from none. The new take is made on the public page alone, without
`vercel env run`, so that no token goes to the public address: `PREVIEW_URL=https://common-ground-beryl.vercel.app
npm run demo:video`. Its captions for lines 6 and 7 (`open`, `here`) have not been run yet.

### The candidate (2026-10-27, 11:11 to 11:15 UTC)

Sonu's word "Build the candidate" came on 2026-10-27, a day earlier than bus 011 planned, in a clock hour with no
plan request from this machine yet. Steps 3 to 6:

- **Step 3.** The main folder clean at `1d76540`, equal to `origin/main`; the freeze `git diff` empty; the saved
  plan's digest `173a545d3b26`; no planning variable in any scope; the token renewed.
- **Step 4.** `vercel env add LIVE_PLANNING production --value on --no-sensitive --yes`. `vercel env ls` lists it,
  Config, Production only. The public address still answered `"livePlanning":false`.
- **Step 5.** The dry run named 53 files, the saved plan among them, and nothing from `.env*`, `.qloo`, `scripts`,
  `tests`, `e2e`, `.claude` or `submission`. Then `vercel deploy --prod --skip-domain --yes`: **the candidate is
  `common-ground-o3o01cslm-sy22478.vercel.app` (`dpl_82zhug7jLBtFRQ6NECXXHKzYKsf1`)**, target production, ready
  in 16 s. First run of `--skip-domain` here: the public address kept `dpl_3DLFqLJxSx5iUitEU7j2EqKZP8Zg`; the
  candidate got the team alias `common-ground-sy22478.vercel.app`, which, like its own address, answers a plain
  request with a 302 to Vercel's login. So nothing public changed.
- **Step 6.** `GATE_URL=<candidate> GATE_PLAN=1 npm run gate:build`: 6 of 6. It names `1d76540`; planning on and
  open; counters in Redis; 18 private paths 404; one plan for the sample family in 18.0 s for $0.0120, held to the
  wording rules. Afterwards the public address still answered `"livePlanning":false` from `aukiltl2p`.

Spend on 2026-10-27 by the app's counters: $0.0588 in all (the gate $0.0468, the candidate $0.0120). Plan requests
from this machine that day: 9 of production's 10.

**"Promote" (11:20 to 11:22 UTC, on Sonu's word).**

- **Step 7.** `vercel promote https://common-ground-o3o01cslm-sy22478.vercel.app --yes`: "Success! common-ground was
  promoted to common-ground-o3o01cslm-sy22478.vercel.app (dpl_82zhug7jLBtFRQ6NECXXHKzYKsf1) [3s]". `vercel inspect`
  on the public address names that deployment, target production. First run of `vercel promote` here.
- **Step 8**, each once, on https://common-ground-beryl.vercel.app:
  - `GATE_URL=<public> GATE_SAME_AS=<candidate> npm run gate:build`: 5 of 5, the plan check skipped as it should.
    The public address serves `dpl_82zhug7jLBtFRQ6NECXXHKzYKsf1`, built from `1d76540`, planning on and open,
    counters in Redis.
  - `PLANNING=on BUILD=1d76540737a7e3153cae0c739980063551b9fd56 npm run demo:e2e:public`: 4 of 4.
  - `npm run demo:e2e:a11y`: 9 of 9.
  - No plan was made, and nothing was spent. No checkpoint page was met.
- **Still to come:** Sonu's own plan on his phone, over mobile data; the new take after 00:00 UTC (Sonu); the rest
  of step 9. `aukiltl2p` is kept: it is what `vercel rollback` returns to.
- **From now on the live build names `1d76540`, while `main` moves on with records.** A check held to the live
  build uses `BUILD=1d76540737a7e3153cae0c739980063551b9fd56`, not `$(git rev-parse HEAD)`.

### The fix of 2026-10-28: the same steps again

Sonu approved by name on 2026-10-28: in `lib/feedback.ts`, "artist", "song" and "album" count as "music", any other
word off the list is dropped, and the rest of Nano's reading is kept (commit `714341b`). His words: the browser
gate on the fixed commit on 2026-10-28 (UTC), and the candidate held until after 00:00 UTC on 2026-10-29.

- **Steps 1 and 2** as above, on the commit that carries this paragraph. Step 1's `git diff` is taken from
  `1d76540`, the commit last gated, and prints `lib/feedback.ts` alone. From here until step 8 `main` does not move;
  the results go on the side branch `drafts` in `../qloo-drafts`.
- **Plans per address:** this machine made 4 plan requests on 2026-10-28 before the gate (the two takes), and the
  gate makes 8 on previews, whose own setting allows 300. The candidate's plan and the take come on 2026-10-29,
  when production's count starts again from none. The `rate-limit` run goes first in a clock hour with no other
  plan request in it.
- **Steps 3 to 8 after 00:00 UTC on 2026-10-29**, each on Sonu's word. Step 4 is not needed: `LIVE_PLANNING=on` is
  stored for Production since 2026-10-27. At step 5 the public address must still name
  `dpl_82zhug7jLBtFRQ6NECXXHKzYKsf1` (`o3o01cslm`); after "Promote" that build is the one kept for a rollback.

**The browser gate on commit `d8f655b`** (2026-10-28, 02:34 to 03:00 UTC). Written on the side branch `drafts`;
`main` stays at `d8f655bfe21b8fb17165940af5e75636caac4634` until the promotion.

- **Step 1.** `git status` empty; `HEAD` equal to `origin/main`. The `git diff --stat` from `1d76540` names
  `lib/feedback.ts` alone (12 lines in, 4 out), the fix Sonu approved by name. The saved plan's digest begins
  `173a545d3b26`. `uv run scripts/check_sources.py` found every quote. `bash check.sh` passed, 285 tests.
- **Step 2.** Five previews of that commit, with the same settings as on 2026-10-27, all removed after the runs.

| Run | Preview | Result |
|---|---|---|
| `DEMO_CASE=paused`, first, while this machine's count for the day was 4 | `310hy8yhc` | Pass, $0 |
| `DEMO_CASE=qloo-down` | `q6ap5p12p` | Pass. $0.0008, 6 tool calls, done in 3.4 s |
| `DEMO_CASE=tavily-down` | `io4f11kgr` | Pass. $0.0167, 18.6 s |
| `GATE_URL=<preview> GATE_PLAN=1 npm run gate:build` | `4cjo7xbu1` (`dpl_Bj2CwZTE6GaaNuTio7UZN2ash48x`) | 6 of 6. The build names `d8f655b`; one plan for the sample family in 14.3 s for $0.0102 |
| `PREVIEW=1 PLANNING=on BUILD=<commit> npm run demo:e2e:public` | The same preview | 4 of 4 |
| `npm run demo:e2e` | The same preview | Pass, step 7 included: two artists ticked, the shape that failed in both takes that morning; music 2 to 4 and no film after the note. Plans in 19.3 s and 23.1 s, $0.0241 for both |
| `DEMO_URL=http://localhost:3213 npm run demo:e2e:a11y` | This machine's build of the same commit | 9 of 9 |
| `DEMO_CASE=rate-limit`, at 03:00:05, the first plan request of its clock hour | `4ljv85zti` | Pass, $0 |

**Spend, by the app's counters:** $0.0518 ($0.9751 to $1.0269). **Afterwards:** `vercel ls` lists the same nine
deployments as before the gate; `vercel env ls` lists `LIVE_PLANNING` for Production only, as since 2026-10-27, and
no cap, limit or `FORCE_ERRORS`; the public address still serves `dpl_82zhug7jLBtFRQ6NECXXHKzYKsf1`. The records of
each run are in `.qloo/gate/2026-10-28/` in the main folder. One scripted run passing does not show that Nano no
longer writes "artist"; the unit test shows that such a reply no longer loses "avoid".

**Bus 013: the limits per address, then the candidate (2026-10-28, 08:46 to 08:50 UTC).** In place of the wait for
00:00 UTC on 2026-10-29. Sonu's word in the machine's chat at about 08:40 UTC: "Let's change it to 20 per day - no
limits per hour - since we are close to the deadline. Please proceed". The machine had advised keeping 10, which stops
one address from spending most of the daily budget (bus 001, point 4); Sonu decided.

- **The limits.** `vercel env add IP_PLANS_PER_DAY production --value 20 --no-sensitive --yes`, and the same for
  `IP_PLANS_PER_HOUR`. Read against the code first: `lib/ratelimit.ts` counts every request, refused ones too, and
  refuses one when the count is above the limit, so 0 would allow none; the day's count is checked first, and an
  hour's count is never above its day's, so an hourly limit of 20 never binds. `vercel env ls` lists both, Config,
  Production only, beside the rows that were there before, unchanged. The values themselves were not read back. They
  reach new builds only: the live build `o3o01cslm` keeps 6 and 10 until the promotion.
- **Step 3.** The main folder clean at `d8f655b`, equal to `origin/main`; the freeze `git diff` from `1d76540` names
  `lib/feedback.ts` alone; the saved plan's digest `173a545d3b26`; the token renewed. Step 4 not needed.
- **Step 5.** The dry run named 53 files, the saved plan among them, and nothing from `.env*`, `.qloo`, `scripts`,
  `tests`, `e2e`, `.claude` or `submission`. Then `vercel deploy --prod --skip-domain --yes` at 08:48 UTC: **the
  candidate is `common-ground-adkum760d-sy22478.vercel.app` (`dpl_AyAGKZVPFDEtNdsbQXUfa9GSSPJ9`)**, target production,
  ready in about 25 s. The public address still names `dpl_82zhug7jLBtFRQ6NECXXHKzYKsf1`; a plain request to the
  candidate gets a 302 to Vercel's login.
- **Step 6.** `GATE_URL=<candidate> GATE_PLAN=1 npm run gate:build`: 6 of 6. It names `d8f655b`; planning on and open;
  counters in Redis; 18 private paths 404; one plan for the sample family for $0.0093, held to the wording rules. The
  plan was this machine's 13th request of the UTC day or later, which a limit of 10 would have refused, so the
  candidate carries the new limit. **The plan took 57.0 s,** against 14.3 s on the preview of the same commit that
  morning and 18.0 s on the candidate of 2026-10-27; the gate allows a minute. Vercel's log of the request shows a 200
  and nothing else. Just after, each service answered this machine fast: the Nemotron models in 1.4 to 2.1 s, one
  Tavily search in 1.5 s, one Qloo search in 0.5 s ($0.0007 on Token Factory, outside the app's counters; one Tavily
  credit; one Qloo call). The cause of the slow plan is not known.

**Spend, by the app's counters:** $0.0093 ($1.0269 to $1.0362). **Afterwards:** `vercel ls` lists ten deployments, the
nine before and the candidate; the public address serves `dpl_82zhug7jLBtFRQ6NECXXHKzYKsf1`. The gate's record is
`.qloo/gate/2026-10-28T084900304Z-common-ground-adkum760d-sy22478.json` in the main folder.

**Next, each on Sonu's word:** "Promote" (steps 7 and 8; `o3o01cslm` is then the build kept for a rollback), "New
take" (two plans), then the public commit again (its folder hashes change, and its README gives the new limit).
These records were written at 09:50 UTC, on bus 013b: the run of bus 013 stopped after step 6, before them.

**A second timing plan, then "Promote" (2026-10-28, 10:06 to 10:09 UTC).** Sonu's word: "Run one more timing plan on
the candidate first. If it arrives in under 30 seconds, Promote, then make the new take and prepare the public
commit."

- **The timing plan.** `GATE_URL=<candidate> GATE_PLAN=1 npm run gate:build` again, at 10:06 UTC: 6 of 6, the plan in
  **12.5 s** for $0.0110. The 57.0 s of 08:49 did not come back.
- **Step 7.** `vercel promote https://common-ground-adkum760d-sy22478.vercel.app --yes` at 10:07:57 UTC. `vercel
  inspect` on the public address names `dpl_AyAGKZVPFDEtNdsbQXUfa9GSSPJ9`, target production.
- **Step 8**, each once, on https://common-ground-beryl.vercel.app: the gate with `GATE_SAME_AS=<candidate>` 5 of 5,
  the plan check skipped as it should (built from `d8f655b`, planning on and open, counters in Redis); `PLANNING=on
  BUILD=d8f655bfe21b8fb17165940af5e75636caac4634 npm run demo:e2e:public` 4 of 4; `npm run demo:e2e:a11y` 9 of 9. No
  plan made; no checkpoint page met.
- **From now on the live build names `d8f655b`** and allows one address 20 plans a day. `o3o01cslm` is kept: it is
  what `vercel rollback` returns to. `main` moves again: `drafts` was merged into it after the promotion.
### Bus 014: the browser gate on commit `0373a0b` (2026-10-28, 13:29 to 13:36 UTC)

Sonu's word "Run the browser gate" came with bus 014, for after its steps 1 and 2 were pushed and only while the
UTC date is 2026-10-28. Written on the side branch `drafts`; `main` stays at
`0373a0bd197896674f4f957af1664ef64bf36a80` until the promotion.

- **Step 1.** `git status` empty; `HEAD` equal to `origin/main`. The `git diff --stat` of the frozen paths from
  `d8f655b`, the commit last gated, names `app/globals.css`, `app/page.tsx`, `lib/agent.ts`, `lib/qloo.ts`,
  `lib/server.ts` and `lib/tools.ts`: bus 014's steps 1 (the site's own Qloo allowance) and 2 (the result first).
  The saved plan's digest begins `173a545d3b26`, as before. `uv run scripts/check_sources.py` found every quote.
  `bash check.sh` passed, 287 tests.
- **Step 2.** Six previews of that commit, all removed after the runs (`vercel rm --safe`). New this time: the
  `qloo-allowance` case, on a preview with `FORCE_ERRORS=allowance`.

| Run | Preview and its settings | Result |
|---|---|---|
| `DEMO_CASE=rate-limit`, at 13:32, the first plan request of its clock hour | `9yf2yq9t4`: `-e LIVE_PLANNING=on -e IP_PLANS_PER_HOUR=2 -e PLAN_CAP_USD=0 -e IP_PLANS_PER_DAY=300` | Pass, $0 |
| `DEMO_CASE=paused` | `1j2aavmd5`: `-e LIVE_PLANNING=on -e TOTAL_CAP_USD=0.01` | Pass, $0. The saved plan is shown on arrival |
| `DEMO_CASE=qloo-down` | `ecv1d9rw2`: `-e LIVE_PLANNING=on -e FORCE_ERRORS=qloo -e IP_PLANS_PER_DAY=300 -e IP_PLANS_PER_HOUR=60` | Pass. $0.0008, 5 tool calls, done in 2.8 s |
| `DEMO_CASE=qloo-allowance` | `hfpd85k7y`: the same with `FORCE_ERRORS=allowance` | Pass. "Live planning is paused for today: this site has used its daily allowance of Qloo calls..." with the saved plan, and no "not answering" on the page. $0.0008, 2.1 s |
| `DEMO_CASE=tavily-down` | `lbbnzmv61`: the same with `FORCE_ERRORS=tavily` and `-e TAVILY_PER_DAY=60` | Pass. $0.0098, 12.4 s |
| `GATE_URL=<preview> GATE_PLAN=1 npm run gate:build` | `833fr9pf4` (`dpl_72kUicjiCwFqXyv8Fmayn8Z1BN9i`): `-e LIVE_PLANNING=on -e IP_PLANS_PER_DAY=300 -e IP_PLANS_PER_HOUR=60 -e TAVILY_PER_DAY=60` | 6 of 6. The build names `0373a0b`; one plan for the sample family in 16.3 s for $0.0136 |
| `PREVIEW=1 PLANNING=on BUILD=<commit> npm run demo:e2e:public` | The same preview | 4 of 4: the saved plan on arrival, its workings folded and opened with one click; the plan button on the first screen at 375 x 667 |
| `npm run demo:e2e` | The same preview | Pass. First step 0.9 s, bridge 12.9 s, plan 15.0 s; second plan 11.1 s; music 1 to 3 and no film after the note; $0.0208 for both |
| `DEMO_URL=http://localhost:3215 npm run demo:e2e:a11y` | This machine's build of the same commit | 9 of 9 |

**Spend, by the app's counters:** $0.0459 ($1.0704 to $1.1162). The site's Qloo count for the day went from 25 to
26. **Afterwards:** `vercel ls` lists none of the six; `vercel env ls` lists `LIVE_PLANNING`, `IP_PLANS_PER_DAY`
and `IP_PLANS_PER_HOUR` for Production, as since bus 013, and no cap, `FORCE_ERRORS` or `QLOO_CALLS_PER_DAY`; the
public address still names `d8f655b`. The records of each run are in `.qloo/gate/2026-10-28b/` in the main folder.
Next, each on Sonu's word after 00:00 UTC on 2026-10-29: "Build the candidate", "Promote", "New take".

**`QLOO_CALLS_PER_DAY=3000` for Production** (2026-10-28, 14:52 UTC), on Sonu's own command after this session's
permission check refused it: `vercel env add QLOO_CALLS_PER_DAY production --value 3000 --no-sensitive --yes`.
`vercel env ls` lists it for Production only. Not read back: the value is shown encrypted, and pulling the
Production variables to a file was refused. The public address still names `d8f655b`; the value reaches the
candidate.

### Bus 016: the browser gate on commit `697f03c`, the branch `bridge-grandparent` (2026-10-28, 17:46 to 18:01 UTC)

Sonu's word came with bus 016: the laptop free, the gate on the branch's head. The branch carries bus 015's rule (the
bridge only from the grandparent's side, a failed fame check said on the card) and bus 016's two sentences.
`bridge-grandparent` stays at `697f03c697f03c9518b7c00eb9376afa412bb780efabf60`; these records are on the side
branch `bridge-records`. `main` stays at `0373a0b`.

- **Step 1** (on `f0b806d`, then the check fix below). `git status` empty; `HEAD` equal to its upstream. The
  `git diff --stat` of the frozen paths from `0373a0b`, the commit last gated, names `app/page.tsx`, `lib/agent.ts`,
  `lib/bridge.ts`, `lib/plan.ts` and `lib/wording.ts`: the rule Sonu approved by name in bus 015. The saved plan in
  the branch's folders begins `a5ef93fe54d3`. `uv run scripts/check_sources.py` found every quote. `bash check.sh`
  passed, 290 tests.
- **A first round on `f0b806d`, from the worktree `../qloo-bridge`: not usable.** The five failure paths passed. Two
  checks failed, neither in the app: the gate's push check compared `HEAD` with `origin/main` (wrong on any branch:
  fixed to the folder's own upstream, commit `697f03c`, a check changed only where it was wrong); and every build
  named no commit (`"build": null`), because the Vercel CLI reads the commit from a `.git` folder and a git worktree
  has a `.git` file. Its six previews were removed. **Every run below is on `697f03c`, deployed from a full clone of
  the branch, `../qloo-gate`,** with its own install, the Vercel link and the branch's saved plan; its builds name
  `697f03c` (`/api/health` "build").

| Run | Preview and its settings | Result |
|---|---|---|
| `DEMO_CASE=paused` | `1rhlx4lyf`: `-e LIVE_PLANNING=on -e TOTAL_CAP_USD=0.01` | Pass, $0. The saved plan on arrival |
| `DEMO_CASE=qloo-down` | `nb9qq584k`: `-e LIVE_PLANNING=on -e FORCE_ERRORS=qloo -e IP_PLANS_PER_DAY=300 -e IP_PLANS_PER_HOUR=60` | Pass. $0.0008, 5 tool calls, 2.2 s |
| `DEMO_CASE=qloo-allowance` | `ef8x5hj76`: the same with `FORCE_ERRORS=allowance` | Pass. $0.0008, 2.5 s |
| `DEMO_CASE=tavily-down` | `b73qcv9oh`: the same with `FORCE_ERRORS=tavily` and `-e TAVILY_PER_DAY=60` | Pass. $0.0108, 12.3 s |
| `GATE_URL=<preview> GATE_PLAN=1 npm run gate:build` | `gqogcsxmn` (`dpl_9eQWHaghyeYW77fkxL5m6EKo64Jn`): `-e LIVE_PLANNING=on -e IP_PLANS_PER_DAY=300 -e IP_PLANS_PER_HOUR=60 -e TAVILY_PER_DAY=60` | 6 of 6. The build names `697f03c`; one plan for the sample family in 15.7 s for $0.0110 |
| `PREVIEW=1 PLANNING=on BUILD=<commit> npm run demo:e2e:public` | The same preview | 4 of 4 |
| `npm run demo:e2e`, first | The same preview | **Failed one step:** step 3, the bridge at 27.0 s against 25. Every other step passed: the failed fame check said on the card; music 2 to 4 and no film after the note. $0.0198 |
| `npm run demo:e2e`, once more | The same preview | Pass. Bridge 12.4 s, plan 16.1 s; second plan 18.1 s; music 2 to 4, no film. $0.0291 |
| `DEMO_URL=http://localhost:3217 npm run demo:e2e:a11y` | This machine's build of the same commit, in the clone | 9 of 9 |
| `DEMO_CASE=rate-limit`, at 18:00:06, the first plan request of its clock hour | `phtsybtpr`: `-e LIVE_PLANNING=on -e IP_PLANS_PER_HOUR=2 -e PLAN_CAP_USD=0 -e IP_PLANS_PER_DAY=300` | Pass, $0 |

**Spend, by the app's counters:** $0.0959 for both rounds ($1.1162 to $1.2121). **Afterwards:** `vercel ls` lists
none of the twelve previews; `vercel env ls` lists `LIVE_PLANNING`, `IP_PLANS_PER_DAY`, `IP_PLANS_PER_HOUR` and
`QLOO_CALLS_PER_DAY` for Production only; the public address still names `d8f655b`. The records are in
`.qloo/gate/2026-10-28c/` in the main folder. The 27.0 s bridge is not explained: the gate's plan on the same
preview just before took 15.7 s in all, and the run after it 12.4 s to the bridge.

**The merge, on Sonu's word** ("I accept the gate with the one slow step. Merge."). `main` fast-forwarded from
`0373a0b` to `697f03c` at 20:16:54 UTC and pushed at 20:17:57 UTC. The main folder's saved plan is replaced by the
branch's (digest `a5ef93fe54d3`); the old one (`173a545d3b26`) is kept as
`.qloo/saved-plan-173a545d3b26-before-bridge-merge.json`. `bash check.sh` in the main folder: 290 tests, the build,
the scans. `scan_qloo_data.py --new origin/main` found 4 names in `tests/fair-proof.live.test.ts`: favorites typed
for the invented families, committed in `ed878a7` before the proof's first Qloo call, and matched now because Qloo's
answers in `.qloo/` hold the same names. Both commits were on `origin` already (`bridge-grandparent`,
`bridge-records`), where the same scan finds nothing, so the push carried no new file. These records stay on
`bridge-records`: `main` stays at `697f03c` until the promotion.

### Bus 017: thirty plans a day from one address (2026-10-29, 01:33 to 01:41 UTC)

Sonu's word (bus 017, written 2026-10-28 21:52Z): "Let's keep working on Qloo by increasing the limit to 30 from 20."
`lib/config.ts` reads both variables with no upper bound, and `lib/ratelimit.ts` checks the day before the hour, so
30 and 30 keep no hourly limit below the daily one. Before: both 20, Production only. `DAILY_CAP_USD` is set in no
scope, so the schedule's $1.50 a day holds until 2026-11-02 17:00 UTC. The permission check refused my
`vercel env update`; Sonu ran, with `!`:

    vercel env update IP_PLANS_PER_DAY production --value 30 --yes
    vercel env update IP_PLANS_PER_HOUR production --value 30 --yes

Both answered "Updated", Production, type Config (01:33:09 and 01:40:44 UTC by `vercel env ls production --json`).
Read back in memory only, with nothing written to disk: `vercel env run -e production -- node -e '...'` printing only
the two variables gave `IP_PLANS_PER_DAY=30 IP_PLANS_PER_HOUR=30` (and `DAILY_CAP_USD` unset). No code, no other
variable, no deploy: the live build `adkum760d` still has 20; builds made from 01:41 UTC have 30.

**How the candidate check shows it with one plan, not 30.** The per-address count is shared by previews and
production (one `HASH_SECRET`), and a preview with `PLAN_CAP_USD=0` counts each valid request but stops it before its
first model call, at $0. On a UTC day when this address has made no plan request yet: 20 such requests to a preview
with `-e LIVE_PLANNING=on -e PLAN_CAP_USD=0 -e IP_PLANS_PER_DAY=300 -e IP_PLANS_PER_HOUR=300`, then the candidate's
own timing plan as the address's 21st. It goes through only if the candidate's limit is above 20; with 20 it is
refused at no cost. That leaves 9 for the take.

### The candidate of `697f03c` (2026-10-29, 02:24 to 02:30 UTC)

Sonu's word: "Build the candidate". Steps 3 to 6 of "Switching planning on", from the main folder.

- **Step 3.** The main folder clean at `697f03c`, equal to `origin/main`; the saved plan's digest `a5ef93fe54d3`. The
  freeze `git diff --stat` from `d8f655b`, the live build's commit, names `app/globals.css`, `app/page.tsx`,
  `lib/agent.ts`, `lib/bridge.ts`, `lib/plan.ts`, `lib/qloo.ts`, `lib/server.ts`, `lib/tools.ts` and `lib/wording.ts`:
  bus 014 (gated on `0373a0b`) and bus 015 (gated on `697f03c`). `vercel env ls`: `LIVE_PLANNING`,
  `IP_PLANS_PER_DAY`, `IP_PLANS_PER_HOUR` and `QLOO_CALLS_PER_DAY` for Production, and no cap or `FORCE_ERRORS`. The
  token was not renewed: nothing here used it. Step 4 not needed.
- **Step 5.** The dry run named 53 files, the saved plan among them, and nothing from `.env*`, `.qloo`, `scripts`,
  `tests`, `e2e`, `.claude` or `submission`. Then `vercel deploy --prod --skip-domain --yes` at 02:25:39 UTC: **the
  candidate is `common-ground-miq54mfzt-sy22478.vercel.app` (`dpl_6xwBiYnRTMnXCDkz9xMMDPtByAy8`)**, target
  production, ready in about 30 s. The public address still names `dpl_AyAGKZVPFDEtNdsbQXUfa9GSSPJ9` (`adkum760d`);
  a plain request to the candidate gets a 302 to Vercel's login.
- **The count before the plan**, a variant of the method above that needs no guess at the address's count: one
  preview, `owc0js1d5`, with `-e LIVE_PLANNING=on -e PLAN_CAP_USD=0 -e IP_PLANS_PER_DAY=20 -e
  IP_PLANS_PER_HOUR=300`, asked for the sample family through `vercel curl` until it refused. Requests 1 to 20, 02:27
  to 02:28 UTC: 200, each stopped with "cap" before its first model call, `costUsd` 0. Request 21: 429, "Please try
  again tomorrow", the day's limit. So this address's count started the day at 0 and stood at 21, and a limit of 20
  refuses the next. The preview was removed.
- **Step 6.** `GATE_URL=<candidate> GATE_PLAN=1 npm run gate:build` at 02:28 UTC: 6 of 6. It names `697f03c`;
  planning on and open; counters in Redis; 18 private paths 404; one plan for the sample family in **14.9 s** for
  $0.0092, held to the wording rules. That plan was this address's 22nd request of the day, so the candidate's
  limit is above 20: it carries the new variables (stored as 30 and 30). This address has 8 plans left today.

**Spend, by the app's counters:** $0.0092 ($1.2121 to $1.2213); no Qloo call (every answer from the cache), one Tavily
credit. **Afterwards:** `vercel ls` lists the candidate and the deployments before, and not the preview; the public
address serves `adkum760d`. The gate's record is `.qloo/gate/2026-10-29T022809966Z-common-ground-miq54mfzt-sy22478.json`
in the main folder. **Next, each on Sonu's word:** "Promote" (steps 7 and 8; `adkum760d` is then the build kept for a
rollback), "New take" (two plans, from this address's 8), the public commit.

**"Promote" (2026-10-29, 02:38 to 02:39 UTC, on Sonu's word: "Promote now").**

- **Step 7.** `vercel promote https://common-ground-miq54mfzt-sy22478.vercel.app --yes` at 02:38:01 UTC: "Success!
  common-ground was promoted to common-ground-miq54mfzt-sy22478.vercel.app (dpl_6xwBiYnRTMnXCDkz9xMMDPtByAy8) [3s]".
  `vercel inspect` on the public address names that deployment, target production; `/api/health` there names
  `697f03c`, planning on and open, counters in Redis.
- **Step 8**, each once, on https://common-ground-beryl.vercel.app: the gate with `GATE_SAME_AS=<candidate>` 5 of 5,
  the plan check skipped as it should; `PLANNING=on BUILD=697f03c9518b7c00eb9376afa412bb780efabf60 npm run
  demo:e2e:public` 4 of 4; `npm run demo:e2e:a11y` 9 of 9. No plan made, nothing spent; no checkpoint page met.
- **From now on the live build names `697f03c`** and allows one address 30 plans a day. `adkum760d` is kept: it is
  what `vercel rollback` returns to. `main` moves again: `bridge-records` was fast-forwarded into it after the
  promotion. A check held to the live build uses `BUILD=697f03c9518b7c00eb9376afa412bb780efabf60`.

### Bus 009: the gate on commit `4d4849f`, as a rehearsal for the switch (2026-10-13, 13:43 to 13:50 UTC)

Five test previews, each built from the clean, pushed commit with its settings on that deployment alone and
removed after its run. Every one named its commit in `/api/health`. `vercel env ls` lists no planning variable
afterwards, and production still answers with planning off from `dpl_3DLFqLJxSx5iUitEU7j2EqKZP8Zg`.

| Run | Preview and its settings | Result |
|---|---|---|
| `DEMO_CASE=rate-limit npm run demo:e2e:failures` | `qf5ilehfm`: `-e LIVE_PLANNING=on -e IP_PLANS_PER_HOUR=2 -e PLAN_CAP_USD=0 -e IP_PLANS_PER_DAY=300`, first in its clock hour | Pass, $0 |
| `DEMO_CASE=paused` | `4po38r4dy`: `-e LIVE_PLANNING=on -e TOTAL_CAP_USD=0.01` | Pass, $0. Health said `pausedFor` "total" |
| `DEMO_CASE=qloo-down` | `c9tcu4w94`: `-e LIVE_PLANNING=on -e FORCE_ERRORS=qloo -e IP_PLANS_PER_DAY=300 -e IP_PLANS_PER_HOUR=60` | Pass. $0.0008, 5 tool calls, done in 2.5 s |
| `DEMO_CASE=tavily-down` | `2o5ftxf3o`: the same with `FORCE_ERRORS=tavily` and `-e TAVILY_PER_DAY=60` | Pass. The plan arrives without events and says why. $0.0085, 12.3 s |
| `GATE_URL=<preview> GATE_PLAN=1 npm run gate:build` | `89uhp4x3i` (`dpl_2V1abFKxV3sZcP7QiBdHkVv1uodN`): `-e LIVE_PLANNING=on -e IP_PLANS_PER_DAY=300 -e IP_PLANS_PER_HOUR=60 -e TAVILY_PER_DAY=60` | 6 of 6. The build names commit `4d4849f`; planning on and open, counters in Redis; a bad request refused with 400; the recording as in this folder; 18 private paths 404; one plan in 14.8 s for $0.0109 |
| `vercel env run -- sh -c 'DEMO_URL=<preview> PREVIEW=1 PLANNING=on BUILD=<commit> npm run demo:e2e:public'` | The same preview | 4 of 4. Five requests to five new addresses were answered from one reading of the counters. The plan button is on the first screen |
| The same with `PLANNING=off BUILD=1163b47` | The same preview | 2 of 4, as it should: wrong commit, and planning is not closed |
| `vercel env run -- sh -c 'DEMO_URL=<preview> npm run demo:e2e'` | The same preview | 8 of 8. First step 0.2 s, bridge 13.4 s, plan 16.4 s; second plan 14.8 s; music 1 to 3, no film; four Qloo endpoints; $0.0240 |
| `DEMO_URL=http://localhost:3213 npm run demo:e2e:a11y` | This machine's build of the same commit | 9 of 9 |

Five plans and one forced failure, **$0.0443** by the app's counters ($0.8019 to $0.8462), no new Qloo call (all
answers came from the cache) and 4 Tavily credits.

**The health cache on a deployed build** (`vercel curl ... -s -i`, the same address asked four times): a miss at
13:48:38 with a reading of that second; a CDN hit at 46 s and at 53 s with the same reading (`age: 46`, `age: 53`);
a miss with a new reading at 65 s. A different address in between was a miss at the CDN and still carried the
first reading: the instance did not read the counters again. A browser receives `cache-control: public, max-age=0`;
Vercel keeps `s-maxage` for itself.

**The checks failing when they should** (no cost): the public check held to `PLANNING=on` against production, 2 of
4; held to this commit against production, 1 failed (production names no commit: it was built before builds did);
the gate against the old preview `doofewnm7`, 3 failed (no commit named, planning off, another recording);
`PREVIEW=1` with the public address stops before any test, so the token is not sent.

**Read on existing deployments, with no change** (13:25 UTC): a plain request to the own address of `aukiltl2p`
and of `heky0cciv`, both production builds, gets a 302 to Vercel's login; with the short-lived token, 403
`TRUSTED_SOURCES_ENVIRONMENT_MISMATCH`; through `vercel curl`, 200. The same token opens the preview `doofewnm7`.

### The public page, read only (`npm run demo:e2e:public`, no cost)

`e2e/public.spec.ts` makes no plan and changes no record, so it runs against production. Since bus 009 it is told
what to hold the page to: `PLANNING=on` or `PLANNING=off`, and `BUILD=<commit>`. Without them it follows what the
server says and notes that it did. It reads the preview token only with `PREVIEW=1`, and then refuses every address
but a deployment's own. On 2026-10-13 against production: 4 of 4 with `PLANNING=off`. With planning on, what it
checks is in the "Bus 009" table above.

As it was first run, on https://common-ground-beryl.vercel.app on 2026-10-11 at 16:56 UTC, 3 of 3:

| Check | Result |
|---|---|
| Planning is off | `/api/health`, fetched with a fresh address, says `livePlanning` false with `Cache-Control: no-store` (a build since 2026-10-13 sends `public, max-age=0` and says when its counters were read); `POST /api/plan` gets 503 "Live planning is switched off right now." |
| The saved plan | `/saved-plan.json` is identical to the file recorded on this machine |
| The page at 375 px | The paused notice is in view and there is no plan button. "See a plan this agent made" opens the recording with its note, Qloo's two affinities on the bridge card, three questions marked `lang="es"`, and no feedback card. The form opens, says planning is paused, and its button is disabled. The privacy section is there. No sideways scroll, no console error, no request to another server, and every request a GET |

Run first against a build with the old saved plan, it failed on the missing affinities, as it should.

### The form (`npm run demo:e2e:form`, no cost)

`e2e/form.spec.ts` answers the plan request itself, so it runs against any build without a model call. On the same
preview, 5 of 5:

| Check | Result |
|---|---|
| An empty form | Four plain messages, one per field; nothing sent; no sideways scroll at 375 px |
| A phone number among the favorites | Refused with "Tastes only, please..."; nothing sent |
| A filled form | The request holds the family and neither name; the plan shows both names, Qloo's two affinities, and `lang="hi"` on the question. The feedback request after it carries each card's kind and still no name |
| A reload | What was typed comes back from this browser's storage |
| Planning paused | The form says so and its button is disabled |

On commit `8e717c0` (run against the same build on this machine, since the plan request is answered by the test):
6 of 6. Two checks are new. A note with a phone number is refused on the page with "Only how the visit went,
please: no phone numbers, email addresses or links. This note is sent to the planner.", nothing is sent, and the
same note without the number goes through. And the privacy section lists its six headings in order.

The Vercel CLI hung after `vercel env add` in one long command: it had printed its success and was waiting on its
input. Every CLI call in a script now gets `</dev/null` and a `timeout`.

### Failure paths (2026-10-11, `npm run demo:e2e:failures`, one preview each)

| Case | Preview-only settings | Result | Cost |
|---|---|---|---|
| `rate-limit` | `LIVE_PLANNING=on`, `IP_PLANS_PER_HOUR=2`, `PLAN_CAP_USD=0` | Pass. Two plans stop with "This plan reached its cost limit before it finished."; the third gets "You have planned a lot of visits. Please try again in an hour." | $0 |
| `paused` | `LIVE_PLANNING=on`, `TOTAL_CAP_USD=0.01` | Pass. The paused notice shows before any click; the saved plan opens | $0 |
| `qloo-down` | `LIVE_PLANNING=on`, `FORCE_ERRORS=qloo` | Pass. "Qloo, where the taste data comes from, is not answering right now..." after one model call and 2 s | $0.0007 |
| `tavily-down` | `LIVE_PLANNING=on`, `FORCE_ERRORS=tavily` | Pass. The plan arrives without events, with "Web search is not answering, so this plan has no local events" | $0.0222 (a first try, $0.0352, failed on the test's own selector) |

Run each as `vercel env run -- sh -c 'DEMO_URL=<preview> DEMO_CASE=<case> npm run demo:e2e:failures'`. All the cases
also set `IP_PLANS_PER_DAY=60`, and the main run `IP_PLANS_PER_HOUR=30`: the counters are shared, so run `rate-limit`
first in a clock hour, and after a day of many runs give the previews a higher `IP_PLANS_PER_DAY`. Vercel adds its
own toolbar script (`vercel.live`) to previews; production has no such request.

All four were rerun on the rebuilt engine in bus 005 (table above). Production planning waits for Sonu's word.
