import { expect, test, type Page } from "@playwright/test";
import { signIn, tag } from "./helpers";
import { seedCourse, workspaceUrl } from "./notes-helpers";

/** The owner account is shared by every spec: always leave it on Ultimate. */
async function setMode(page: Page, uiMode: "ultimate" | "simple") {
  const csrf = (await page.context().cookies()).find((c) => c.name === "uh_csrf")?.value ?? "";
  const r = await page.request.patch("/api/v1/preferences", { data: { uiMode }, headers: { "X-CSRF-Token": csrf } });
  expect(r.status()).toBe(200);
}

test("026: choose Simple, walk courses → session → tools, then switch back", async ({ page }, testInfo) => {
  const course = `Simple ${tag(testInfo.project.name)} ${Date.now() % 100000}`;
  await signIn(page);
  try {
    const { courseId, lineageId } = await seedCourse(page, course);

    // choose Simple in Settings → Appearance
    await page.goto("/settings/appearance");
    await page.getByRole("radio", { name: /Simple/ }).check({ force: true });
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Side panel" })).toHaveCount(0); // no Ultimate panels
    for (const name of ["Calendar", "Courses", "Tasks"]) await expect(nav.getByRole("link", { name })).toBeVisible();
    await expect(nav.getByRole("link", { name: /Graph|Events/ })).toHaveCount(0);

    // the choice persists across a reload, and the landing page is the calendar
    await page.goto("/");
    await expect(page.locator("#calendar-panel")).toBeVisible();
    await expect(nav).toBeVisible();

    // Courses: a box per course, then the course
    await nav.getByRole("link", { name: "Courses" }).click();
    await page.getByLabel("Search courses").fill(course);
    await page.getByRole("link", { name: new RegExp(course) }).click();
    await expect(page.getByRole("heading", { name: course })).toBeVisible();

    // a session: the sidebar gains the session tools, which open the session panel
    await page.goto(workspaceUrl(courseId, lineageId, "2026-09-28"));
    await expect(nav.getByRole("button", { name: "Recordings" })).toBeVisible();
    await expect(nav.getByText("Session tools")).toHaveCount(0);
    await expect(nav.getByRole("button", { name: "Add a note" })).toBeVisible();
    await nav.getByRole("button", { name: "Recordings" }).click();
    await expect(page.locator("#session-recordings")).toBeVisible(); // in the main area, no pop-up
    await expect(page.getByRole("complementary", { name: "Session panel" })).toHaveCount(0);
    await nav.getByRole("button", { name: "Time" }).click();
    await expect(page.getByRole("region", { name: "Time" })).toBeVisible();
    await expect(page.getByRole("separator", { name: "Resize sidebar" })).toBeVisible();

    // switch back from the account menu
    await nav.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Switch to Ultimate" }).click();
    await expect(page.getByRole("complementary", { name: "Side panel" })).toBeVisible();
  } finally {
    await setMode(page, "ultimate");
  }
});
