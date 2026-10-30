# Common Ground

Plan a visit a grandparent will love, from the tastes the two of you already share.

You give two short lists of favorites: your grandparent's and your own. Common Ground asks Qloo what those two tastes
have in common and returns a small plan for one visit:

- **One thing to start with** that both of you may love, with Qloo's affinity for each of you shown on the card.
- **Up to four things to do together**: music, a film, a dish from your own words, somewhere to go.
- **Three questions that open stories**, in your grandparent's language, with the English beside them.

After the visit you tick what landed and add a sentence. The next plan follows it: more of what landed, none of what
went badly, nothing repeated.

Live demo: https://common-ground-beryl.vercel.app. When live planning is paused, the page shows a real plan recorded
earlier and says so.

It is a helper for a family visit. It is not a medical tool, and it does not diagnose or treat anything.

## Why

A visit to an older relative matters, and it is easy to put off. The distance is real, and so is the worry about
what to say once you are there. Three figures, each in its source's own words, read on 2026-10-11:

- "While data on social isolation is more limited, it is estimated to affect up to 1 in 3 older adults and 1 in 4
  adolescents." People worldwide.
  [World Health Organization, news release, 30 June 2025](https://www.who.int/news/item/30-06-2025-social-connection-linked-to-improved-heath-and-reduced-risk-of-early-death)
- Asked "Thinking about all your grandchild(ren), how far (in miles) do you live from your grandchild(ren)?", the
  line "500 miles or more 29%". Grandparents in the United States, age 35 and older, asked in late 2025; they could
  name more than one distance.
  [AARP Research, Powering Families, annotated questionnaire, June 2026](https://www.aarp.org/content/dam/aarp/research/topics/social-leisure/relationships/essential-role-of-grandparents-annotated-questionnaire.doi.10.26419-2fres.00986.003.pdf)
- "Close to two-thirds (65%) of third- or higher-generation Latinos say they cannot carry on a conversation well in
  Spanish." Latino adults in the United States whose parents were also born there.
  [Pew Research Center, 20 September 2023](https://www.pewresearch.org/race-and-ethnicity/2023/09/20/latinos-views-of-and-experiences-with-the-spanish-language/)

Common Ground cannot shorten the distance. It can make the next visit easier to begin: it starts from what you both
already love, keeps the plan small, and writes the questions in their language. The page shows the same three
figures (`lib/sources.json`), and `uv run scripts/check_sources.py` fetches each page and looks for its words.

## How a plan is made

Three NVIDIA Nemotron models on Nebius Token Factory share the work, and rules in code check what they write. The
page marks every step of a run with who did it: Nano, Super, Ultra, or a rule.

| Step | Who does it | What happens |
|---|---|---|
| 1. Read the last visit | Nemotron 3 Nano (`nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`) | Only when there was an earlier visit. It reads what landed and the family's note, and says which kinds to have more of and which to leave out. Code turns that into rules the plan must meet |
| 2. Gather evidence | Nemotron 3 Super (`nvidia/nemotron-3-super-120b-a12b`), with tools | It looks up each favorite in Qloo, asks Qloo for films and artists that fit each person, asks what the two tastes share, looks for a place near the grandparent that serves a dish they named, and searches the web once for something local. Every tool call is checked against a schema; a wrong one goes back to the model with the reason. The calls of one reply run at the same time |
| 3. Choose the bridge | A rule in code, with Qloo | Qloo is asked how much the visitor's taste likes each thing it suggested for the grandparent. The bridge is the one of those whose lower affinity is highest: the best fit for both from the grandparent's world, judged by the less keen of the two. It is also held against the 50 things Qloo suggests to anyone: it should not be one of them, and each taste should like it more than the middle of them. When it does not pass, it is kept, and its card says so with the numbers |
| 4. Write the plan | Nemotron 3 Ultra (`nvidia/Nemotron-3-Ultra-550b-a55b`) | It writes the cards and five questions from the evidence only. The first draft is written without thinking, in two or three seconds. A draft the checks send back gets to think |
| 5. Check the plan | Rules in code | See below. Nothing reaches the page before it passes |
| 6. Put the questions in their language | Nemotron 3 Ultra, then Nemotron 3 Super for any question whose wording failed a check | Three of the five questions are shown, so a question that fails has a spare behind it |

Each model call is metered from the `usage` in its response. A plan stops at $0.06, and the site pauses at a daily
and a total cap. Measured on 2026-10-11: a plan costs about one US cent and, with Qloo's answers cached, arrives in
about ten seconds, the bridge first.

### Where Nebius Token Factory helped

Token Factory is the only Nebius service in use; the web app is hosted on Vercel. What it made easy, measured on
2026-10-05 and 2026-10-11 (`API_NOTES.md`):

- **One endpoint and one key for all three models.** They answer on the same OpenAI-compatible URL, so sending a
  step to a different model is a change of one string (`lib/llm.ts`).
- **Thinking is a switch on each call.** With it off for the first draft, the writing step went from 8 to 13
  seconds and about one cent to 2 to 3 seconds and a third of a cent. A draft the checks send back still thinks.
- **Prices far enough apart for routing to matter.** Giving each step to the smallest model that does it well, and
  running a reply's tool calls side by side, took a plan from 42 to 48 seconds and two to three cents down to 20
  to 27 seconds and under one cent, before any caching.
- **Usage on every response**, reasoning tokens included. The spending caps are built on it (`lib/spend.ts`).

## What the rules check

The models are asked to follow these, and the code makes sure of it (`lib/plan.ts`, `lib/wording.ts`,
`lib/tools.ts`).

- **Every card names something in the evidence it cites.** A title that Qloo or the web search did not return is
  left out or sent back.
- **The evidence decides what a card is, not the label the model gave it.** Something found only on a web page is
  shown as an event to check, with no date, time, price or street number on the card, and it is left out of a
  recorded plan. A web result must name the grandparent's city. A dish or an activity must share a word with what
  the family typed.
- **A search result is a favorite only if it is called what was asked for.** Qloo's search answers with whatever
  is nearest, so a habit in the family's own words can come back as a place that shares one word with it. Such a
  result is dropped: it becomes no signal, no step and no card.
- **A card does not say what either of them already loves, knows or lived**, unless one of their own favorites
  stands beside the claim. Everything Qloo suggests is put as a hope. A card whose sentence is taken out says a
  plain line, and no two cards of a plan say the same one.
- **A question does not assume a fact about their life**: no husband or wife, no relative, no hometown or country,
  no job, school or faith, unless the family's own words say it. No question tests memory.
- **A question in their language is checked for the slips a rule can see**: a wrong name, a changed title, a
  missing question mark, the wrong gender for the grandparent, the familiar form of address in Hindi. A rule cannot
  read grammar. The Spanish and the Hindi have not been read by a native speaker yet (`LANGUAGE_REVIEW.md`).

## Qloo

All taste data comes from the Qloo hackathon API, called from the server only (`lib/qloo.ts`, `lib/tools.ts`,
`lib/bridge.ts`).

| Endpoint | Used for |
|---|---|
| `/search` | Finding each favorite and its entity id |
| `/v2/insights` | Films and artists for each person from their own signals, films inside the years of the grandparent's youth; Qloo's affinity for a given list of items, which chooses the bridge; the 50 most popular of a type with no taste signal, which the bridge is held against; and places near the grandparent's city, filtered by a tag |
| `/v2/analysis/compare` | What the two tastes share: a genre, a theme, an instrument |
| `/v2/tags` | Turning a dish the family named into Qloo's tag for the kind of place that serves it. The place search then returns somewhere to eat it together, not the city's landmarks. The card shows Qloo's address for the place |

Qloo's answers are cached for a week under keys that cannot be turned back into what a visitor typed. No Qloo
response data is kept in this repository: the tests run on invented data.

## What is sent, and where

The page says the same, and `tests/privacy.test.ts` holds the code to it.

| Where | What |
|---|---|
| Stays on your device | The two names, and a copy of what you type in the form |
| NVIDIA Nemotron models on Nebius | The favorites, the birth year, the language, the city, grandmother or grandfather. After a visit: which suggestions landed, and your note |
| Qloo | The favorites, as search words, and the word for a dish you named. The years of the grandparent's youth and the age band "55 and older". The city, when it looks for places nearby. After a visit: the titles that landed |
| Tavily | One or two web searches, written from the city and the favorites. None when no city is given |
| Never sent to Qloo or Tavily | The language, grandmother or grandfather, and your note. The model that writes the searches is never given them |
| Kept by this site | Nothing you type. A one-way code for your network address, for rate limits, deleted within a day |

Contact details (an email address, a phone number, a link) are refused in every field, in the browser and again on
the server.

## Run it

You need Node 22.12 or later, a Nebius Token Factory key and a Qloo hackathon key. A Tavily key is optional: without
it plans have no local events.

```sh
npm ci
# Put NEBIUS_API_KEY and QLOO_API_KEY (and TAVILY_API_KEY, if you have one) in a file named .env.
# .env.example shows the names. The file is ignored by git.
LIVE_PLANNING=on npm run dev
```

Open http://localhost:3000. Without `LIVE_PLANNING=on` no model call is ever made, and the page says planning is
paused. A plan costs about one US cent. `DEPLOY.md` lists every variable, with the limits and their defaults.

Checks:

```sh
bash check.sh             # types, lint, unit tests, build, secret scans. Offline and free
npm run demo:e2e:form     # the form, in a browser, against a running build. No model call
npm run demo:e2e          # the scripted demo run against a deployed URL. Two real plans, about two cents
npm run demo:e2e:public   # the public page, with no plan made. PLANNING=on or off and BUILD=<commit> hold it to one
npm run gate:build        # one deployed build at its own address (GATE_URL=...): which commit it is, and that it plans
```

## Which commit is live

The live app's `/api/health` names the commit it was built from, as `build`. That is a commit of the private
repository the work was done in. The public repository, https://github.com/sy22478/common-ground, is a copy of that
commit's files in a single commit, with the notes brought up to date after the app went live and the working notes
left out, so the hash in `build` is not in its history. What can be compared is the code: git gives each folder a
hash of its contents, and these are the hashes of the folders the app is built from, in that commit.

```sh
git rev-parse HEAD:app   # a61b5a636fa15ef1980d2e88deebf0cfc48d22f8
git rev-parse HEAD:lib   # ddd5c4ca0405d6724ccdc522d9f727f8ce08a6e4
```

## What it does not do yet

- The questions in Spanish and Hindi have not been read by a native speaker.
- An event from the web is a lead to check, never a fact. The page says so on the card.
- Non-English films come back from Qloo with their English titles.
- Live planning is free and has limits: thirty plans a day from one address, and a daily budget for the site. When the
  budget is used up, the page says so and shows a plan recorded earlier, marked as a recording.

## Licence

Apache License 2.0. See [LICENSE](LICENSE).

## More

- `STACK_AND_GATE.md`: the stack, the limits, and the gate every build is scored against. `GATE.md` is the log.
- `API_NOTES.md`: what was measured on the real APIs, and what is sent where.
- `DEPLOY.md`: variables, deployments, and how each check is run.
- `submission/FAIR_PROOF.md`: the fair proof. Ten invented families; for each, Common Ground's bridge beside the
  pick of the strongest Nemotron model given the same facts with no Qloo. Counts only. The test that ran it is
  `tests/fair-proof.live.test.ts`.
- `RULES_NOTES.md`: the Qloo Agentic Hackathon's rules, with quotes. Common Ground is entered there only. It was
  also meant for the Nebius x NVIDIA Global AI Hackathon and was withdrawn on 2026-10-27, before anything was
  submitted there.
- The working notes (the progress log, the session notes and the submission drafts) are kept
  private, so a few mentions of them in these files lead nowhere in the public copy.
