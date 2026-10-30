import { describe, expect, it } from "vitest";
import { limits } from "@/lib/config";
import { FamilySchema, SAMPLE_FAMILY } from "@/lib/family";
import { gatherBrief, planBrief, readFeedback, wishesLine, type Visit } from "@/lib/feedback";
import { CapReached, SpendGuard } from "@/lib/spend";
import { MemoryStore } from "@/lib/store";
import { ScriptedLLM } from "./helpers";

// The gate's own example (STACK_AND_GATE.md, step 7): "the music was a hit, the film was too long".
const visit: Visit = {
  landed: [{ title: "A Singer", kind: "artist" }],
  rest: [
    { title: "A Film", kind: "film" },
    { title: "Another Film", kind: "film" },
    { title: "making tamales at Christmas", kind: "activity" },
    { title: "A Festival", kind: "event" },
  ],
  note: "the music was a hit, the film was too long",
};
const nano = (content: string) => new ScriptedLLM([{ content }]);

describe("reading how the last visit went", () => {
  it("is not asked when there was no earlier visit", async () => {
    const llm = new ScriptedLLM([]);
    expect(await readFeedback([], llm)).toBeNull();
    expect(llm.requests).toHaveLength(0);
  });

  it("asks Nemotron 3 Nano, with thinking off, and turns its reading into rules that can be counted", async () => {
    const llm = nano('{"more": ["music"], "avoid": ["film"]}');
    const wishes = await readFeedback([visit], llm);
    expect(llm.requests[0]).toMatchObject({ model: "nano", thinking: false });
    expect(JSON.parse(llm.requests[0]!.messages[1]!.content as string)).toEqual([{ landed: visit.landed, not_marked: visit.rest, note: visit.note }]);
    expect(wishes).toEqual({
      more: [{ group: "music", atLeast: 2 }], // one music item last time, so two this time
      avoid: ["film"],
      noRepeat: ["A Singer", "A Film", "Another Film", "making tamales at Christmas", "A Festival"],
    });
  });

  it("does not treat an unticked card as disliked: only the note can rule a kind out", async () => {
    const wishes = await readFeedback([{ ...visit, note: undefined }], nano('{"more": ["music"], "avoid": []}'));
    expect(wishes?.avoid).toEqual([]);
  });

  it("goes by the ticks alone when the reply cannot be read, and rules nothing out", async () => {
    for (const reply of ["I think they liked the music.", '{"more": "music", "avoid": "film"}']) {
      expect(await readFeedback([visit], nano(reply))).toMatchObject({ more: [{ group: "music", atLeast: 2 }], avoid: [] });
    }
  });

  // Both takes of 2026-10-28: two singers ticked, the same note, and Nano replied with "artist" under "more". That one
  // word failed the check of the whole reply, so "avoid film" was lost and a film came back.
  it("keeps the rest of the reading when Nano names a kind for its group, or a word not on the list", async () => {
    const twoSingers: Visit = {
      landed: [
        { title: "A Singer", kind: "artist" },
        { title: "Another Singer", kind: "artist" },
      ],
      rest: [
        { title: "A Film", kind: "film" },
        { title: "Another Film", kind: "film" },
        { title: "making tamales together", kind: "activity" },
      ],
      note: "the music was a hit, the film was too long",
    };
    const asMusic = { more: [{ group: "music", atLeast: 3 }], avoid: ["film"] };
    expect(await readFeedback([twoSingers], nano('{"more": ["artist"], "avoid": ["film"]}'))).toMatchObject(asMusic);
    expect(await readFeedback([twoSingers], nano('{"more": ["song", "album"], "avoid": ["film"]}'))).toMatchObject(asMusic);
    expect(await readFeedback([twoSingers], nano('{"more": ["jazz"], "avoid": ["film", "opera"]}'))).toMatchObject(asMusic);
    expect((await readFeedback([visit], nano('{"more": [], "avoid": ["artist"]}')))?.avoid).toEqual(["music"]);
  });

  it("always counts what was ticked, even if the model leaves it out", async () => {
    expect((await readFeedback([visit], nano('{"more": [], "avoid": ["film"]}')))?.more).toEqual([{ group: "music", atLeast: 2 }]);
  });

  it("follows the note over a tick when they disagree", async () => {
    const ticked: Visit = { landed: [{ title: "A Film", kind: "film" }], rest: [], note: "honestly the film dragged" };
    expect(await readFeedback([ticked], nano('{"more": ["film"], "avoid": ["film"]}'))).toMatchObject({ more: [], avoid: ["film"] });
  });

  it("never asks for more than a plan can hold, and lets a dish that landed come back", async () => {
    const full: Visit = {
      landed: [
        { title: "Singer 1", kind: "artist" },
        { title: "Singer 2", kind: "artist" },
        { title: "A Song", kind: "song" },
        { title: "Tamales", kind: "dish" },
      ],
      rest: [],
    };
    const wishes = await readFeedback([full], nano('{"more": ["music", "dish"], "avoid": []}'));
    expect(wishes?.more).toEqual([
      { group: "music", atLeast: 4 }, // three last time, so four: the most a plan is asked for
      { group: "dish", atLeast: 2 },
    ]);
    const allMusic: Visit = { landed: [1, 2, 3, 4, 5].map((n) => ({ title: `Singer ${n}`, kind: "artist" as const })), rest: [] };
    expect((await readFeedback([allMusic], nano('{"more": ["music"], "avoid": []}')))?.more).toEqual([{ group: "music", atLeast: 4 }]);
    expect(wishes?.noRepeat).toEqual(["Singer 1", "Singer 2", "A Song"]);
  });

  it("stops, like every model call, when a spend cap is reached", async () => {
    const guard = new SpendGuard(new MemoryStore(), limits({ PLAN_CAP_USD: "0" }));
    await expect(readFeedback([visit], new ScriptedLLM([{ content: "{}" }], guard))).rejects.toEqual(new CapReached("plan"));
  });
});

describe("what the page sends after a visit", () => {
  const withHistory = (history: unknown) => FamilySchema.safeParse({ ...SAMPLE_FAMILY, history }).success;

  it("carries each card's kind, so the agent knows a film from a singer", () => {
    expect(withHistory([visit])).toBe(true);
    expect(withHistory([{ landed: [{ title: "A Singer", kind: "opera" }], rest: [] }])).toBe(false);
    expect(withHistory([{ landed: ["A Singer"], missed: ["A Film"] }])).toBe(false); // the shape before 2026-10-11: titles only
  });
});

describe("what each stage is told", () => {
  const wishes = { more: [{ group: "music" as const, atLeast: 2 }], avoid: ["film" as const], noRepeat: ["A Singer", "A Film"] };

  it("the page: one line that shows the last visit was heard", () => {
    expect(wishesLine(wishes)).toBe("From the last visit: more music, no films this time");
    expect(wishesLine({ more: [], avoid: [], noRepeat: [] })).toBe("From the last visit: something new in the same spirit");
  });

  it("the gathering model: which Qloo types to ask for, which never to, and what landed as a new signal", () => {
    expect(gatherBrief(wishes, visit)).toEqual({ types: ["artist"], never: ["movie"], signals: ["A Singer (artist)"], web: true });
  });

  it("keeps the usual films and artists when nothing was ruled out, with what they want more of first", () => {
    const books = { more: [{ group: "book" as const, atLeast: 1 }], avoid: ["event" as const], noRepeat: [] };
    expect(gatherBrief(books, { landed: [], rest: [] })).toEqual({ types: ["book", "movie", "artist"], never: [], signals: [], web: false });
  });

  it("still has something to ask Qloo for when both films and music are ruled out", () => {
    const neither = { more: [], avoid: ["film" as const, "music" as const], noRepeat: [] };
    expect(gatherBrief(neither, visit)).toMatchObject({ types: ["tv_show", "book"], never: ["movie", "artist"], signals: [] });
  });

  it("the planner: rules it can count", () => {
    expect(planBrief(wishes)).toBe(
      [
        "After the last visit (this comes before the general rules):",
        "- music landed: include at least 2 music items among the bridge and the moments (kind song, album or artist).",
        "- films went badly: include no film, not as the bridge and not as a moment.",
        "- Suggest new things. Do not repeat: A Singer; A Film.",
      ].join("\n"),
    );
  });
});
