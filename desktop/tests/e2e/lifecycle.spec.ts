// T031: the app loads from its own backend with no login; no backend survives a quit or a crash.
import { expect, test } from "@playwright/test";
import { appWindow, backendPids, launchApp, newProfile, quit, waitUntil } from "./helpers";

test("loads the app from the backend without a login screen, and quitting stops the backend", async () => {
  const before = new Set(backendPids());
  const profile = await newProfile();
  const app = await launchApp(profile);
  const page = await appWindow(app, profile);
  await page.waitForLoadState("domcontentloaded");
  await expect(page).not.toHaveURL(/\/(login|setup)/);
  const status = await page.evaluate(async () => (await fetch("/api/v1/setup/status")).json());
  expect(status).toEqual({ needsOwner: false, mode: "desktop" });
  const ours = backendPids().filter((p) => !before.has(p));
  expect(ours.length).toBe(1);

  await quit(app);
  expect(await waitUntil(() => !backendPids().includes(ours[0]), 5_000)).toBe(true);
});

test("killing the app leaves no backend behind", async () => {
  const before = new Set(backendPids());
  const profile = await newProfile();
  const app = await launchApp(profile);
  await appWindow(app, profile);
  const ours = backendPids().filter((p) => !before.has(p));
  expect(ours.length).toBe(1);

  // Kill the Electron main process itself: on Windows app.process() is the cmd.exe wrapper
  // Playwright launches it through, and killing that leaves the app running.
  const mainPid = await app.evaluate(() => process.pid);
  process.kill(mainPid, "SIGKILL"); // TerminateProcess on Windows
  expect(await waitUntil(() => !backendPids().includes(ours[0]), 10_000)).toBe(true);
});
