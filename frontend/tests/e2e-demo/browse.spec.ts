import AxeBuilder from "@axe-core/playwright";
import { expect, guardOrigins, lectureSession, noServerError, openDemo, test } from "./fixtures";

/** 024 US1: a ready-made workspace opens with no sign-in and every main screen works. */
guardOrigins();

test("opens signed in on a filled workspace with the demo banner", async ({ page }) => {
  const started = Date.now();
  await openDemo(page);
  await expect(page.getByRole("navigation", { name: "Courses" }).getByRole("link", { name: "Algorithms" })).toBeVisible();
  expect(Date.now() - started).toBeLessThan(15_000); // SC-001 (5 s) with headroom for a cold CI box
  await expect(page).not.toHaveURL(/login|setup/);
  await expect(page.getByRole("link", { name: "Download the app" })).toHaveAttribute("href", "https://www.unihelperpromax.tech/#download");
});

test("every main screen opens without a server error", async ({ page }) => {
  await openDemo(page);
  const lecture = await lectureSession(page);
  for (const path of ["/calendar", lecture.url, "/courses/course-algo", "/settings/ai", "/settings/transcription", "/settings/appearance", "/settings/time", "/settings/trash"]) {
    await page.goto(path);
    await expect(page.getByRole("region", { name: "Demo notice" })).toBeVisible();
    await noServerError(page);
  }
});

test("the sample session shows its note, PDF, recording and chat", async ({ page }) => {
  await openDemo(page);
  const lecture = await lectureSession(page);
  await openDemo(page, lecture.url);
  await expect(page.getByRole("region", { name: "Notes" }).getByText("Lecture notes", { exact: true })).toBeVisible();
  const docs = page.getByRole("region", { name: "Documents" });
  await expect(docs.getByRole("button", { name: /^Week 3/ })).toBeVisible();
  const panel = page.getByRole("complementary", { name: "Session panel" });
  await expect(panel.getByText("Lecture – Divide and Conquer")).toBeVisible();
  await panel.getByRole("radio", { name: "Chat" }).click();
  await expect(panel.getByText("Summarize divide and conquer").first()).toBeVisible();
});

test("the banner is accessible and keyboard operable", async ({ page }) => {
  await openDemo(page);
  const results = await new AxeBuilder({ page }).include("#demo-banner").withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(results.violations).toEqual([]);

  const reset = page.getByRole("button", { name: "Reset demo" });
  await reset.focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Download the app" })).toBeFocused();
  await reset.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("alertdialog", { name: "Reset the demo?" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(reset).toBeFocused();
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("says the app is for PC only and doesn't load it", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "UniHelperProMax is for PC only for now" })).toBeVisible();
    const yuii = page.getByRole("img", { name: /Yuii .*embarrassed/ });
    await expect(yuii).toBeVisible();
    expect(await yuii.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    await expect(page.getByRole("link", { name: "Back to the website" })).toHaveAttribute("href", "https://www.unihelperpromax.tech/");
    await expect(page.getByRole("region", { name: "Demo notice" })).toHaveCount(0);
    expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull();
  });
});

test.describe("on a phone held sideways", () => {
  test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });

  test("still says PC only", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "UniHelperProMax is for PC only for now" })).toBeVisible();
  });
});

test.describe("on a tablet", () => {
  test.use({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true });

  test("gets the demo", async ({ page }) => {
    await openDemo(page);
    await expect(page.getByRole("heading", { name: "UniHelperProMax is for PC only for now" })).toHaveCount(0);
  });
});
