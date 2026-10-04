import { writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { signIn, tag } from "./helpers";
import { editor, newNote, seedCourse, waitSaved, workspaceUrl } from "./notes-helpers";

const DATA = path.resolve(import.meta.dirname, "../../../data-e2e/files/owner");

test("Resilience: offline retry, external edit conflict (Keep both), large note", async ({ page }, testInfo) => {
  const t = tag(testInfo.project.name);
  const name = `RES${t} 101`;
  await signIn(page);
  const { courseId, lineageId } = await seedCourse(page, name);
  await page.goto(workspaceUrl(courseId, lineageId, "2026-10-05"));
  await newNote(page, "Lecture notes");
  await editor(page).pressSequentially("online text");
  await waitSaved(page, "Lecture notes");

  // network loss: text stays, retries, then saves (FR-019)
  await page.route("**/api/v1/notes/*/content", (route) => route.abort());
  await editor(page).pressSequentially(" + offline text");
  await expect(page.getByRole("tab", { name: /^Lecture notes/ })).toContainText("Not saved — retrying", { timeout: 5000 });
  await page.unroute("**/api/v1/notes/*/content");
  await waitSaved(page, "Lecture notes");

  // edited outside the app while open → conflict → Keep both (FR-020)
  const file = path.join(DATA, `Year ${name}`, `Sem ${name}`, name, "2026-10-05", "notes", "Lecture notes.md");
  writeFileSync(file, "changed in another editor");
  await editor(page).pressSequentially(" + mine");
  const dialog = page.getByRole("dialog", { name: "This note was changed outside the app" });
  await expect(dialog).toBeVisible({ timeout: 5000 });
  await expect(dialog.getByRole("button", { name: "Keep both" })).toBeFocused();
  await dialog.getByRole("button", { name: "Keep both" }).click();
  await expect(page.getByRole("tab", { name: /^Lecture notes \(my version\)/ })).toHaveAttribute("aria-selected", "true");
  await expect(editor(page)).toContainText("online text + offline text + mine");
  await page.getByRole("tab").filter({ hasText: "Lecture notes" }).filter({ hasNotText: "my version" }).click();
  await expect(editor(page)).toContainText("changed in another editor");

  // large note keeps saving
  await newNote(page, "Big");
  const big = "lorem ipsum dolor sit amet ".repeat(10_000); // ~50k words
  await page.evaluate((text) => navigator.clipboard?.writeText?.(text).catch(() => {}), big);
  await editor(page).evaluate((el, text) => {
    const dt = new DataTransfer();
    dt.setData("text/plain", text);
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
  }, big);
  await waitSaved(page, "Big");
  await editor(page).press("ControlOrMeta+End");
  await editor(page).pressSequentially(" END");
  await waitSaved(page, "Big");
});
