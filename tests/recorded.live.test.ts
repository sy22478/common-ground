import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { SAMPLE_FAMILY } from "@/lib/family";
import { eventsFromStream, savedPlanProblems, toSavedPlan } from "@/lib/saved";
import { translationProblem } from "@/lib/wording";

// Run by hand, no cost and no network: holds every real plan recorded on this machine (.qloo/saved-stream-*.txt, the
// sample family's) to the wording rules of today, and writes what they catch to .qloo/wording-report.txt. It is the
// way to see a rule work on the real sentences it was written for, and to see what it still lets through. The
// report quotes real plans, so like everything in .qloo/ it stays out of the repo.
const streams = existsSync(".qloo") ? readdirSync(".qloo").filter((f) => /^saved-stream-.*\.txt$/.test(f)).sort() : [];

it.skipIf(!streams.length)("holds the recorded real plans to today's wording rules", () => {
  const lines: string[] = [];
  let caught = 0;
  for (const file of streams) {
    const events = eventsFromStream(readFileSync(`.qloo/${file}`, "utf8"));
    const made = events.find((e) => e.type === "plan");
    if (!made || made.type !== "plan") continue;
    const saved = toSavedPlan(events, "recorded");
    const problems = saved ? savedPlanProblems(saved, SAMPLE_FAMILY) : ["no plan could be saved from it"];
    const slips = made.plan.questions.flatMap((q) => {
      const why = translationProblem(made.plan.language, SAMPLE_FAMILY.grandparent.relation, q.native, q.english);
      return why ? [`the translation "${q.native}" ${why}`] : [];
    });
    const leftOut = made.plan.moments.length - (saved?.plan.moments.length ?? 0);
    caught += problems.length + slips.length + leftOut;
    lines.push(`${file}: ${problems.length + slips.length} caught, ${leftOut} web ${leftOut === 1 ? "lead" : "leads"} left out of a recording`, ...[...problems, ...slips].map((p) => `  - ${p}`));
  }
  writeFileSync(".qloo/wording-report.txt", lines.join("\n") + "\n");
  console.log(lines.join("\n"));
  expect(caught, "the rules were written from these plans, so they must catch something in them").toBeGreaterThan(0);
});
