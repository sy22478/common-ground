// Records the demo video for the entry, as submission/VIDEO.md sets it out: the public page first,
// then two live plans on a test preview that has planning on. No voice. The captions go in a band under the page,
// so they never cover it. Two real plans: about two US cents.
//
//   vercel env run -- sh -c 'PREVIEW_URL=https://... node scripts/record_video.mjs'
//
// A preview behind the Vercel login needs the short-lived VERCEL_OIDC_TOKEN, which `vercel env run` passes without
// printing it. It is attached to requests for the preview's own origin and nowhere else.
//
//   DRY=1 node scripts/record_video.mjs     the public page only, at no cost: tries the camera and the framing
//   ENCODE_ONLY=1 node scripts/record_video.mjs   builds the video again from the frames of the last take, after a
//                                                 caption was reworded in take.json. Needs a take made with KEEP_FRAMES=1
//
// Everything this writes shows what Qloo returned, so it goes to .qloo/submission/, which git ignores. Nothing here
// uploads anything: the video is Sonu's to upload.

import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { linkSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";

const PUBLIC_URL = process.env.PUBLIC_URL ?? "https://common-ground-beryl.vercel.app";
const PREVIEW_URL = process.env.PREVIEW_URL ?? "";
const DRY = process.env.DRY === "1";
const OUT = path.resolve(process.env.VIDEO_DIR ?? ".qloo/submission/video");
const IMAGES = path.resolve(OUT, "..", "images");

// The page is filmed 960 by 460 at twice the density: 1920 by 920, and the captions take the 160 below it.
// Chrome's screencast ignores an emulated density (it gave 960 by 460, measured 2026-10-12), so the density is forced
// on the browser itself and the window, not an emulated viewport, sets the size.
const VIEW = { width: 960, height: 460 };
const SCALE = 2;
const FRAME = { width: VIEW.width * SCALE, height: VIEW.height * SCALE };
const FULL = { width: 1920, height: 1080 };
// The rules say "less than three (3) minutes". Five seconds are kept in hand.
const LIMIT_SECONDS = 175;
const FPS = 30;
const FEEDBACK = "the music was a hit, the film was too long";
const MUSIC = new Set(["song", "album", "artist"]);

// The captions, in order. They are the script: submission/VIDEO.md lists them with the times of the last take.
// None names anything Qloo returned.
const SAY = {
  problem: "A visit to a grandparent is easy to put off. The distance is real. So is the worry about what to say.",
  who: "The WHO estimates that social isolation affects up to 1 in 3 older adults.",
  aarp: "AARP, 2026: 29% of US grandparents live 500 miles or more from a grandchild.",
  pew: "Pew: close to two-thirds of third-generation or later US Latinos say they cannot carry on a conversation well in Spanish.",
  what: "Common Ground plans one visit from the tastes you already share. You give two short lists of favorites.",
  public: "This is the public page. Live planning is switched off there for now, so it shows the plan recorded earlier, and says so.",
  live: "The rest is live, on a test deployment of the same code with planning switched on.",
  // For a take made on the public page alone, once planning is on there (submission/NARRATION.md, lines 6 and 7).
  open: "This is the public page, and planning is live on it: anyone can try it, with no login.",
  here: "One press, and a live plan starts for the sample family.",
  models: "Three NVIDIA Nemotron 3 models on Nebius Token Factory share the work. Each step shows who did it.",
  gather: "Nemotron 3 Super gathers the evidence with tools: four Qloo endpoints and a Tavily web search, run in parallel.",
  write: "A rule in code picks the bridge from Qloo's suggestions for her, by its affinity with each taste. Nemotron 3 Ultra writes the plan, and rules check every card.",
  bridge: "The bridge comes first: something from her world both may love, checked against what Qloo suggests to anyone, and the card says how it fared.",
  visit: "Then a few things to do together. What each card rests on is one click away.",
  place: " A place carries Qloo's address.",
  questions: "And three questions that open stories, in her language, with the English beside them. No quiz, and no guess about her life.",
  after: "After the visit, you tick what landed and add a sentence.",
  nano: "Nemotron 3 Nano reads how the visit went. Code turns that into rules the next plan must meet.",
  next: "The next plan follows it: more of what landed, none of what did not, nothing repeated.",
  own: "You can plan for your own family too: favorites, a birth year, a language, a city.",
  privacy: "The names you type stay on your device. The page lists what is sent to each service. A plan costs about one US cent.",
  close: "Common Ground. Qloo for taste, NVIDIA Nemotron 3 on Nebius Token Factory for planning, Tavily for local events. Apache 2.0.",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const now = () => Date.now() / 1000;

const captions = []; // { at, text }: each one stays until the next begins
const checks = []; // { name, ok, detail }
const check = (name, ok, detail = "") => {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "pass" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

// Shows a caption and returns a wait that ends once it has been on screen long enough to read.
function say(text, seconds) {
  captions.push({ at: now(), text });
  const until = Date.now() + seconds * 1000;
  return () => sleep(Math.max(0, until - Date.now()));
}

// A dot that follows the pointer, so a viewer can see what is pressed. It is the recorder's, not the app's.
function drawPointer() {
  if (document.getElementById("recorder-pointer")) return;
  const dot = document.createElement("div");
  dot.id = "recorder-pointer";
  Object.assign(dot.style, {
    position: "fixed",
    left: "-40px",
    top: "-40px",
    width: "22px",
    height: "22px",
    margin: "-11px 0 0 -11px",
    borderRadius: "50%",
    background: "rgba(181, 80, 47, 0.45)",
    border: "2px solid rgba(255, 255, 255, 0.95)",
    boxShadow: "0 0 0 1px rgba(42, 37, 34, 0.55)",
    pointerEvents: "none",
    zIndex: "2147483647",
    transition: "transform 120ms ease",
  });
  document.body.appendChild(dot);
  addEventListener("mousemove", (e) => Object.assign(dot.style, { left: `${e.clientX}px`, top: `${e.clientY}px` }), true);
  addEventListener("mousedown", () => (dot.style.transform = "scale(0.6)"), true);
  addEventListener("mouseup", () => (dot.style.transform = "scale(1)"), true);
}

async function scrollTo(target, top = 20, ms = 1000) {
  await target.evaluate((el, gap) => window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - gap), behavior: "smooth" }), top);
  await sleep(ms);
}

async function point(page, target) {
  let box = await target.boundingBox();
  if (!box) throw new Error("nothing to point at");
  // Brought into the picture first, or the pointer would land outside it and press nothing.
  if (box.y < 8 || box.y + box.height > VIEW.height - 8) {
    await target.evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "center" }));
    await sleep(900);
    box = await target.boundingBox();
  }
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 24 });
  await sleep(250);
}

async function press(page, target) {
  await point(page, target);
  await page.mouse.down();
  await sleep(90);
  await page.mouse.up();
}

// Keeps the newest step of a run in view while the steps arrive.
const follow = (page) =>
  page.evaluate(() => {
    window.__follow = window.setInterval(() => {
      const last = document.querySelector("ul.steps li:last-child");
      if (!last) return;
      const over = last.getBoundingClientRect().bottom - (window.innerHeight - 36);
      if (over > 0) window.scrollBy({ top: over + 56, behavior: "smooth" });
    }, 350);
  });
const unfollow = (page) => page.evaluate(() => window.clearInterval(window.__follow));

// Follows one POST /api/plan to the end of its stream. Call it before the click that starts the plan.
function planRequest(page) {
  const responding = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/plan" && r.request().method() === "POST", { timeout: 60_000 });
  return async () => {
    const response = await responding;
    const text = await response.text(); // resolves when the stream ends
    const events = text
      .split("\n")
      .filter((l) => l.startsWith("data: "))
      .map((l) => JSON.parse(l.slice(6)));
    return {
      status: response.status(),
      plan: events.find((e) => e.type === "plan")?.plan ?? null,
      doers: [...new Set(events.flatMap((e) => (e.type === "step" || e.type === "tool" ? [e.by] : [])))].sort(),
      costUsd: events.find((e) => e.type === "done")?.costUsd ?? 0,
      failure: events.find((e) => e.type === "error")?.message ?? null,
    };
  };
}

// The camera: Chrome's own screencast, one JPEG for each frame it draws, with the time it was drawn.
async function startCamera(page) {
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  const writes = [];
  cdp.on("Page.screencastFrame", (frame) => {
    const file = `f${String(frames.length).padStart(6, "0")}.jpg`;
    frames.push({ file, at: frame.metadata.timestamp ?? now() });
    writes.push(writeFile(path.join(OUT, "frames", file), Buffer.from(frame.data, "base64")));
    cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: FRAME.width, maxHeight: FRAME.height, everyNthFrame: 1 });
  return {
    frames,
    stop: async () => {
      await cdp.send("Page.stopScreencast").catch(() => {});
      await Promise.all(writes);
    },
  };
}

const stamp = (seconds, comma) => {
  const t = Math.max(0, seconds);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const whole = `${String(m).padStart(2, "0")}:${String(Math.floor(s)).padStart(2, "0")}`;
  return comma ? `${String(h).padStart(2, "0")}:${whole},${String(Math.round((s % 1) * 1000)).padStart(3, "0")}` : `${h}:${whole}.${String(Math.floor((s % 1) * 100)).padStart(2, "0")}`;
};

function writeCaptions(lines) {
  writeFileSync(path.join(OUT, "captions.srt"), lines.map((l, i) => `${i + 1}\n${stamp(l.from, true)} --> ${stamp(l.to, true)}\n${l.text}\n`).join("\n"));
  // The same lines for the band under the page: light text on the page's own ink colour.
  const ass = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${FULL.width}`,
    `PlayResY: ${FULL.height}`,
    "WrapStyle: 0",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Band,Lato,46,&H00F3F8FB,&H00F3F8FB,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,2,110,110,30,1",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...lines.map((l) => `Dialogue: 0,${stamp(l.from, false)},${stamp(l.to, false)},Band,,0,0,0,,${l.text}`),
    "",
  ];
  writeFileSync(path.join(OUT, "captions.ass"), ass.join("\n"));
}

// Builds the video on an exact clock: for each thirtieth of a second, the newest frame drawn by then. (Handing the
// frames to ffmpeg with a duration each ran five seconds long over a take: it gives no picture less than a
// twenty-fifth of a second, and Chrome draws faster than that while a page scrolls.)
function encode(frames, length) {
  const seq = path.join(OUT, "seq");
  rmSync(seq, { recursive: true, force: true });
  mkdirSync(seq);
  const count = Math.ceil(length * FPS);
  let newest = 0;
  for (let k = 0; k < count; k++) {
    while (newest + 1 < frames.length && frames[newest + 1].at <= k / FPS) newest++;
    linkSync(path.join(OUT, "frames", frames[newest].file), path.join(seq, `${String(k).padStart(6, "0")}.jpg`));
  }
  const picture = `scale=${FRAME.width}:${FRAME.height}:flags=lanczos,pad=${FULL.width}:${FULL.height}:0:0:color=0x2A2522`;
  const run = (name, filter) =>
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", "seq/%06d.jpg", "-vf", filter, "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", name], { cwd: OUT, stdio: "inherit" });
  run("common-ground-demo.mp4", `${picture},subtitles=captions.ass`);
  run("common-ground-demo-no-captions.mp4", picture); // for a voice track, or YouTube's own captions from the .srt
  rmSync(seq, { recursive: true, force: true });
  return Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", "common-ground-demo.mp4"], { cwd: OUT }).toString().trim());
}

// The end of every run: the caption files, the video, the record of the take, and the report.
function finish(take) {
  writeCaptions(take.captions);
  const seconds = encode(take.frames, take.length);
  check(`the video is under ${LIMIT_SECONDS} seconds`, seconds < LIMIT_SECONDS, `${seconds.toFixed(1)} s, ${take.frames.length} frames`);
  writeFileSync(path.join(OUT, "take.json"), JSON.stringify({ ...take, seconds, checks: [...(take.checks ?? []).filter((c) => !c.name.startsWith("the video is under")), ...checks] }, null, 1));
  // The frames are a few hundred megabytes. KEEP_FRAMES=1 keeps them, to build the video again without a new take.
  if (process.env.KEEP_FRAMES !== "1") rmSync(path.join(OUT, "frames"), { recursive: true, force: true });
  console.log(`\n${OUT}/common-ground-demo.mp4  ${seconds.toFixed(1)} s`);
  for (const l of take.captions) console.log(`${stamp(l.from, false)}  ${l.text}`);
  if (checks.some((c) => !c.ok)) process.exitCode = 1;
}

async function resize(page, size) {
  const cdp = await page.context().newCDPSession(page);
  const { windowId } = await cdp.send("Browser.getWindowForTarget");
  await cdp.send("Browser.setWindowBounds", { windowId, bounds: size });
  await cdp.detach();
  await sleep(500);
}

// Still pictures for the Devpost gallery, 3 by 2 (1500 by 1000), from the page as it stands.
async function stills(page, prefix, views) {
  mkdirSync(IMAGES, { recursive: true });
  await resize(page, { width: 750, height: 500 });
  for (const [name, target, gap] of views) {
    if ((await target.count()) === 0) continue;
    await target.first().evaluate((el, g) => window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - g) }), gap ?? 16);
    await sleep(250);
    await page.screenshot({ path: path.join(IMAGES, `${prefix}-${name}.png`) });
  }
  await resize(page, VIEW);
}

if (process.env.ENCODE_ONLY === "1") {
  finish(JSON.parse(readFileSync(path.join(OUT, "take.json"), "utf8")));
  process.exit();
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(path.join(OUT, "frames"), { recursive: true });
if (!DRY && !PREVIEW_URL) throw new Error("set PREVIEW_URL to a test preview with planning on, or DRY=1 for the public page alone");

const browser = await chromium.launch({ args: [`--force-device-scale-factor=${SCALE}`, `--window-size=${VIEW.width},${VIEW.height}`] });
const context = await browser.newContext({ viewport: null, colorScheme: "light" });
const token = process.env.VERCEL_OIDC_TOKEN;
if (PREVIEW_URL && token) {
  const origin = new URL(PREVIEW_URL).origin;
  await context.route(
    (url) => url.origin === origin,
    (route) => route.continue({ headers: { ...route.request().headers(), "x-vercel-trusted-oidc-idp-token": token } }),
  );
}
// Vercel adds its own toolbar script to a preview. It is not part of the app, so it is kept out of the picture.
await context.route("https://vercel.live/**", (route) => route.abort());
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && consoleErrors.push(m.text()));
page.on("pageerror", (e) => consoleErrors.push(String(e)));

const steps = page.locator("#steps");
// The steps and what each card rests on are folded under "How this plan was made": opened for the camera.
const openHow = async () => {
  const how = page.locator("details.how");
  if (!(await how.evaluate((el) => el.open))) await press(page, how.locator("summary"));
  await sleep(300);
};
const ownButton = page.getByRole("button", { name: "Tell us about your grandparent and you" });
const planSection = page.locator("section[aria-labelledby=plan]");
const visit = page.locator("section[aria-labelledby=visit]");
const moments = visit.locator(".card:not(.question):not(.feedback)");
const questionsHeading = page.getByRole("heading", { name: "Questions that open stories" });
const figures = page.locator("section.why figure");

// A. The public page.
await page.goto(PUBLIC_URL, { waitUntil: "networkidle" });
await page.evaluate(drawPointer);
const health = await (await page.request.get(`${PUBLIC_URL}/api/health?t=${Date.now()}`)).json();
const camera = await startCamera(page);
await sleep(400);

let held = say(SAY.problem, 8);
await page.mouse.move(300, 250, { steps: 20 });
await held();

held = say(SAY.who, 5.5);
await point(page, page.locator('a[href="#why"]'));
await scrollTo(page.locator("#why"));
await held();
held = say(SAY.aarp, 6);
await scrollTo(figures.nth(1), 16);
await held();
held = say(SAY.pew, 6.5);
await scrollTo(figures.nth(2), 60);
await held();

held = say(SAY.what, 7);
await scrollTo(page.locator("h1"), 40, 1300);
await page.mouse.move(330, 300, { steps: 20 });
await page.mouse.move(650, 300, { steps: 30 });
await held();

if (health.planningOpen === false) {
  held = say(SAY.public, 9);
  await page.locator(".card.bridge").waitFor();
  await scrollTo(planSection.locator(".notice"), 24);
  await held();
} else {
  console.log("note: planning is open on the public page, so it says so in place of the caption about a recording");
  held = say(SAY.open, 9);
  await point(page, page.getByRole("button", { name: /^Plan a visit for / }));
  await held();
}

if (DRY) {
  // The rest of the walk, on the recorded plan: it tries every scroll the paid take makes.
  held = say(SAY.bridge, 4);
  await scrollTo(planSection.locator("h2"), 16);
  await held();
  held = say(SAY.visit, 5);
  await scrollTo(visit.locator("h2").first(), 16);
  await sleep(1800);
  await scrollTo(moments.nth(2), 16);
  await held();
  held = say(SAY.questions, 4);
  await scrollTo(questionsHeading, 16);
  await held();
  held = say(SAY.models, 4);
  await openHow();
  await scrollTo(steps, 16);
  await held();
  held = say(SAY.own, 5);
  await press(page, ownButton);
  await scrollTo(page.locator("#own"), 16);
  await held();
  held = say(SAY.privacy, 4);
  await scrollTo(page.locator("#privacy"), 16);
  await held();
  if (PREVIEW_URL) {
    held = say(SAY.live, 4);
    await page.goto(PREVIEW_URL, { waitUntil: "networkidle" });
    await page.evaluate(drawPointer);
    await held();
  }
} else {
  // B. Two live plans: on a test preview with planning on, or on the public page itself once planning is on there.
  held = say(new URL(PREVIEW_URL).origin === new URL(PUBLIC_URL).origin ? SAY.here : SAY.live, 6);
  await page.goto(PREVIEW_URL, { waitUntil: "networkidle" });
  await page.evaluate(drawPointer);
  const planButton = page.getByRole("button", { name: /^Plan a visit for / });
  await planButton.waitFor({ timeout: 15_000 });
  await point(page, planButton);
  await held();

  held = say(SAY.models, 7);
  let finished = planRequest(page);
  await press(page, planButton);
  await page.locator("main[data-shown=live] ul.steps li").first().waitFor({ state: "attached", timeout: 30_000 });
  await openHow();
  await scrollTo(steps, 16);
  await follow(page);
  await held();
  held = say(SAY.gather, 7);
  await held();
  held = say(SAY.write, 9);
  const first = await finished();
  await unfollow(page);
  check("the first plan arrives", first.status === 200 && first.plan, first.failure ?? `status ${first.status}`);
  if (!first.plan) throw new Error("no first plan: the take cannot go on");
  check("the first plan is the work of Super, Ultra and a rule", first.doers.join(",") === "rule,super,ultra", first.doers.join(", "));
  await held();

  held = say(SAY.bridge, 9);
  await scrollTo(planSection.locator("h2"), 16);
  await point(page, page.locator(".card.bridge .sources").first());
  await held();

  const hasPlace = first.plan.moments.some((m) => m.kind === "place");
  held = say(SAY.visit + (hasPlace ? SAY.place : ""), 10);
  await scrollTo(visit.locator("h2").first(), 16);
  await sleep(3200);
  await scrollTo(moments.nth(Math.max(0, Math.min(2, first.plan.moments.length - 1))), 16);
  await held();

  held = say(SAY.questions, 8);
  await scrollTo(questionsHeading, 16);
  await held();

  const cards = [first.plan.bridge, ...first.plan.moments];
  const feedback = page.locator(".card.feedback");
  held = say(SAY.after, 11);
  await scrollTo(page.getByRole("heading", { name: "After the visit" }), 16);
  for (const item of cards.filter((c) => MUSIC.has(c.kind))) {
    await press(page, feedback.getByLabel(item.title, { exact: true }));
    await sleep(350);
  }
  await press(page, feedback.locator("textarea"));
  await feedback.locator("textarea").pressSequentially(FEEDBACK, { delay: 55 });
  await held();

  held = say(SAY.nano, 9);
  finished = planRequest(page);
  await press(page, feedback.getByRole("button", { name: "Plan the next visit" }));
  await page.locator("main[data-shown=live] ul.steps li").first().waitFor({ state: "attached", timeout: 30_000 });
  await openHow();
  await scrollTo(steps, 16);
  await held();
  held = say(SAY.next, 9);
  await follow(page);
  const second = await finished();
  await unfollow(page);
  check("the second plan arrives", second.status === 200 && second.plan, second.failure ?? `status ${second.status}`);
  if (!second.plan) throw new Error("no second plan: the take cannot go on");
  check("Nano read how the visit went", second.doers.includes("nano"), second.doers.join(", "));
  const after = [second.plan.bridge, ...second.plan.moments];
  const music = (list) => list.filter((c) => MUSIC.has(c.kind)).length;
  check("the next plan has more music", music(after) > music(cards), `${music(cards)} then ${music(after)}`);
  check("the next plan has no film", !after.some((c) => c.kind === "film"), after.map((c) => c.kind).join(", "));
  const before = new Set(cards.map((c) => c.title));
  check("nothing is repeated", !after.some((c) => before.has(c.title)));
  await scrollTo(planSection.locator("h2"), 16);
  await sleep(3000);
  await scrollTo(visit.locator("h2").first(), 16);
  await held();
  await sleep(3500);

  held = say(SAY.own, 7);
  await scrollTo(page.locator("h1"), 40, 1300);
  await press(page, ownButton);
  await sleep(1200);
  await scrollTo(page.locator("#own"), 16);
  await held();

  held = say(SAY.privacy, 9);
  await scrollTo(page.locator("#privacy"), 16);
  await held();

  held = say(SAY.close, 7);
  await scrollTo(page.locator("h1"), 40, 1500);
  await held();
  console.log(`cost of the two plans: $${(first.costUsd + second.costUsd).toFixed(4)}`);
  console.log(`kinds: ${cards.map((c) => c.kind).join(", ")}  then  ${after.map((c) => c.kind).join(", ")}`);
}

const end = now();
await camera.stop();
check("no console error", consoleErrors.length === 0, consoleErrors.join(" | ").slice(0, 200));

// Still pictures, after the camera has stopped: from this page as it stands, and from the public page.
const views = [
  ["1-first-screen", page.locator("h1"), 32],
  ["2-steps", steps, 12],
  ["3-bridge", planSection.locator("h2"), 12],
  ["4-visit", visit.locator("h2").first(), 12],
  ["5-questions", questionsHeading, 12],
  ["6-own-family", page.locator("#own"), 12],
  ["7-what-is-sent", page.locator("#privacy"), 12],
];
await page.evaluate(() => document.getElementById("recorder-pointer")?.remove());
if (!DRY) await stills(page, "live", views);
// The public page shows its saved plan on arrival; the fold and the form are opened for their pictures.
await page.goto(PUBLIC_URL, { waitUntil: "networkidle" });
await page.locator(".card.bridge").waitFor();
await page.locator("details.how summary").click();
await page.getByRole("button", { name: "Tell us about your grandparent and you" }).click();
await stills(page, "public", [...views, ["8-why", page.locator("#why"), 12]]);
await browser.close();

const { frames } = camera;
if (frames.length === 0) throw new Error("the camera took no frame");
const start = frames[0].at;
check("the camera's clock and this script's agree", Math.abs(start - captions[0].at) < 5, `${(captions[0].at - start).toFixed(2)} s apart`);
finish({
  recordedAt: new Date().toISOString(),
  publicUrl: PUBLIC_URL,
  dry: DRY,
  length: end - start,
  captions: captions.map((c, i) => ({ from: c.at - start, to: (captions[i + 1]?.at ?? end) - start - 0.12, text: c.text })),
  frames: frames.map((f) => ({ file: f.file, at: f.at - start })),
});
