import { defineConfig } from "@playwright/test";

// The scripted demo run (STACK_AND_GATE.md, gate layer 2): a real browser against a deployed URL.
// It makes real plans, about $0.03 each, so check.sh never runs it.
//
//   DEMO_URL=https://... npm run demo:e2e
//
// A preview behind the Vercel login needs a short-lived token (VERCEL_OIDC_TOKEN). This passes it without printing
// it; `vercel env pull .env.local --yes` renews it when it has expired (it lasts 12 hours):
//
//   vercel env run -- sh -c 'DEMO_URL=https://... npm run demo:e2e'
//
// e2e/helpers.ts attaches the token to requests for DEMO_URL's own origin only.

export default defineConfig({
  testDir: "e2e",
  timeout: 420_000,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  // Screenshots and traces show names Qloo returned, so they go to the folder git ignores.
  outputDir: ".qloo/e2e-results",
  use: {
    baseURL: process.env.DEMO_URL,
    viewport: { width: 375, height: 667 },
    screenshot: "only-on-failure",
  },
});
