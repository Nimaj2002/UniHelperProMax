import { defineConfig, devices } from "@playwright/test";

const backendPort = 8000;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: "http://localhost:5173", trace: "retain-on-failure" },
  projects: [
    { name: "chromium-light", use: { ...devices["Desktop Chrome"], colorScheme: "light" } },
    { name: "chromium-dark", use: { ...devices["Desktop Chrome"], colorScheme: "dark" } },
  ],
  webServer: [
    {
      // fresh data dir per run so setup flows start from an empty installation
      command: `rm -rf ../data-e2e && cd ../backend && UNIHELPER_DATA_DIR=../data-e2e uv run uvicorn unihelper.main:app --port ${backendPort}`,
      url: `http://localhost:${backendPort}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "corepack pnpm dev --port 5173 --strictPort",
      url: "http://localhost:5173",
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
