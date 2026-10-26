// The saved port is taken: fall back to the next free one and keep it (FR-021 as amended), but
// never while the window's storage under the saved port still holds unsent work (FR-022).
import { expect, test } from "@playwright/test";
import fs from "node:fs";
import net from "node:net";
import { launchApp, newProfile, quit } from "./helpers";

function hold(port: number): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(port, "127.0.0.1", () => resolve(s));
  });
}

async function errorText(app: Awaited<ReturnType<typeof launchApp>>): Promise<string> {
  const page = await app.firstWindow();
  const message = page.locator("#error-message");
  await expect(message).toBeVisible({ timeout: 60_000 });
  return (await message.textContent()) ?? "";
}

test("a taken port falls back to the next one, which is then kept", async () => {
  const profile = await newProfile();
  const blocker = await hold(profile.port);
  try {
    const app = await launchApp(profile);
    const page = await app.firstWindow();
    await page.waitForURL(`http://127.0.0.1:${profile.port + 1}/**`, { timeout: 60_000 });
    const saved = JSON.parse(fs.readFileSync(profile.settingsFile, "utf8"));
    expect(saved.port).toBe(profile.port + 1);
    const info = await page.evaluate(() => window.uhDesktop?.info());
    expect(info?.port).toBe(profile.port + 1);
    await quit(app);
  } finally {
    blocker.close();
  }
});

test("no fallback while unsent work waits under the saved port", async () => {
  const profile = await newProfile({ lastGuardState: { pending: true, recording: false, at: new Date().toISOString() } });
  const blocker = await hold(profile.port);
  try {
    const app = await launchApp(profile);
    expect(await errorText(app)).toContain(`Port ${profile.port} is in use`);
    expect(await errorText(app)).toContain("won't switch");
    expect(JSON.parse(fs.readFileSync(profile.settingsFile, "utf8")).port).toBe(profile.port);
    await app.close();
  } finally {
    blocker.close();
  }
});

test("every candidate taken shows the port error page", async () => {
  const profile = await newProfile();
  const blockers = await Promise.all([0, 1, 2, 3, 4].map((i) => hold(profile.port + i)));
  try {
    const app = await launchApp(profile);
    expect(await errorText(app)).toContain(`Ports ${profile.port}–${profile.port + 4} are all in use`);
    await app.close();
  } finally {
    blockers.forEach((b) => b.close());
  }
});
