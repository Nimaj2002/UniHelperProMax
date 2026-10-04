import { expect, test } from "@playwright/test";
import { signIn, tag } from "./helpers";
import { editor, newNote, seedCourse, waitSaved, workspaceUrl } from "./notes-helpers";

test("US3/US4: switch sessions keeps tabs and text; rename, close, delete", async ({ page }, testInfo) => {
  const t = tag(testInfo.project.name);
  await signIn(page);
  const { courseId, lineageId } = await seedCourse(page, `SWITCH${t} 101`);
  await page.goto(workspaceUrl(courseId, lineageId, "2026-09-28"));
  await newNote(page, "A");
  await editor(page).pressSequentially("alpha");
  await newNote(page, "B");
  await editor(page).pressSequentially("beta typed right before switching");

  // switch immediately via the left timeline (US3 #2, #4)
  const t0 = Date.now();
  await page
    .getByRole("navigation", { name: "Sessions of this course" })
    .getByRole("region", { name: "September 2026" })
    .getByRole("link", { name: /^30 Wed/ })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Wed 30 Sep 2026");
  await expect(page.getByText("No notes for this session yet.")).toBeVisible();
  expect(Date.now() - t0).toBeLessThan(1000);

  // come back: same tabs, B active, text saved
  await page.goBack();
  await expect(page.getByRole("tab", { name: /^B/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: /^A/ })).toBeVisible();
  await expect(editor(page)).toContainText("beta typed right before switching");
  await waitSaved(page, "B");

  // rename (US4 #2)
  await page.getByRole("button", { name: "Actions for A", exact: true }).click();
  await page.getByRole("menuitem", { name: "Rename…" }).click();
  const rename = page.getByRole("dialog", { name: "Rename note" });
  await rename.getByLabel("Note name").fill("Midterm review");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name: /^Midterm review/ })).toBeVisible();

  // close a tab: note stays in the list (US4 #3)
  await page.getByRole("tab", { name: /^Midterm review/ }).press("Delete");
  await expect(page.getByRole("tab", { name: /^Midterm review/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Midterm review", exact: true })).toBeVisible();

  // delete with confirmation (US4 #4)
  await page.getByRole("button", { name: "Actions for B", exact: true }).click();
  await page.getByRole("menuitem", { name: "Delete…" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Delete “B”?" });
  await expect(confirm).toContainText("B.md");
  await confirm.getByRole("button", { name: "Delete note" }).click();
  await expect(page.getByRole("button", { name: "B", exact: true })).toHaveCount(0);
  await expect(page.getByRole("tab")).toHaveCount(0);
});
