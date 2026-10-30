# A fair proof: what Qloo finds that a model alone does not

Bus 014, step 4. The method and the measures were fixed on 2026-10-28 at about 13:50 UTC and committed before the
first run. The results per family hold Qloo's answers, so they stay in `.qloo/fair-proof/` and out of git; this
file gets the counts only. The run: `FAIR_PROOF=1 npx vitest run --config vitest.live.config.ts
tests/fair-proof.live.test.ts`.

## The families

Ten invented families of mixed languages and cultures, in `tests/fair-proof.live.test.ts`. No real person's data:
each is a relation, a birth year, a language, a city, and favorites that are public works and public names. The
first is the sample family on the page.

## The two picks, from the same facts

- **A plain model.** Nemotron 3 Ultra, with no Qloo and no tools, thinking on, temperature 0, one call. It is given
  what the agent is given: grandmother or grandfather, the birth year, the language, the city, the grandparent's
  favorites and the visitor's. It is asked for the one film, TV show, music artist or book the two may both love,
  as JSON with a title, a kind and a year.
- **Common Ground.** Its own evidence and bridge steps, unchanged: `gatherEvidence` (Nemotron 3 Super with the Qloo
  tools) and then `chooseBridge` (the rule: the candidate whose lower affinity is highest, held off what Qloo
  suggests to anyone). Web search is stubbed to return nothing: the bridge does not use it.

## The measures

1. **Same pick or not.** The same Qloo id, or the two titles name the same thing (`isSameName` in
   `lib/evidence.ts`, either way round).
2. **Fame.** The plain pick's place in what Qloo suggests to anyone for its kind (`famous`: the 50 most popular,
   asked with no taste signal), or "not in the 50". Qloo's pick is kept off that list by its rule, so this
   measures the plain model only.
3. **Her youth.** Whether each pick's year falls in the grandparent's youth window, the birth year plus 10 to 30
   (`youthWindow` in `lib/family.ts`). Qloo's year from its own data; the plain pick's year from Qloo's search for
   its title (the first result of that name), else the model's own year, marked so. No year (most artists): not
   counted.
4. **Secondary, and not proof: Qloo grading itself.** Qloo's affinity for the plain pick with each person's
   favorites, and the lower of the two, beside the bridge's. It shows whether, by Qloo's data, the plain pick
   leaves one of them lukewarm. It cannot show that Qloo is right.

**Reported:** in how many of the ten the picks differ; of those, how many plain picks are among the 50 most popular;
how many picks of each side fall in her youth window. Whatever the rate is.

**The strongest real case**, chosen by this rule after the run: the picks differ, the plain pick is among the 50
most popular (the higher its place, the stronger), and Qloo's pick is from her youth; ties go to the higher lower
affinity of Qloo's pick.

## Spend

Its own counters: a store in memory, a spend guard with a hard stop at $0.15 in all, and its own Qloo count. The
live site's Redis counters, its daily Qloo allowance and its plan counts are not touched. The key's monthly Qloo
quota is shared: about 300 of the 49,940 left. If the testing line would be passed, the run stops and the amount
needed is reported.

## The result (run 2026-10-28, 13:42 to 13:47 UTC; the rerun at about 14:00 UTC)

Counts only: the titles are Qloo's answers and stay in `.qloo/fair-proof/2026-10-28.json` and
`2026-10-28-rerun.json`. **Spent: $0.1209, then $0.0544 for the rerun, $0.1753 in all,** on the proof's own
counters. The live site's counters did not move ($1.1162 in all, 26 Qloo calls and 10 Tavily credits on the day,
before and after).

- **The plain model answered in 7 of 10.** In 3, Nemotron 3 Ultra thought until its limit of 3,000 tokens and gave
  no pick. The rerun declared in the test (commit `40e6f35`) asked those 3 again with room for 6,000 tokens: all 3
  were cut again. One left a title in its cut-off text; it is not counted, since it may be a draft and not the
  answer. The first run did not record why a reply ended; the 7 that answered cost less than a cut reply does.
- **1. Same pick:** the same in 1 of 7 (the sample family); different in 6 of 7.
- **2. Fame:** 0 of the 7 plain picks are among the 50 most popular of their kind. The plain model does not lean on
  what is famous. Of Qloo's 10 bridges, 9 passed the rule's own check against that list; in 1 no candidate passed
  and the best was taken anyway.
- **3. Her youth:** 9 of Qloo's 10 bridges are artists, which have no year, so the measure cannot be taken for
  them; the one film is not from her youth. Of the 7 plain picks, 1 is from her youth (its year from the model, as
  Qloo did not find it), 6 are not. This measure shows nothing in Qloo's favour.
- **4. Secondary, Qloo grading itself:** in the 4 families where the picks differ and Qloo found the plain pick,
  Qloo scores its own bridge higher with the grandparent's favorites in all 4 (by 0.02 to 0.27). This is Qloo
  marking its own work and proves nothing.
- **Also seen:** 4 of the 7 plain picks are one of the grandchild's own favorites, given back as the thing to share.
- **The strongest case by the rule fixed above:** none. No plain pick is among the 50 most popular, and no Qloo pick
  has a year in her youth.

**What it shows, in plain words.** Given the same facts, Common Ground's bridge is nearly always different from what
the strongest Nemotron model suggests on its own (6 of 7), in 9 of 10 it passes the rule's check against what Qloo
suggests to anyone, and it is usually an artist found through both tastes, where the model alone most often hands back a favorite the grandchild
already named. It does not show that Qloo's pick is the better one for the family: no measure here can, and only a
family can say.

## The rule changed (bus 015, 2026-10-28)

Sonu chose the bridge from the grandparent's side only (commit `eb95e10` on the branch `bridge-grandparent`). The
replay of the ten families, the same Qloo questions with no model ($0; 171 Qloo calls on its own counters), under
that rule: **all 10 bridges come from what Qloo suggested for the grandparent, and all 10 are the ones the replay
found for the rule before it was written.** 4 of 10 differ from the bridge under the old rule (the 4 that came from
the grandchild's side). 7 pass the check against what Qloo suggests to anyone; 3 do not, each on the grandchild's
side (below or level with the middle there), and their cards now say so with the numbers. The sample family is one
of the 3. The titles stay in `.qloo/fair-proof/2026-10-28-bridge-new.json`.
