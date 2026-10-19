import { expect, type Page } from "@playwright/test";

export const OWNER = { username: "owner", password: "owner-password-1" };

/** Create the owner on a fresh install, or sign in if it already exists. */
export async function signIn(page: Page, who = OWNER) {
  await page.goto("/");
  // 012: "/" is the home page (no redirect to /calendar any more)
  await expect(page.getByLabel("Username").or(page.locator("#main"))).toBeVisible({ timeout: 30_000 });
  if (page.url().includes("/setup")) {
    await page.getByLabel("Username").fill(who.username);
    await page.getByLabel("Password", { exact: true }).fill(who.password);
    await page.getByLabel("Confirm password").fill(who.password);
    await page.getByRole("button", { name: "Create account" }).click();
  } else if (page.url().includes("/login")) {
    await page.getByLabel("Username").fill(who.username);
    await page.getByLabel("Password").fill(who.password);
    await page.getByRole("button", { name: "Sign in" }).click();
  }
  await expect(page.locator("#calendar-panel")).toBeVisible({ timeout: 30_000 });
}

/**
 * "New class" / "New event" in the Calendar panel's header (012): a button, or an item of its
 * "More" menu when the panel is narrower than 640 px.
 */
export async function calendarAction(page: Page, name: "New class" | "New event") {
  const panel = page.locator("#calendar-panel");
  const button = panel.getByRole("button", { name, exact: true });
  if (await button.isVisible()) return button.click();
  await panel.getByRole("button", { name: "More calendar actions" }).click();
  await page.getByRole("menuitem", { name }).click();
}

/** Create a class through the API (fast seeding for E2E). */
export async function seedClass(page: Page, body: Record<string, unknown>) {
  const csrf = (await page.context().cookies()).find((c) => c.name === "uh_csrf")?.value ?? "";
  const r = await page.request.post("/api/v1/classes", { data: body, headers: { "X-CSRF-Token": csrf } });
  expect(r.status(), await r.text()).toBe(201);
  return r.json();
}

export function newHierarchy(course: string, semester = "Fall 2026", year = "2026", endDate = "2027-01-10") {
  return { new: { name: course, semester: { new: { name: semester, startDate: "2026-09-21", endDate, year: { new: { name: year } } } } } };
}

/** Unique per Playwright project: both colour-scheme projects share one backend. */
export function tag(projectName: string): string {
  return projectName.includes("dark") ? "D" : "L";
}
