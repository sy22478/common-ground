# Rules notes

**Common Ground is entered in the Qloo Agentic Hackathon only.** It was first planned for the Nebius x NVIDIA Global
AI Hackathon as well. On 2026-10-27 at 18:19 UTC the Qloo hackathon manager answered "1. No" to entering it there
with the Qloo hackathon key, and "2. Those are not our hackathon dates" to keeping the key active until that
hackathon's judging ended on December 15. The project was withdrawn from the Nebius hackathon the same day, before
anything was submitted there. The notes on that hackathon are left out of this public copy. The app still runs on
NVIDIA Nemotron models on Nebius Token Factory: that is a technical choice, not an entry.

Read in full on 2026-10-04 (UTC): the official rules page, the overview, the resources, updates and schedule pages,
the Qloo hackathon developer guide and the Qloo hackathon kit (github.com/qloo/qloo-hackathon-kit). Rules can change
("The terms and conditions of the Official Rules are subject to change at any time"), so the rules page is read
again before the submission.

Re-read on 2026-10-11 (UTC): the Qloo developer guide only. Its page says it was updated on 2026-10-07, and it now
states when keys are deactivated and forbids Qloo response data in a public repository (flags 1 and 8).

Re-read on 2026-10-11 (about 22:15 UTC) and again on 2026-10-12 (17:14 UTC), for the submission drafts: the rules
page, the overview, the updates, schedule and resources pages. What the re-read adds is under "Re-read for the
submission drafts" below. Not seen: the "Enter a Submission" form, which needs the entrant's Devpost login.

Sources:
- https://qloo.devpost.com/rules, https://qloo.devpost.com/, https://qloo.devpost.com/resources
- https://docs.qloo.com/reference/qloo-llm-hackathon-developer-guide
- https://github.com/qloo/qloo-hackathon-kit (README, docs/API_ACCESS.md, docs/SAFE_USE.md, docs/SUBMISSION.md)

## Answers to the kickoff questions

### 1. What counts as "integrates the Qloo API"

A working app that calls the Qloo API at runtime and is agentic in one of three ways. Stage one is a pass or fail test
of whether it "reasonably applies the required APIs". Stage two scores how thoroughly Qloo is used. The overview adds
that the project must not work the same without Qloo.

> Source: https://qloo.devpost.com/rules, section 4 "Project Requirements":
> "Entrants must create a working software application that integrates the Qloo API and that either
> (a) functions as an agentic tool, (b) is built using an agent framework, or (c) integrates the Qloo API into an
> existing agent"

> Source: https://qloo.devpost.com/ (overview), "Requirements":
> "the agent should outperform generic LLM-only approaches because it has access to Qloo's API and
> taste graph (250M+ entities). If your submission would work the same without Qloo, you're building the wrong thing."

> Source: https://qloo.devpost.com/rules, section 6 "Judges & Criteria" (same wording on the overview):
> "Technological Implementation: How thoroughly and skillfully does the project use Qloo? Does the code
> reflect genuine effort and a working, non-trivial implementation?"

Practical reading: live calls to `https://hackathon.api.qloo.com` (header `X-Api-Key`) to several endpoints
(`/search`, `/v2/tags`, `/v2/insights`, `/v2/analysis/compare`, `/v2/trending`, `/v2/audiences`), with Qloo results
visibly driving what the user gets, and the source of each result shown. The legacy `/recommendations` and `/recs`
endpoints are "not supported for the hackathon"
(https://docs.qloo.com/reference/qloo-llm-hackathon-developer-guide). The kit
(https://github.com/qloo/qloo-hackathon-kit, docs/API_ACCESS.md) says its supported surfaces are the
`@qloo/qloo-harness` CLI and MCP server. The developer guide documents plain REST calls. Both look acceptable; REST
is simpler to host.

### 2. Support from the sponsor

> Source: https://qloo.devpost.com/rules, section 4 "Financial or Preferential Support":
> "A Project must not have been developed, or derived from a Project developed, with financial or preferential
> support from the Sponsor or Administrator."

Qloo's free hackathon key is offered to every entrant, so it is not preferential.

### 3. Whether a video is needed

> Source: https://qloo.devpost.com/ (overview), "What to Submit":
> "Demo videos are not required. Instead of asking for a recording, we're requiring something judges
> can actually use."

> Source: https://github.com/qloo/qloo-hackathon-kit, docs/API_ACCESS.md and docs/SUBMISSION.md: never put a
> credential in "a demo recording"; demos and screenshots must "contain no credential or personal data".

## Flags

1. **How long the Qloo key lives.** The guide, as updated on 2026-10-07:

   > Source: https://docs.qloo.com/reference/qloo-llm-hackathon-developer-guide, "Quotas, Limits & Key Expiration"
   > (read 2026-10-11): "Keys remain active through the end of the judging period and are deactivated after the
   > hackathon closes."

   So the demo can plan through Qloo's judging, which ends 2026-11-06 04:45 UTC. The same guide allows "Private
   server-side caching ... there is no time limit on how long you can keep cached responses"; the app's cache lasts
   7 days.
2. **Use of the Qloo key in another hackathon.** Settled on 2026-10-27: no (the top of this file).
3. **Eligibility: confirmed by the entrant on 2026-10-05 UTC (age, residence, employer).** The rules, section 3
   "Eligibility": "at least the age of majority where they reside". Excluded: residents of "Brazil, Quebec, Russia,
   Crimea, Cuba, Iran, and North Korea" and other OFAC-sanctioned places, and "Any Judge ... or company or individual
   that employs a Judge". Judges' employers include Qloo, Live Nation and Eldridge Industries. Also excluded:
   employees of the sponsor or Devpost and their immediate family or household.
4. **Trademarks and images.** The app shows no posters, album art or brand logos: the result cards are text only,
   and the video's only sound is its narration.
5. **Uptime and spend through judging.** The rules, section 4 "Testing": "The Entrant must make the Project
   available free of charge and without any restriction" for judging, so no paywall. A login is allowed only if
   credentials go in the testing instructions. The live demo, the keys and the credits must last until 2026-11-06
   04:45 UTC, with judges and the public using them, so every paid call has a rate limit and a spend cap.
6. **Qloo safe-use terms shape the idea** (kit docs/SAFE_USE.md): do not send "names, email addresses, device
   identifiers, account IDs, location histories, or other personal data to Qloo"; do not use results "to infer a
   person's identity, sensitive traits, health, financial status, political views"; "Distinguish a Qloo result from
   your own product interpretation, and do not describe an affinity as a causal claim or a probability about an
   individual." Send Qloo only entity names, tags and city-level locations.
7. **Hosting with the Qloo harness.** The kit's MCP starter says "Serverless functions are not a supported route";
   its MCP server needs a long-running backend. Plain REST calls have no such limit, so the app calls REST.
8. **No Qloo response data in a public repository (found 2026-10-11).**

   > Source: https://docs.qloo.com/reference/qloo-llm-hackathon-developer-guide, FAQ "Can I cache Qloo API responses
   > in my app?" (read 2026-10-11): "Private server-side caching is fine and there is no time limit on how long you
   > can keep cached responses. Do not store Qloo response data in a public repository — that makes the data publicly
   > accessible outside the terms of your API key."

   What was done about it:
   - This public repository is a fresh copy with one commit, so the working history, which holds real responses,
     does not travel with it.
   - Real responses stay in the ignored `.qloo/` folder. Tests pin the real response shapes with invented values, and
     the engine recording stays on synthetic Qloo data.
   - The saved plan (`public/saved-plan.json`) holds titles Qloo returned, so git ignores it. A CLI deploy still
     uploads it, and the demo page shows it, marked as a recording. It is not in this repository.
   - API_NOTES.md and `submission/FAIR_PROOF.md` give counts and judgments, not the titles and places returned.
9. **Live planning in production.** Off when the drafts were written (below); on since 2026-10-27 11:21 UTC, and on
   through judging.

Smaller notes:
- Qloo's schedule page says submissions open 9:30 am EDT; the rules say 9:00 am. No effect.
- The rules' "New & Existing" clause is garbled ("must have Qloo 4after the start"). No effect: the project is new.
- Qloo judging may use "automated AI-driven analysis". A clear README and description help.
- The rules allow third-party technical help if the work is the entrant's and the entrant owns it. The project was
  built with an AI coding assistant, and the description says so.
- Participants: 331 on 2026-10-04, 1,192 on 2026-10-12.

## Re-read for the submission drafts (2026-10-11 and 2026-10-12)

Nothing in the rules contradicts the notes above, and no clause on help from an AI tool has been added. Qloo's
updates page is still empty. What is new here, or was not quoted before:

1. **The entry is held to its own description.**

   > Source: https://qloo.devpost.com/rules, section 4 "Functionality": "The Project must be capable of being
   > successfully installed and running consistently on the platform for which it is intended and must function as
   > depicted in the video and/or expressed in the text description."

   So the text and the video must say plainly what is live and what is a recording, on the day they are submitted.
2. **Judges need not open the demo.**

   > Source: https://qloo.devpost.com/rules, section 4 "Testing": "Judges are not required to test the Project and
   > may choose to judge based solely on the text description, images, and video provided in the Submission."

   The text and the pictures carry the entry for a judge who does not open the page.
3. **Qloo asks for a demo that can be tried.**

   > Source: https://qloo.devpost.com/ (overview), "What to Submit": "A link to a functional demo application"; "A
   > live, working app participants can try end-to-end. This should demonstrate the core features of your project."

   When the drafts were written, live planning was off in production, and a judge would have seen a recorded plan and
   a paused form (flag 9). It has been on since 2026-10-27.
4. **Qloo's bonus prize.**

   > Source: https://qloo.devpost.com/ (overview), prizes: "will personally invest an additional $25,000 into his
   > favorite entry" (said of the judge Jason Calacanis).

   An investment, not a cash prize. The rules page lists the three cash prizes only.

## Re-read on 2026-10-27

The rules page fetched again on 2026-10-27 at about 10:20 UTC, section 1 and section 5.

- **Qloo's judging is shorter.** > Source: https://qloo.devpost.com/rules, section 1: "Judging Period:", from "November
  2, 2026 (12:00 pm Eastern Time)" to "November 5, 2026 (11:45 pm Eastern Time)" and "Winners Announced: On or around
  November 5, 2026 (3:00 pm Eastern Time)." On 2026-10-12 it read November 16 and November 23. Devpost's mail of
  2026-10-21, as relayed to these notes: "On November 5th, the Top 3 Finalists will appear on air" with the judges,
  who pick the winner live.
- **The submission locks at the deadline.** Section 5: "Once the Submission Period has ended, you may not make any
  changes or alterations to your Submission, but you may continue to update the Project in your Devpost portfolio."
  The project must also be available "free of charge and without any restriction ... until the Judging Period ends".
- **What the shorter window does to the budget schedule** (`lib/config.ts`): its step "Qloo judging ends" is still
  at 2026-11-17 04:45 UTC, so the daily cap stays $3.00 from 2026-11-06 to 2026-11-17 instead of falling to $1.50.
  Left as it is. Live planning is to be switched off by hand after Qloo's judging ends (DEPLOY.md).

## Deadlines (UTC)

| Event | Local time in rules | UTC |
|---|---|---|
| Submissions close | Fri Oct 30, 11:45 pm EDT | **2026-10-31 03:45** |
| Judging (rules read 2026-10-27) | Nov 2, 12:00 pm EST to Nov 5, 11:45 pm EST | 2026-11-02 17:00 to 2026-11-06 04:45 |
| Winners, and the final on air | on or around Nov 5, 3:00 pm EST | 2026-11-05 20:00 |

The demo must stay live until judging ends, 2026-11-06 04:45 UTC. The budget schedule in `lib/config.ts` also has
steps for the Nebius hackathon's judging, 2026-12-01 17:00 to 2026-12-15 20:00 UTC, from before the withdrawal.

## Deliverables checklist

| Item | Required |
|---|---|
| Live, externally hosted demo URL | Yes ("Submissions that only run locally or rely on private access will not qualify") |
| Public repo (GitHub, GitLab, Bitbucket) with all source, assets, instructions | Yes |
| Open-source license file visible in the repo's About section | Yes |
| Text description | Features, and "what makes it Qloo-powered" |
| README with setup instructions | Implied by "instructions" |
| Demo video | Not required |
| Testing access free and unrestricted until judging ends | Until 2026-11-06 04:45 UTC |
| English | Yes |

## Judging

Stage one is pass or fail on theme fit and use of the required APIs; stage two has four equally weighted criteria.
Ties go to the first criterion, Technological Implementation.

| Criterion | Qloo asks |
|---|---|
| Technological Implementation | "How thoroughly and skillfully does the project use Qloo?" |
| Design | "a complete, coherent product experience, not just a technical proof of concept" |
| Potential Impact | "a credible, specific case for solving a real problem for a real audience" |
| Quality of the Idea | "a creative, non-obvious use of Qloo" and "genuine understanding of the problem space" |

Judges: Jason Calacanis, Mike Diolosa (CTO, Qloo), Nicole Seligman (OpenAI board), Todd Boehly (Eldridge), Cedric the
Entertainer, Michael Abrams (Live Nation).

## IP and license

> Source: https://qloo.devpost.com/rules, section 7 "Intellectual Property Rights":
> "All Submissions remain the intellectual property of the individuals or organizations that
> developed them. By submitting an entry, entrants agree that the Sponsor will have a non-exclusive license to use
> such entry for judging the entry."

The sponsor also gets the right to promote the submission and use entrants' "name, likeness, voice and image" for
three years. The submission must be "solely owned by" the entrant and must not infringe others' rights. Open-source
components are allowed if their licenses are followed and the project builds on them. Our code license: Apache 2.0
(chosen 2026-10-05 UTC); the canonical text is in LICENSE. The NVIDIA model licenses govern the models, not our code.

## Credits and keys

- Qloo: key by email after the request form; "typically issued within a few business days"; valid only against
  `https://hackathon.api.qloo.com`. Rate limits "set high enough to support typical hackathon projects".
  - The key email is dated 2026-10-06. It names the server URL and a docs link, and says nothing about quota, expiry
    or terms of use.
  - Limits read from the response headers on 2026-10-11: 5 calls a second and 10,000 a month (API_NOTES.md). The
    guide says limits "can be raised on a per-user basis" by asking in Discord #api-help.
