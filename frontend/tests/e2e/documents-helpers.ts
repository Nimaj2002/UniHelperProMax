import { expect, type Page } from "@playwright/test";
import { newHierarchy, seedClass, signIn, tag } from "./helpers";
import { workspaceUrl } from "./notes-helpers";

/** Shared by documents.spec.ts and annotations.spec.ts (007). */
export async function openSession(page: Page, testInfo: { project: { name: string } }, course: string, date = "2026-10-05") {
  const t = tag(testInfo.project.name);
  await signIn(page);
  // evening slot, as in import.spec.ts: no overlaps with other specs' 10:00 events
  const name = `${course}${t}`;
  const cls = await seedClass(page, {
    course: newHierarchy(name, `Sem ${name}`, `Year ${name}`, "2027-01-10"),
    title: "Lecture", startDate: "2026-09-28", startTime: "19:00", endTime: "20:00", location: "Room 2", color: "teal",
    recurrence: { freq: "weekly", byWeekday: ["MO", "WE"], end: { kind: "semester_end" } },
  });
  const url = workspaceUrl(cls.courseId as string, cls.lineageId as string, date);
  await page.goto(url);
  const docs = page.getByRole("region", { name: "Documents" });
  await expect(docs.getByRole("button", { name: "Upload PDF" })).toBeVisible();
  return { docs, url };
}

export async function uploadPdf(page: Page, name: string, buffer: Buffer) {
  await page.getByTestId("upload-pdf-input").setInputFiles({ name, mimeType: "application/pdf", buffer });
  await expect(page.getByText(`Uploaded “${name}”`)).toBeVisible({ timeout: 15000 });
}

// the shown reader's status (hidden readers of other open tabs keep theirs)
export const status = (page: Page) => page.locator("[id^=workspace-pane-]").getByTestId("reader-status");
export const reader = (page: Page, name: string) => page.getByRole("region", { name: `${name} — PDF` });

