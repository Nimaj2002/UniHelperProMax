/**
 * 020 T064 (US9, SC-007): with a recording and a timer running together, each "Indicator when
 * recording and timer run together" option shows them as specified, and stopping the timer never
 * hides or stops the recording.
 */
import { expect, test, type Page } from "@playwright/test";
import { signIn, tag } from "./helpers";
import { seedCourse, workspaceUrl } from "./notes-helpers";

test.describe.configure({ mode: "serial" });

const activity = (page: Page) => page.getByRole("region", { name: "Activity" });
const recording = (page: Page) => activity(page).getByRole("region", { name: "Recording", exact: true });
const timerPill = (page: Page) => activity(page).getByRole("region", { name: "Timer", exact: true });

/** Client-side navigation, so the recording keeps going (a reload would interrupt it). */
async function go(page: Page, path: string) {
  await page.evaluate((p) => {
    window.history.pushState({}, "", p);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, path);
}

async function choose(page: Page, name: string) {
  await go(page, "/settings/time");
  await page.getByRole("radio", { name }).check();
  await expect(page.getByRole("radio", { name })).toBeChecked();
}

test("each indicator option keeps the recording visible and independent", async ({ page }, testInfo) => {
  const t = tag(testInfo.project.name);
  await signIn(page);
  const { courseId, lineageId } = await seedCourse(page, `TMR${t} 101`);
  const session = workspaceUrl(courseId, lineageId, "2026-10-05");
  await page.goto(session);
  const panel = page.getByRole("complementary", { name: "Session panel" });
  await panel.getByRole("button", { name: "Start timer" }).click();
  await panel.getByRole("button", { name: "Record", exact: true }).click();
  await expect(panel.getByText("Recording", { exact: true })).toBeVisible();

  // (1) one combined indicator (default): both side by side, each with its own controls
  await choose(page, "One combined indicator");
  const combined = activity(page).getByRole("region", { name: "Recording and timer" });
  await expect(combined).toBeVisible();
  await expect(combined.getByRole("region", { name: "Recording", exact: true })).toBeVisible();
  await expect(combined.getByRole("button", { name: "Stop timer" })).toBeVisible();

  // (2) two indicators, stacked: the recording one above the timer one
  await choose(page, "Two indicators, stacked");
  await expect(combined).toHaveCount(0);
  const [rec, tim] = [await recording(page).boundingBox(), await timerPill(page).boundingBox()];
  expect(rec && tim && rec.y < tim.y).toBe(true);

  // (3) recording first: only the recording indicator, with a badge for the timer
  await choose(page, "Recording first");
  await expect(timerPill(page)).toHaveCount(0);
  await expect(recording(page)).toContainText("Timer running");

  // stopping the timer never touches the recording; its own pill doesn't come back meanwhile
  await choose(page, "One combined indicator");
  await combined.getByRole("button", { name: "Stop timer" }).click();
  await expect(recording(page)).toBeVisible();
  await expect(timerPill(page)).toHaveCount(0);
  await recording(page).getByRole("button", { name: "Stop" }).click();
  await expect(recording(page)).toHaveCount(0);
});
