// Website/README screenshots: `corepack pnpm exec playwright test -c playwright.screenshots.config.ts`.
// Same servers as the e2e suite (fresh data dir, fake LLM and transcriber), one light project.
import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
  ...base,
  testDir: "./tests/screenshots",
  timeout: 300_000,
  reporter: [["list"]],
  projects: [
    {
      name: "screenshots",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: "light" },
    },
  ],
});
