import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { signIn, tag } from "./helpers";

test("US5: owner creates a member who must change password and sees an empty calendar", async ({ page }, testInfo) => {
  const member = `ali-${tag(testInfo.project.name).toLowerCase()}`;
  await signIn(page);

  // owner → account menu → Manage accounts (keyboard only)
  await page.getByRole("button", { name: "Account menu" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("menuitem", { name: "Manage accounts" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Accounts" })).toBeVisible();
  const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(scan.violations.map((v) => v.id)).toEqual([]);

  await page.getByRole("button", { name: "New account" }).click();
  const dialog = page.getByRole("dialog", { name: "New account" });
  await dialog.getByLabel("Username").fill(member);
  await dialog.getByLabel("Temporary password").fill("temporary-pass-1");
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("row", { name: new RegExp(member) })).toContainText("Must change password");

  // sign out; no public registration exists
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("link", { name: /sign up|register|create account/i })).toHaveCount(0);

  // member signs in → forced password change → own (empty) calendar
  await page.getByLabel("Username").fill(member);
  await page.getByLabel("Password").fill("temporary-pass-1");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/account\/password$/);
  await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
  await page.getByLabel("Current password").fill("temporary-pass-1");
  await page.getByLabel("New password", { exact: true }).fill("my-own-password-1");
  await page.getByLabel("Confirm new password").fill("my-own-password-1");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/calendar/);
  await expect(page.getByText("No courses yet.")).toBeVisible();
  await page.goto("/calendar/week/2026-10-05");
  await expect(page.locator("[data-session-key]")).toHaveCount(0);

  // a member cannot open the admin page
  await page.goto("/admin/accounts");
  await expect(page).toHaveURL(/\/calendar/);
});
