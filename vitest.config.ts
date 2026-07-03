import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

// The website Worker is a thin routing shim over static assets (no D1, no secrets), so the test
// config is minimal. Bindings (just ASSETS) come from wrangler.jsonc.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
  test: {
    coverage: {
      provider: "istanbul",
      include: ["src/**/*.ts"],
      exclude: ["**/*.d.ts"],
      thresholds: { lines: 90, branches: 90, functions: 90, statements: 90 },
    },
  },
});
