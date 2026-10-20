import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signIn, tag } from "./helpers";
import { seedCourse, workspaceUrl } from "./notes-helpers";

async function audioPanel(page: Page) {
  const panel = page.getByRole("complementary", { name: "Session panel" });
  await expect(panel.getByRole("button", { name: "Record", exact: true })).toBeVisible();
  return panel;
}

test("US1/US3/US4: record with the fake mic, stop from the global bar, play and seek", async ({ page }, testInfo) => {
  const t = tag(testInfo.project.name);
  await signIn(page);
  const { courseId, lineageId } = await seedCourse(page, `REC${t} 101`);
  await page.goto(workspaceUrl(courseId, lineageId, "2026-10-05"));
  const panel = await audioPanel(page);

  await panel.getByRole("button", { name: "Record", exact: true }).click();
  await expect(panel.getByText("Recording", { exact: true })).toBeVisible();
  const bar = page.getByRole("region", { name: "Recording", exact: true });
  await expect(bar).toBeVisible();
  const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(scan.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);

  // keeps recording while navigating elsewhere (US3), stop from the bar
  await page.waitForTimeout(6500);
  await page.getByRole("link", { name: "UniHelperProMax" }).or(page.getByRole("button", { name: /home/i })).first().click();
  await expect(page).toHaveURL(/\/calendar/);
  await expect(bar).toBeVisible();
  await bar.getByRole("button", { name: "Stop" }).click();
  await expect(bar).toBeHidden();

  // back in the session: complete recording with a duration, playable and seekable
  await page.goto(workspaceUrl(courseId, lineageId, "2026-10-05"));
  const item = page.getByRole("button", { name: /^Recording \d{2}:\d{2}/ }).first();
  await expect(item).toContainText(/0:0[6-9]|0:1\d/, { timeout: 15000 });
  await item.click();
  const player = page.getByRole("group", { name: /^Player: Recording/ });
  await expect(player).toBeVisible();
  const playerScan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(playerScan.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
  await expect(player.getByRole("slider", { name: "Seek" })).toBeVisible();

  // the player always fits the session panel, which is resizable from its edge (014: 300–640 px)
  const aside = page.getByRole("complementary", { name: "Session panel" });
  const fits = async () => {
    const a = (await aside.boundingBox())!;
    for (const el of [player, player.getByRole("button", { name: "Mute" }), player.getByRole("slider", { name: "Volume" })]) {
      const b = (await el.boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(a.x);
      expect(b.x + b.width).toBeLessThanOrEqual(a.x + a.width + 0.5);
    }
    expect(await aside.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
  };
  await fits();
  const splitter = page.getByRole("separator", { name: "Resize session panel" });
  await splitter.hover();
  if (testInfo.project.name.endsWith("light")) await page.screenshot({ path: testInfo.outputPath("splitter-hover.png") });
  await splitter.focus();
  await page.keyboard.press("Home");
  await expect(splitter).toHaveAttribute("aria-valuenow", "300");
  await fits();
  if (testInfo.project.name.endsWith("light")) await page.screenshot({ path: testInfo.outputPath("narrow.png") });
  await page.keyboard.press("ArrowLeft");
  await expect(splitter).toHaveAttribute("aria-valuenow", "316");
  const box = (await splitter.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 100, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(splitter).toHaveAttribute("aria-valuenow", "416");
  expect(Math.round((await aside.boundingBox())!.width)).toBe(416);
  await fits();
  await page.reload();
  await expect(page.getByRole("separator", { name: "Resize session panel" })).toHaveAttribute("aria-valuenow", "416"); // remembered
  await page.getByRole("separator", { name: "Resize session panel" }).dblclick();
  await expect(page.getByRole("separator", { name: "Resize session panel" })).toHaveAttribute("aria-valuenow", "360");
  await item.click();
  await expect(player).toBeVisible();
  const duration = await page.locator("audio").evaluate((a: HTMLAudioElement) =>
    new Promise<number>((resolve) => {
      if (Number.isFinite(a.duration) && a.duration > 0) return resolve(a.duration);
      a.addEventListener("durationchange", () => Number.isFinite(a.duration) && resolve(a.duration));
      a.load();
    }),
  );
  expect(duration).toBeGreaterThan(5);
  await player.getByRole("button", { name: "Play" }).click();
  await expect(player.getByRole("button", { name: "Pause" })).toBeVisible();
  await player.getByRole("button", { name: "Forward 5 seconds" }).click();
  const after = await page.locator("audio").evaluate((a: HTMLAudioElement) => a.currentTime);
  expect(after).toBeGreaterThanOrEqual(4.5);
  const seekable = await page.locator("audio").evaluate((a: HTMLAudioElement) =>
    a.seekable.length ? a.seekable.end(a.seekable.length - 1) : 0,
  );
  expect(seekable).toBeGreaterThan(5);
  await player.getByRole("button", { name: "Stop" }).click();
  expect(await page.locator("audio").evaluate((a: HTMLAudioElement) => a.currentTime)).toBe(0);
  await player.getByRole("button", { name: "Mute" }).click();
  await expect(player.getByRole("button", { name: "Unmute" })).toBeVisible();
  await player.getByRole("button", { name: "Unmute" }).click();
});

test("US2: reload mid-recording → recovered interrupted recording; offline → pending → complete", async ({ page }, testInfo) => {
  const t = tag(testInfo.project.name);
  await signIn(page);
  const { courseId, lineageId } = await seedCourse(page, `CRASH${t} 101`);
  const url = workspaceUrl(courseId, lineageId, "2026-10-07");
  await page.goto(url);
  let panel = await audioPanel(page);
  await panel.getByRole("button", { name: "Record", exact: true }).click();
  await expect(page.getByRole("region", { name: "Recording", exact: true })).toBeVisible();
  await page.waitForTimeout(11_000); // two 5 s chunks reach the server
  page.on("dialog", (d) => void d.accept()); // beforeunload prompt
  await page.reload();
  panel = await audioPanel(page);
  const recovered = panel.getByRole("button", { name: /^Recording/ }).filter({ hasText: "Recovered (interrupted)" });
  await expect(recovered).toBeVisible({ timeout: 45_000 });
  await expect(recovered).toContainText(/0:(0[8-9]|1\d)/);

  // offline while recording: chunks wait on the device, then upload
  await panel.getByRole("button", { name: "Record", exact: true }).click();
  await page.route("**/api/v1/recordings/*/chunks/*", (r) => r.abort());
  await page.waitForTimeout(6000);
  await page.getByRole("region", { name: "Recording", exact: true }).getByRole("button", { name: "Stop" }).click();
  await expect(panel.getByText("Upload pending").first()).toBeVisible();
  await page.unroute("**/api/v1/recordings/*/chunks/*");
  await expect(panel.getByText("Upload pending")).toHaveCount(0, { timeout: 30_000 });
  const done = panel.getByRole("button", { name: /^Recording/ }).first();
  await expect(done).toBeEnabled({ timeout: 15_000 }); // active recordings are not selectable
  await expect(done).toContainText(/0:0[5-9]/);
});
