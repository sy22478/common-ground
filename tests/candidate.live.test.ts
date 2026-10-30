import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@/lib/agent";
import { SAMPLE_FAMILY } from "@/lib/family";
import type { Health } from "@/lib/health";
import { eventsFromStream, savedPlanProblems, toSavedPlan } from "@/lib/saved";

// LIVE, run by hand: the gate on one build at its own address, which is the build that is then promoted (DEPLOY.md,
// "Switching planning on"). So what was checked is what goes live, byte for byte and with the same settings.
//
// A production build at its own address is behind Vercel's login, and the short-lived token opens previews only
// (403 on a production build, 2026-10-13). No browser can reach such a build before it is promoted, so this goes
// through `vercel curl`, which the signed-in CLI opens. The browser checks run on a preview of the same commit, and
// on the public address once the build is promoted.
//
//   GATE_URL=https://common-ground-<id>-sy22478.vercel.app npm run gate:build
//
//   GATE_PLAN=1         also make one real plan for the sample family through the build's own route (about one
//                       US cent, and one of the address's plans for the hour)
//   GATE_PLANNING=off   the build is expected to have planning off (default: on)
//   GATE_SAME_AS=<url>  after promoting: GATE_URL, now the public address, must serve the very deployment at <url>
//
// It reads, and with GATE_PLAN=1 makes one plan. It deploys nothing and promotes nothing. What it found goes to
// .qloo/gate/, which git ignores.
const target = process.env.GATE_URL;
const PLANNING_ON = (process.env.GATE_PLANNING ?? "on") === "on";
const host = target ? new URL(target).hostname : "";
// A deployment's own address is protected; the public address is not, and is asked plainly.
const OWN_ADDRESS = /^common-ground-[a-z0-9]{9}-sy22478\.vercel\.app$/.test(host);

const run = (command: string, args: string[], timeoutMs = 90_000) => execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 });

interface Answer {
  status: number;
  headers: Record<string, string>;
  text: string;
}

// Vercel's firewall answers a machine it has come to distrust with a checkpoint page (403, "x-vercel-mitigated:
// challenge"). That is neither a pass nor a fault of the build: nothing was checked, and the run must say so.
function unchallenged(answer: Answer): Answer {
  if (answer.headers["x-vercel-mitigated"]) throw new Error(`Vercel's firewall is challenging this machine (x-vercel-mitigated: ${answer.headers["x-vercel-mitigated"]}), so nothing was checked. Wait some minutes and run again.`);
  return answer;
}

async function ask(path: string, json?: unknown, timeoutMs = 90_000): Promise<Answer> {
  if (!OWN_ADDRESS) {
    const response = await fetch(new URL(path, target), { method: json ? "POST" : "GET", redirect: "manual", signal: AbortSignal.timeout(timeoutMs), ...(json ? { body: JSON.stringify(json), headers: { "Content-Type": "application/json" } } : {}) });
    return unchallenged({ status: response.status, headers: Object.fromEntries(response.headers), text: await response.text() });
  }
  const post = json ? ["-X", "POST", "-H", "Content-Type: application/json", "--data-raw", JSON.stringify(json)] : [];
  let raw = run("vercel", ["curl", path, "--deployment", target!, "-s", "-i", "--max-time", String(Math.floor(timeoutMs / 1000)), ...post], timeoutMs + 15_000);
  // curl -i prints the status line and the headers, a blank line, then the body.
  for (;;) {
    const end = raw.search(/\r?\n\r?\n/);
    const head = raw.slice(0, end).split(/\r?\n/);
    const text = raw.slice(end).replace(/^\r?\n\r?\n/, "");
    const status = Number(/^HTTP\/\S+ (\d+)/.exec(head[0] ?? "")?.[1]);
    if (status === 100) {
      raw = text;
      continue;
    }
    const headers = Object.fromEntries(head.slice(1).map((line) => [line.slice(0, line.indexOf(":")).toLowerCase(), line.slice(line.indexOf(":") + 1).trim()]));
    return unchallenged({ status, headers, text });
  }
}

const fresh = () => `t=${Date.now()}-${Math.random().toString(36).slice(2)}`;
const inspect = (url: string) => JSON.parse(run("vercel", ["inspect", url, "--json"])) as { id: string; target: string | null; readyState: string; url: string; aliases?: string[] };

// Never served, whatever the build: the keys, the records, the tests, the scripts, Qloo's answers. Asked for only
// at a build's own address, about one a second through the CLI. Asked of the public address in a burst (three runs
// of 18 within a minute, 2026-10-13), they made Vercel's firewall challenge this machine on every page of the site
// for some minutes. After promoting, the public address serves the same deployment, so the answer is the same.
const PRIVATE = ["/.env", "/.env.local", "/.env.production", "/.git/config", "/.vercel/project.json", "/.qloo/calls.jsonl", "/PROGRESS.md", "/DEPLOY.md", "/package.json", "/next.config.ts", "/lib/sources.json", "/scripts/_env.py", "/scripts/scan_qloo_data.py", "/tests/helpers.ts", "/e2e/public.spec.ts", "/session_state/SESSION_STATE.md", "/submission/NARRATION.md", "/api/admin"];

describe.skipIf(!target)(`the gate on ${host}`, () => {
  const found: Record<string, unknown> = { at: new Date().toISOString(), url: target, planning: PLANNING_ON ? "on" : "off" };
  const keep = (more: Record<string, unknown>) => {
    Object.assign(found, more);
    mkdirSync(".qloo/gate", { recursive: true });
    writeFileSync(`.qloo/gate/${String(found.at).replace(/[:.]/g, "")}-${host.split(".")[0]}.json`, JSON.stringify(found, null, 1) + "\n");
  };

  it("is built from the commit in this folder, with nothing uncommitted and nothing unpushed", async () => {
    // Vercel names the folder's commit even when the folder held changes, so the folder is looked at too.
    expect(run("git", ["status", "--porcelain"]), "nothing uncommitted in this folder").toBe("");
    const head = run("git", ["rev-parse", "HEAD"]).trim();
    // Pushed to the branch this folder follows: origin/main on main, origin/<branch> on a branch (bus 016).
    expect(run("git", ["rev-parse", "@{upstream}"]).trim(), "the commit is pushed").toBe(head);
    const health = JSON.parse((await ask(`/api/health?${fresh()}`)).text) as Health;
    expect(health.build ?? "(the build does not say)", "the build names this commit").toBe(head);
    keep({ commit: head });
  });

  it("is one deployment, ready, and after promoting the very one that was gated", () => {
    const deployment = inspect(target!);
    expect(deployment.readyState).toBe("READY");
    keep({ deployment: { id: deployment.id, target: deployment.target, url: deployment.url, aliases: deployment.aliases ?? [] } });
    if (process.env.GATE_SAME_AS) {
      const gated = inspect(process.env.GATE_SAME_AS);
      expect(deployment.id, `${host} serves the deployment that was gated at ${gated.url}`).toBe(gated.id);
      keep({ sameAs: gated.id });
    }
  });

  it(`says planning is ${PLANNING_ON ? "on and open" : "off"}, with its counters in Redis, and the plan route agrees`, async () => {
    const health = JSON.parse((await ask(`/api/health?${fresh()}`)).text) as Health;
    keep({ health });
    if (PLANNING_ON) {
      expect(health).toMatchObject({ livePlanning: true, planningOpen: true, pausedFor: null, counters: "redis" });
      // Past its switch: it reads the request and refuses this one for what it says, with no call and no count.
      const refused = await ask("/api/plan", { grandparent: { birthYear: 1800 } });
      expect(refused.status).toBe(400);
      expect(JSON.parse(refused.text)).toEqual({ error: "invalid", message: "Please check the favorites and the birth year, then try again." });
    } else {
      expect(health).toMatchObject({ livePlanning: false, planningOpen: false, pausedFor: "off", counters: "redis" });
      const refused = await ask("/api/plan", SAMPLE_FAMILY);
      expect(refused.status).toBe(503);
      expect(JSON.parse(refused.text)).toEqual({ error: "paused", message: "Live planning is switched off right now." });
    }
  });

  it("serves the recording that is in this folder, for when a cap pauses planning", async () => {
    expect(existsSync("public/saved-plan.json"), "a recording is in this folder").toBe(true);
    const served = await ask(`/saved-plan.json?${fresh()}`);
    expect(served.status).toBe(200);
    expect(JSON.parse(served.text)).toEqual(JSON.parse(readFileSync("public/saved-plan.json", "utf8")));
  });

  it(`${OWN_ADDRESS ? "serves no private file, and " : ""}sends the security headers`, async () => {
    if (OWN_ADDRESS) {
      const open: string[] = [];
      for (const path of PRIVATE) {
        const { status } = await ask(path);
        if (status !== 404) open.push(`${path} answered ${status}`);
      }
      expect(open, "each private path answers 404").toEqual([]);
      keep({ privatePaths: PRIVATE.length });
    }
    const page = await ask("/");
    expect(page.status).toBe(200);
    expect(page.headers).toMatchObject({ "x-frame-options": "DENY", "x-content-type-options": "nosniff", "referrer-policy": "strict-origin-when-cross-origin" });
    expect(page.headers["strict-transport-security"]).toMatch(/max-age=\d+/);
  });

  // The whole scripted run, with its browser, is e2e/demo.spec.ts on a preview of the same commit. This is one
  // plan through this build's own route, with this build's own keys and limits.
  it.skipIf(process.env.GATE_PLAN !== "1" || !PLANNING_ON)("makes one plan for the sample family, start to end", async () => {
    const started = Date.now();
    const answer = await ask("/api/plan", SAMPLE_FAMILY, 150_000);
    const wallMs = Date.now() - started;
    expect(answer.status, answer.text.slice(0, 200)).toBe(200);
    const events = eventsFromStream(answer.text);
    const failure = events.find((e): e is Extract<AgentEvent, { type: "error" }> => e.type === "error");
    const plan = events.find((e): e is Extract<AgentEvent, { type: "plan" }> => e.type === "plan")?.plan;
    const done = events.find((e): e is Extract<AgentEvent, { type: "done" }> => e.type === "done");
    keep({ plan: { arrived: Boolean(plan), wallMs, costUsd: done?.costUsd ?? null, kinds: plan ? [plan.bridge.kind, ...plan.moments.map((m) => m.kind)] : [] } });
    expect(plan, `a plan arrives${failure ? ` (the agent said: ${failure.message})` : ""}`).toBeTruthy();
    if (!plan) return;

    // The bridge comes from Qloo's numbers and is held against what Qloo suggests to anyone.
    expect(plan.bridge.affinity, "the bridge carries Qloo's affinity with each of them").toBeTruthy();
    expect(plan.bridge.beyondFame ?? plan.bridge.fameMissed, "the bridge was held against what Qloo suggests to anyone, passed or not").toBeTruthy();
    expect(plan.moments).toHaveLength(4);
    expect(plan.questions).toHaveLength(3);
    for (const q of plan.questions) expect(q.native, "a question is in her language, with the English beside it").not.toBe(q.english);
    const lines = plan.moments.filter((m) => m.kind !== "event").map((m) => m.what_to_do);
    expect(new Set(lines).size, "every card has a sentence of its own").toBe(lines.length);
    // The same wording rules a recording is held to.
    const asSaved = toSavedPlan(events, new Date().toISOString());
    expect(asSaved, "at least two cards that are not web leads").not.toBeNull();
    expect(savedPlanProblems(asSaved!, SAMPLE_FAMILY)).toEqual([]);

    // Three models and a rule did the work, on four Qloo endpoints.
    const tools = events.filter((e): e is Extract<AgentEvent, { type: "tool" }> => e.type === "tool" && e.ok);
    expect([...new Set(events.flatMap((e) => (e.type === "step" || e.type === "tool" ? [e.by] : [])))].sort()).toEqual(["rule", "super", "ultra"]);
    expect([...new Set(tools.map((t) => t.name))]).toEqual(expect.arrayContaining(["qloo_search", "qloo_tags", "qloo_insights", "qloo_compare"]));

    expect(done?.costUsd, "the plan stayed under its cap").toBeLessThanOrEqual(0.06);
    expect(wallMs, "the plan arrived within a minute").toBeLessThanOrEqual(60_000);
    console.log(`one plan: ${(wallMs / 1000).toFixed(1)} s, $${done?.costUsd}`);
  });
});
