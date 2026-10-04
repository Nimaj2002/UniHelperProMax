import { expect, type Page } from "@playwright/test";
import { newHierarchy, seedClass } from "./helpers";

/** Seed a Mon+Wed class around "now" and return ids to build workspace URLs. */
export async function seedCourse(page: Page, name: string, opts: { year?: string; semester?: string } = {}) {
  const cls = await seedClass(page, {
    course: newHierarchy(name, opts.semester ?? `Sem ${name}`, opts.year ?? `Year ${name}`, "2027-01-10"),
    title: "Lecture", startDate: "2026-09-28", startTime: "10:00", endTime: "11:30", location: "FENS G032", color: "teal",
    recurrence: { freq: "weekly", byWeekday: ["MO", "WE"], end: { kind: "semester_end" } },
  });
  return { courseId: cls.courseId as string, lineageId: cls.lineageId as string };
}

export function workspaceUrl(courseId: string, lineageId: string, date: string) {
  return `/courses/${courseId}/sessions/${encodeURIComponent(`${lineageId}:${date}`)}`;
}

export async function newNote(page: Page, name: string) {
  await expect(page.getByRole("button", { name: "New note" }).first()).toBeVisible(); // workspace loaded
  await page.keyboard.press("Alt+n");
  const dialog = page.getByRole("dialog", { name: "New note" });
  await dialog.getByLabel("Note name").fill(name);
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("tab", { name: new RegExp(`^${name}`) })).toHaveAttribute("aria-selected", "true");
}

export function editor(page: Page) {
  return page.locator(".cm-content");
}

export async function waitSaved(page: Page, name: string) {
  await expect(page.getByRole("tab", { name: new RegExp(`^${name}`) })).toContainText("Saved", { timeout: 5000 });
}
