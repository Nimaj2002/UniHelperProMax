import { defineConfig, devices } from "@playwright/test";

// 024: the browser demo, served from its static build (run `corepack pnpm build:demo` first).
// No backend, no fake servers, and no fake microphone: the demo must never ask for one.
const port = Number(process.env.E2E_DEMO_PORT ?? 5184);

export default defineConfig({
  testDir: "./tests/e2e-demo",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report-demo" }]],
  use: { baseURL: `http://localhost:${port}`, trace: "retain-on-failure" },
  projects: [
    { name: "chromium-light", use: { ...devices["Desktop Chrome"], colorScheme: "light" } },
    { name: "chromium-dark", use: { ...devices["Desktop Chrome"], colorScheme: "dark" } },
  ],
  webServer: {
    command: `corepack pnpm exec vite preview --mode demo --outDir dist-demo --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
