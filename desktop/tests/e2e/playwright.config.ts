import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1, // each test starts a real backend; keep the machine calm
  retries: 0,
  reporter: [["list"]],
});
