import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Offline tests only: no network, no keys, no cost. Live checks live in vitest.live.config.ts.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/**/*.live.test.ts", "node_modules/**"],
    environment: "node",
  },
});
