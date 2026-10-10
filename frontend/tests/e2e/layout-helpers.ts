import { expect, type Locator, type Page } from "@playwright/test";
import { newHierarchy, seedClass, signIn } from "./helpers";
import { newNote, workspaceUrl } from "./notes-helpers";

/** The layout specs' own week: one-off sessions, so the shared e2e calendar gains no overlaps elsewhere. */
export const LAYOUT_DATE = "2026-12-07";

export const VIEWPORT = { width: 1366, height: 768 };

export const sidePanel = (page: Page) => page.getByRole("complementary", { name: "Side panel" });
export const mainCard = (page: Page) => page.getByRole("main", { name: "Workspace" });
export const audioCard = (page: Page) => page.getByRole("complementary", { name: "Audio" });
export const tabRow = (page: Page) => mainCard(page).locator("div.h-10").first();

export async function box(l: Locator) {
  const b = await l.boundingBox();
  expect(b, "element has a box").not.toBeNull();
  return b!;
}

export async function radius(l: Locator) {
  return l.evaluate((el) => parseFloat(getComputedStyle(el).borderTopLeftRadius));
}

export async function windowScrolls(page: Page) {
  return page.evaluate(() => {
    const s = document.scrollingElement!;
    return s.scrollHeight > window.innerHeight + 1 || s.scrollWidth > window.innerWidth + 1;
  });
}

/** Sign in, seed a course with one session on LAYOUT_DATE and open it (optionally with a note). */
export async function openSession(page: Page, course: string, opts: { note?: string } = {}) {
  await signIn(page);
  const cls = await seedClass(page, {
    course: newHierarchy(course, `Sem ${course}`, `Year ${course}`, "2027-01-10"),
    title: "Lecture", startDate: LAYOUT_DATE, startTime: "10:00", endTime: "11:30", location: "FENS G032", color: "teal",
    recurrence: { freq: "none" },
  });
  const courseId = cls.courseId as string;
  const lineageId = cls.lineageId as string;
  const url = workspaceUrl(courseId, lineageId, LAYOUT_DATE);
  await page.goto(url);
  await expect(mainCard(page)).toBeVisible();
  // the audio card's open state is an account preference shared by every test: start open
  const reopen = mainCard(page).getByRole("button", { name: /^Show audio panel/ });
  await expect(audioCard(page).or(reopen).first()).toBeVisible();
  if (await reopen.isVisible()) await reopen.click();
  await expect(audioCard(page)).toBeVisible();
  if (opts.note) await newNote(page, opts.note);
  return { courseId, lineageId, url };
}
