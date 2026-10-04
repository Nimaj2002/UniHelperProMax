import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { signIn, tag } from "./helpers";
import { editor, newNote, seedCourse, waitSaved, workspaceUrl } from "./notes-helpers";

test("US1/US2/US5: timeline → workspace → notes autosave, reload-safe, live/raw", async ({ page }, testInfo) => {
  const t = tag(testInfo.project.name);
  const course = `NOTES${t} 101`;
  await signIn(page);
  const { courseId, lineageId } = await seedCourse(page, course);

  // US2: course timeline from the course panel
  await page.goto("/calendar");
  await page.getByRole("navigation", { name: "Courses" }).getByRole("link", { name: course }).click();
  await expect(page.getByRole("heading", { level: 1, name: course })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "September 2026" })).toBeVisible();
  const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(scan.violations.map((v) => v.id)).toEqual([]);
  await page.getByRole("region", { name: "September 2026" }).getByRole("link", { name: /^28 Mon/ }).click();
  await expect(page).toHaveURL(new RegExp(encodeURIComponent(`${lineageId}:2026-09-28`)));
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Mon 28 Sep 2026 · 10:00–11:30");

  // US1: two notes, autosave, tabs keep their own text
  await newNote(page, "Lecture notes");
  await editor(page).pressSequentially("# Trees\n\nA **binary** tree.\n");
  await waitSaved(page, "Lecture notes");
  await newNote(page, "Homework 3 questions");
  await editor(page).pressSequentially("- [ ] Q1\n");
  await waitSaved(page, "Homework 3 questions");
  await page.getByRole("tab", { name: /^Lecture notes/ }).click();
  await expect(editor(page)).toContainText("binary");
  const wsScan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(wsScan.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);

  // reload within a second of typing: nothing lost (server save or local draft)
  await editor(page).press("ControlOrMeta+End");
  await editor(page).pressSequentially(" Last words");
  await page.reload();
  await expect(page.getByRole("tab", { name: /^Lecture notes/ })).toBeVisible();
  await page.getByRole("tab", { name: /^Lecture notes/ }).click();
  await expect(editor(page)).toContainText("Last words");
  await waitSaved(page, "Lecture notes");

  // US5: live mode hides marks; Mod+E toggles raw; mode is remembered
  await page.locator(".cm-line").last().click();
  await expect(page.locator(".cm-lp-h1")).toContainText("Trees");
  await expect(page.locator(".cm-lp-h1")).not.toContainText("#");
  await editor(page).press("ControlOrMeta+e");
  await expect(page.getByRole("radio", { name: "Raw" })).toHaveAttribute("aria-checked", "true");
  await expect(page.locator(".cm-line").first()).toHaveText("# Trees");
  await page.reload();
  await expect(page.getByRole("radio", { name: "Raw" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("radio", { name: "Live" }).click();

  // duplicate names are refused
  await page.keyboard.press("Alt+n");
  const dialog = page.getByRole("dialog", { name: "New note" });
  await dialog.getByLabel("Note name").fill("lecture NOTES");
  await page.keyboard.press("Enter");
  await expect(dialog.getByText("A note with this name already exists in this session.")).toBeVisible();
  await page.keyboard.press("Escape");

  // timeline shows the note count
  await page.goto(`/courses/${courseId}`);
  await expect(page.getByRole("region", { name: "September 2026" }).getByRole("link", { name: /^28 Mon/ })).toContainText("2 notes");
  const ws = workspaceUrl(courseId, lineageId, "2026-09-28");
  expect(ws).toContain(courseId);
});
