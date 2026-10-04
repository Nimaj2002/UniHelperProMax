import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test.use({ viewport: { width: 390, height: 844 } });

test("Narrow screens: drawer panel, day view, no horizontal scroll", async ({ page }) => {
  await signIn(page);
  await page.goto("/calendar");
  await expect(page).toHaveURL(/\/calendar/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveAccessibleName(/^\w+day, \d{1,2} \w+ \d{4}$/); // day view
  await expect(page.getByRole("button", { name: "Previous day" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  await expect(page.getByRole("navigation", { name: "Courses" })).toHaveCount(0);
  await page.getByRole("button", { name: "Show course panel" }).click();
  const drawer = page.getByRole("dialog", { name: "Courses" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("searchbox", { name: "Search courses" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
});
