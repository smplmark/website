import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

// The website Worker is a thin routing shim over static assets (no D1, no secrets), so the test
// config is minimal. Bindings (just ASSETS) come from wrangler.jsonc.
export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        bindings: {
          // vitest auto-loads .dev.vars; blank it so tests exercise the PRODUCTION app-host
          // redirects (the DEV_APP_ORIGIN dev-loop behavior is exercised via wrangler dev).
          DEV_APP_ORIGIN: "",
        },
      },
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
