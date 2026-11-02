/** 019 US1: a changed shortcut works everywhere at once, the old key stops, hints follow, reload keeps it. */
import { expect, test, type Page } from "@playwright/test";
import { signIn, tag } from "./helpers";
import { seedCourse, workspaceUrl } from "./notes-helpers";

async function resetShortcuts(page: Page) {
  const csrf = (await page.context().cookies()).find((c) => c.name === "uh_csrf")?.value ?? "";
  const r = await page.request.patch("/api/v1/preferences", { data: { shortcuts: {} }, headers: { "X-CSRF-Token": csrf } });
  expect(r.ok()).toBe(true);
}

test("US1: change New note to Alt+Shift+M", async ({ page }, testInfo) => {
  const t = tag(testInfo.project.name);
  await signIn(page);
  await resetShortcuts(page); // the account is shared by the other specs
  try {
    const { courseId, lineageId } = await seedCourse(page, `KEYS${t} 101`);

    await page.goto("/settings/shortcuts");
    await page.getByRole("button", { name: /^Key for New note: Alt \+ N\./ }).click();
    await page.keyboard.press("Alt+Shift+KeyM");
    await expect(page.getByRole("button", { name: /^Key for New note: Alt \+ Shift \+ M\./ })).toBeVisible();

    await page.goto(workspaceUrl(courseId, lineageId, "2026-09-28"));
    const newNoteButton = page.getByRole("button", { name: "New note" }).first();
    await expect(newNoteButton).toHaveAttribute("aria-keyshortcuts", "Alt+Shift+M");
    const dialog = page.getByRole("dialog", { name: "New note" });
    await page.keyboard.press("Alt+KeyN");
    await expect(dialog).toBeHidden(); // the old key does nothing
    await page.keyboard.press("Alt+Shift+KeyM");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");

    await page.reload();
    await expect(page.getByRole("button", { name: "New note" }).first()).toHaveAttribute("aria-keyshortcuts", "Alt+Shift+M");
  } finally {
    await resetShortcuts(page);
  }
});
