import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

// below 1100 px the side cards open over the main card (008 FR-030); below 800 px is out of scope
test.use({ viewport: { width: 1000, height: 700 } });

test("Narrow windows: side panel over the main card, day view, no horizontal scroll", async ({ page }) => {
  await signIn(page);
  await page.goto("/calendar");
  await expect(page).toHaveURL(/\/calendar/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveAccessibleName(/^\w+day, \d{1,2} \w+ \d{4}$/); // day view
  await expect(page.getByRole("button", { name: "Previous day" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  await expect(page.getByRole("navigation", { name: "Courses" })).toHaveCount(0);
  const show = page.getByRole("button", { name: "Show side panel" });
  await show.click();
  const overlay = page.getByRole("dialog", { name: "Side panel" });
  await expect(overlay).toBeVisible();
  await expect(overlay.getByRole("searchbox", { name: "Search courses" })).toBeVisible();
  await expect(overlay.getByRole("button", { name: "Settings" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(overlay).toBeHidden();
  await expect(show).toBeFocused();
});
