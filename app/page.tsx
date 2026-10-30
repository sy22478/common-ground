"use client";

import { useEffect, useRef, useState } from "react";
import type { AgentEvent, Doer } from "@/lib/agent";
import { noteProblem, SAMPLE_FAMILY, type Family } from "@/lib/family";
import type { FinalPlan } from "@/lib/plan";
import { isShowableSavedPlan, type SavedPlan } from "@/lib/saved";
import { SOURCES } from "@/lib/sources";
import { FamilyFormView, type Names } from "./family-form";

// Names live only here, in the browser. The server receives roles and favorites.
const SAMPLE_NAMES: Names = { grandparent: "Rosa", visitor: "Leo" };
// For the lang attribute on the questions, so a screen reader pronounces them in the right language.
const LANG: Record<string, string> = { spanish: "es", hindi: "hi", mandarin: "zh", cantonese: "yue", tagalog: "tl", vietnamese: "vi", korean: "ko", arabic: "ar", russian: "ru", ukrainian: "uk", polish: "pl", portuguese: "pt", italian: "it", french: "fr", german: "de", greek: "el", japanese: "ja", punjabi: "pa", bengali: "bn", urdu: "ur", farsi: "fa" };

type Step = { text: string; ok: boolean; by?: Doer };
// For the line that holds the bridge against what Qloo suggests to anyone.
const MANY: Record<string, string> = { film: "films", show: "shows", artist: "artists", book: "books" };
// Who did a step. The three models are NVIDIA Nemotron 3, called on Nebius Token Factory; a rule is plain code.
const DOER: Record<Doer, string> = { nano: "Nano", super: "Super", ultra: "Ultra", rule: "Rule" };

export default function Home() {
  const [family, setFamily] = useState<Family>(SAMPLE_FAMILY);
  const [names, setNames] = useState<Names>(SAMPLE_NAMES);
  const [own, setOwn] = useState(false); // the form for the visitor's own family, opened by a click
  const [steps, setSteps] = useState<Step[]>([]);
  const [plan, setPlan] = useState<FinalPlan | null>(null);
  // The bridge arrives before the rest of the plan and is shown at once.
  const [early, setEarly] = useState<Pick<FinalPlan, "bridge" | "evidence"> | null>(null);
  // (The bridge event comes twice when Qloo's numbers choose it: at once with a plain line, then with its own words.)
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [landed, setLanded] = useState<Record<string, boolean>>({});
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [saved, setSaved] = useState<SavedPlan | null>(null);
  const [savedFrom, setSavedFrom] = useState<string | null>(null);
  const [savedLeftOut, setSavedLeftOut] = useState(0);
  // Set once a live plan is asked for, so the saved plan, which loads on arrival, never replaces it.
  const started = useRef(false);

  // Ask once whether live planning is available, and load the saved plan. The saved plan is shown on arrival, so the
  // result is the first thing anyone sees; a live plan replaces it.
  useEffect(() => {
    fetch("/api/health", { cache: "no-store" })
      .then((r) => r.json())
      .then((h: { planningOpen?: boolean }) => setPaused(h.planningOpen === false))
      .catch(() => setPaused(true));
    fetch("/saved-plan.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: unknown) => {
        const showable = isShowableSavedPlan(data) ? data : null;
        setSaved(showable);
        if (showable && !started.current) display(showable);
      })
      .catch(() => setSaved(null));
  }, []);

  // A real plan this agent made earlier, clearly labelled as saved.
  function display(recorded: SavedPlan) {
    setNames(SAMPLE_NAMES); // the saved plan is the sample family's
    setSteps(recorded.steps.map((text, i) => ({ text, ok: true, by: recorded.by?.[i] })));
    setPlan(recorded.plan);
    setSavedFrom(recorded.recordedAt.slice(0, 10));
    setSavedLeftOut(recorded.leftOut ?? 0);
  }

  // When planning stops part way (paused, or this site's Qloo allowance spent): say why, and show the saved plan.
  function showSaved(reason: string) {
    if (!saved) {
      setNotice(reason);
      return;
    }
    setNotice(`${reason} Below is a plan this agent made earlier.`);
    display(saved);
  }

  async function makePlan(input: Family) {
    started.current = true;
    setBusy(true);
    setSteps([]);
    setPlan(null);
    setEarly(null);
    setNotice(null);
    setSavedFrom(null);
    try {
      const response = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok || !response.body) {
        const data = (await response.json().catch(() => null)) as { message?: string } | null;
        const message = data?.message ?? "Planning is not available right now.";
        if (response.status === 503) {
          setPaused(true);
          showSaved(message);
        } else setNotice(message);
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame.split("\n").find((l) => l.startsWith("data: "));
          if (line) handle(JSON.parse(line.slice(6)) as AgentEvent);
        }
      }
    } catch {
      setNotice("The connection dropped. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function handle(event: AgentEvent) {
    if (event.type === "step") setSteps((s) => [...s, { text: event.text, ok: true, by: event.by }]);
    if (event.type === "tool") setSteps((s) => [...s, { text: event.summary, ok: event.ok, by: event.by }]);
    if (event.type === "bridge") setEarly({ bridge: event.bridge, evidence: event.evidence });
    if (event.type === "plan") {
      setPlan(event.plan);
      setLanded({});
      setNote("");
      setNoteError(null);
    }
    // This site's own Qloo allowance is spent: paused for today, as when the budget is, with the saved plan shown.
    if (event.type === "error" && event.code === "allowance") {
      setPaused(true);
      showSaved(event.message);
    } else if (event.type === "error") setNotice(event.message);
  }

  function planNext() {
    if (!plan) return;
    // The note goes to the planner's models, so contact details are refused here, before anything is sent. The
    // server refuses them again.
    const problem = noteProblem(note);
    setNoteError(problem);
    if (problem) return;
    // Each card goes back with its kind, so the agent knows a film from a singer. Unticked is not "disliked": it
    // may not have been tried, and the note says what went wrong.
    const cards = [plan.bridge, ...plan.moments].map(({ title, kind }) => ({ title, kind }));
    const next: Family = {
      ...family,
      history: [
        ...family.history,
        { landed: cards.filter((c) => landed[c.title]), rest: cards.filter((c) => !landed[c.title]), note: note.trim() || undefined },
      ].slice(-5),
    };
    setFamily(next);
    void makePlan(next);
  }

  const first = plan ?? early;
  const evidenceLabel = (id: string) => first?.evidence.find((e) => e.id === id)?.label ?? id;
  // The web pages behind a card, so "check before you go" is one click. Only plain web links are ever shown.
  const sources = (ids: string[]) =>
    ids
      .flatMap((id) => plan?.evidence.find((e) => e.id === id)?.urls ?? [])
      .flatMap((u) => {
        try {
          const url = new URL(u);
          return url.protocol === "https:" || url.protocol === "http:" ? [{ href: url.href, host: url.hostname.replace(/^www\./, "") }] : [];
        } catch {
          return [];
        }
      })
      .slice(0, 3);
  // The planner writes {grandparent} and {visitor}; names are filled in here, on the device.
  const named = (text: string) => text.replaceAll("{grandparent}", names.grandparent).replaceAll("{visitor}", names.visitor);
  // The bridge held against what Qloo suggests to anyone, passed or not, with the numbers either way.
  function fameLine(b: FinalPlan["bridge"]): string {
    const line = b.beyondFame ?? b.fameMissed;
    if (!line) return "";
    const head = `For scale: the ${line.of} ${MANY[b.kind] ?? "things"} Qloo suggests to anyone score ${line.grandparent.toFixed(2)} with ${names.grandparent}'s favorites and ${line.visitor.toFixed(2)} with ${names.visitor}'s at the middle.`;
    if (!b.fameMissed) return `${head} This is not one of them.`;
    if (b.fameMissed.listed) return `${head} This is one of them.`;
    const low = [
      b.affinity && b.affinity.grandparent <= line.grandparent && `${b.affinity.grandparent.toFixed(2)} with ${names.grandparent}'s favorites`,
      b.affinity && b.affinity.visitor <= line.visitor && `${b.affinity.visitor.toFixed(2)} with ${names.visitor}'s`,
    ].filter(Boolean);
    return low.length ? `${head} This is not one of them, but its ${low.join(" and ")} ${low.length > 1 ? "are" : "is"} not above that middle.` : `${head} It did not pass this check.`;
  }
  function planFor(next: Family, who: Names) {
    setFamily(next);
    setNames(who);
    void makePlan(next);
  }

  return (
    <main data-shown={savedFrom ? "saved" : "live"}>
      <h1>Common Ground</h1>
      <p className="lead">
        For anyone about to visit a grandparent and wondering what you will talk about. Common Ground plans the visit
        from the tastes you share, found in Qloo&apos;s taste data. <a href="#why">Why this exists</a>
      </p>

      <section aria-labelledby="family">
        <h2 id="family">Try a sample family</h2>
        <div className="people">
          <div className="card">
            <div className="label">Grandparent</div>
            <div className="title">{SAMPLE_NAMES.grandparent}, born {SAMPLE_FAMILY.grandparent.birthYear}</div>
            <p>
              Speaks {SAMPLE_FAMILY.grandparent.language}. Loves {SAMPLE_FAMILY.grandparent.favorites.join(", ")}.
            </p>
          </div>
          <div className="card">
            <div className="label">Visitor</div>
            <div className="title">{SAMPLE_NAMES.visitor}, her grandson</div>
            <p>Loves {SAMPLE_FAMILY.visitor.favorites.join(", ")}.</p>
          </div>
        </div>
        {paused && <p className="lead">Live planning is paused right now.</p>}
        {/* Both ways in side by side, so the saved plan below starts on the first screen. */}
        <div className="actions">
          {!paused && (
            <button onClick={() => planFor(SAMPLE_FAMILY, SAMPLE_NAMES)} disabled={busy}>
              {busy ? "Planning..." : `Plan a visit for ${SAMPLE_NAMES.grandparent} and ${SAMPLE_NAMES.visitor}`}
            </button>
          )}
          {!own && (
            <button className="secondary" onClick={() => setOwn(true)}>
              Tell us about your grandparent and you
            </button>
          )}
        </div>
      </section>

      {own && (
        <section aria-labelledby="own">
          <h2 id="own">Plan for your own family</h2>
          <FamilyFormView paused={paused} busy={busy} onPlan={planFor} />
        </section>
      )}

      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}

      {/* While a live plan is made, its newest step, in plain words. Every step, and who did it, is in the fold. */}
      {busy && steps.length > 0 && (
        <p className="progress" role="status">
          {steps.at(-1)!.text}
        </p>
      )}

      {first && (
        <section aria-labelledby="plan">
          {savedFrom && (
            <div className="notice" role="note">
              A saved plan, made live by this agent on {savedFrom} with real Qloo data. It is a recording, not a new plan.
              {savedLeftOut > 0 &&
                ` ${savedLeftOut === 1 ? "One suggestion" : `${savedLeftOut} suggestions`} found on the web ${savedLeftOut === 1 ? "was" : "were"} left out of it, because nobody had checked ${savedLeftOut === 1 ? "it" : "them"}.`}
            </div>
          )}
          <h2 id="plan">Start here: something you will both love</h2>
          <div className="card bridge">
            <div className="label">{first.bridge.kind}</div>
            <div className="title">{first.bridge.title}</div>
            <p>{named(first.bridge.why)}</p>
            {first.bridge.affinity && (
              <p className="sources">
                Chosen from what Qloo suggests for {names.grandparent}, as the best fit for both of them.
              </p>
            )}
            {/* A bridge that did not pass the check against what Qloo suggests to anyone says so here, with its numbers. */}
            {first.bridge.fameMissed && <p className="sources">{fameLine(first.bridge)}</p>}
          </div>
          {!plan && <p className="lead">The rest of the visit is on its way.</p>}
        </section>
      )}

      {plan && (
        <section aria-labelledby="visit">
          <h2 id="visit">The visit</h2>
          {plan.moments.map((m) => (
            <div className="card" key={m.title}>
              <div className="label">{m.kind}</div>
              <div className="title">{m.title}</div>
              <p>{named(m.what_to_do)}</p>
              {m.kind === "place" && (
                <p className="sources">
                  {m.where ? `Address from Qloo: ${m.where}. ` : "From Qloo's place data. "}Check that it is open before you go.
                </p>
              )}
              {sources(m.evidence).length > 0 && (
                <p className="sources">
                  Found on the web, so check before you go:{" "}
                  {sources(m.evidence).map((s) => (
                    <a key={s.href} href={s.href} target="_blank" rel="noopener noreferrer">
                      {s.host}
                    </a>
                  ))}
                </p>
              )}
            </div>
          ))}

          <h2>Questions that open stories</h2>
          {/* Honest about two things: a question may be about something they have not tried yet, and nobody who
              speaks the language natively has read the translation (LANGUAGE_REVIEW.md). */}
          <p className="who">
            Ask them as you go, once you have shared what a question is about.
            {plan.questions.some((q) => q.native !== q.english) && " A model put them into the language, not a native speaker: say them in your own words."}
          </p>
          {plan.questions.map((q) => (
            <div className="card question" key={q.english}>
              <div className="native" lang={LANG[plan.language.trim().toLowerCase()]}>
                {named(q.native)}
              </div>
              {q.native !== q.english && <div className="gloss">{named(q.english)}</div>}
            </div>
          ))}
        </section>
      )}

      {/* The workings, folded so a family sees the plan first: who did each step, and what each card rests on. One
          click opens it. */}
      {(steps.length > 0 || first) && (
        <details className="how">
          <summary>How this plan was made</summary>
          {steps.length > 0 && (
            <section aria-labelledby="steps">
              <h3 id="steps">{savedFrom || !busy ? "What the agent did" : "What the agent is doing"}</h3>
              {steps.some((s) => s.by) && (
                <p className="who">
                  Each step is marked with who did it. Nano, Super and Ultra are three NVIDIA Nemotron 3 models, called on
                  Nebius Token Factory: Nano reads how the last visit went, Super gathers with tools, Ultra writes. Rule is
                  plain code, with no model.
                </p>
              )}
              <ul className="steps">
                {steps.map((s, i) => (
                  <li key={i} className={s.ok ? "" : "bad"}>
                    {s.by && (
                      <span className={`by by-${s.by}`}>
                        {s.by !== "rule" && <span className="sr-only">Nemotron 3 </span>}
                        {DOER[s.by]}
                      </span>
                    )}
                    {s.text}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {first && (
            <section aria-labelledby="found">
              <h3 id="found">What each suggestion rests on</h3>
              {[first.bridge, ...(plan?.moments ?? [])].map((c, i) => (
                <div className="found" key={`${i}-${c.title}`} data-title={c.title}>
                  <div className="title">{c.title}</div>
                  {i === 0 && first.bridge.affinity && (
                    <p className="sources">
                      Qloo affinity, from 0 to 1: {first.bridge.affinity.grandparent.toFixed(2)} with {names.grandparent}&apos;s favorites,{" "}
                      {first.bridge.affinity.visitor.toFixed(2)} with {names.visitor}&apos;s.
                    </p>
                  )}
                  {i === 0 && (first.bridge.beyondFame || first.bridge.fameMissed) && <p className="sources">{fameLine(first.bridge)}</p>}
                  <div className="chips">
                    {c.evidence.map((id) => (
                      <span className="chip" key={id}>
                        {id}: {evidenceLabel(id)}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          )}
        </details>
      )}

      {plan && !savedFrom && (
        <section aria-labelledby="after">
          <h2 id="after">After the visit</h2>
          <div className="card feedback">
            <p>What landed?</p>
            {[plan.bridge.title, ...plan.moments.map((m) => m.title)].map((t) => (
              <label key={t}>
                <input type="checkbox" checked={Boolean(landed[t])} onChange={(e) => setLanded({ ...landed, [t]: e.target.checked })} />{" "}
                {t}
              </label>
            ))}
            <label htmlFor="note">What should be different next time?</label>
            <textarea
              id="note"
              rows={2}
              maxLength={280}
              value={note}
              onFocus={(e) => e.target.scrollIntoView({ block: "nearest" })}
              onChange={(e) => {
                setNote(e.target.value);
                setNoteError(null);
              }}
              {...(noteError ? { "aria-invalid": true, "aria-describedby": "note-error" } : {})}
            />
            {noteError && (
              <p className="field-error" id="note-error" role="alert">
                {noteError}
              </p>
            )}
            <p />
            <button className="secondary" onClick={planNext} disabled={busy}>
              Plan the next visit
            </button>
          </div>
        </section>
      )}

      {/* Every figure here is a source's own sentence, read on the day lib/sources.ts gives, and linked. */}
      <section className="why" aria-labelledby="why">
        <h2 id="why">Why this exists</h2>
        <p>
          A visit to an older relative matters, and it is easy to put off. The distance is real, and so is the worry
          about what to say once you are there.
        </p>
        {SOURCES.map((s) => (
          <figure key={s.url}>
            <figcaption>{s.about}</figcaption>
            {/* A line from a table of survey answers is shown under the question that was asked, both unchanged. */}
            <blockquote cite={s.url}>
              {s.asked && (
                <>
                  &ldquo;{s.asked}&rdquo;
                  <br />
                </>
              )}
              &ldquo;{s.quote}&rdquo;
            </blockquote>
            <p className="sources">
              {s.whom}.{" "}
              <a href={s.url} target="_blank" rel="noopener noreferrer">
                {s.who}
              </a>
            </p>
          </figure>
        ))}
        <p>
          Common Ground cannot shorten the distance. It can make the next visit easier to begin: it starts from what
          you both already love, keeps the plan small, and writes the questions in their language, with the English
          beside them.
        </p>
        <p>It is a helper for a family visit. It is not a medical tool, and it does not diagnose or treat anything.</p>
      </section>

      {/* Each line below says what the code does. lib/agent.ts decides what each model reads, lib/qloo.ts and
          lib/tavily.ts what is sent on; tests/privacy.test.ts fails if they stop matching this. */}
      <section className="privacy" aria-labelledby="privacy">
        <h2 id="privacy">What is sent, and where</h2>
        <dl>
          <dt>Stays on this device</dt>
          <dd>The two names, and a copy of what you type in the form, so it is there when you come back.</dd>
          <dt>NVIDIA Nemotron models on Nebius, which do the planning</dt>
          <dd>
            The favorites, the birth year, the language, the city, and whether it is a grandmother or a grandfather.
            After a visit: which suggestions landed, and your note.
          </dd>
          <dt>Qloo, for taste data</dt>
          <dd>
            The favorites, as search words, and the word for a dish you named. The years of your grandparent&apos;s
            youth, worked out from the birth year, and the age band &ldquo;55 and older&rdquo;. The city, when it
            looks for places nearby. After a visit: the
            titles that landed.
          </dd>
          <dt>Tavily, for local events</dt>
          <dd>One or two web searches, written from the city and the favorites. None when no city is given.</dd>
          <dt>Never sent to Qloo or Tavily</dt>
          <dd>The language, grandmother or grandfather, and your note.</dd>
          <dt>Kept by this site</dt>
          <dd>
            Nothing you type. Qloo&apos;s answers are kept for up to a week and web results for a day, under keys that
            cannot be turned back into your words. A one-way code for your network address is kept for rate limits
            and deleted within a day.
          </dd>
        </dl>
        <p>
          The site runs on Vercel and keeps those answers and counters in Upstash. Each service named here handles
          what it receives under its own terms.
        </p>
      </section>
    </main>
  );
}
