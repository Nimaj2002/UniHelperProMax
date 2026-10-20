import { defineConfig, devices } from "@playwright/test";

// override with E2E_BACKEND_PORT / E2E_FRONTEND_PORT to run next to a dev server
const backendPort = Number(process.env.E2E_BACKEND_PORT ?? 8000);
const frontendPort = Number(process.env.E2E_FRONTEND_PORT ?? 5173);
const transcriberPort = Number(process.env.E2E_TRANSCRIBER_PORT ?? 8020);
const llmPort = Number(process.env.E2E_LLM_PORT ?? 8021);

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://localhost:${frontendPort}`,
    trace: "retain-on-failure",
    // fake microphone for recording tests (feature 003)
    permissions: ["microphone"],
    launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
  },
  projects: [
    {
      name: "chromium-light",
      use: {
        ...devices["Desktop Chrome"],
        colorScheme: "light",
        launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
      },
    },
    {
      name: "chromium-dark",
      use: {
        ...devices["Desktop Chrome"],
        colorScheme: "dark",
        launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
      },
    },
  ],
  webServer: [
    {
      // predictable OpenAI-style transcription server for feature 004
      command: `cd ../backend && uv run uvicorn tests.fake_transcriber:app --port ${transcriberPort}`,
      url: `http://localhost:${transcriberPort}/v1/models`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      // 014: scripted fake of the three AI request styles (OpenAI-compatible, Anthropic, Gemini)
      command: `cd ../backend && uv run uvicorn tests.fake_llm:app --port ${llmPort}`,
      url: `http://localhost:${llmPort}/v1/models`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      // fresh data dir per run so setup flows start from an empty installation; the secret
      // store's key file lives outside it (014)
      command: `rm -rf ../data-e2e ../data-e2e-keys && cd ../backend && UNIHELPER_DATA_DIR=../data-e2e UNIHELPER_KEY_STORE=file UNIHELPER_KEY_FILE=../data-e2e-keys/master.key uv run uvicorn unihelper.main:app --port ${backendPort}`,
      url: `http://localhost:${backendPort}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `UNIHELPER_API_PORT=${backendPort} corepack pnpm dev --port ${frontendPort} --strictPort`,
      url: `http://localhost:${frontendPort}`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
