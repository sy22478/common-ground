import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Live checks: call real APIs and spend real (small) money. Never run by check.sh.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    include: ["tests/**/*.live.test.ts"],
    environment: "node",
    testTimeout: 300_000,
    fileParallelism: false,
  },
});
