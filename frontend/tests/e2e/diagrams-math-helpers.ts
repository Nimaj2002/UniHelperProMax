import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { signIn } from "./helpers";
import { seedCourse, workspaceUrl } from "./notes-helpers";

const FIXTURES = path.resolve(import.meta.dirname, "../fixtures/notes");

export const fixture = (name: string) => readFileSync(path.join(FIXTURES, name), "utf8");

async function csrf(page: Page) {
  return (await page.context().cookies()).find((c) => c.name === "uh_csrf")?.value ?? "";
}

let counter = 0;
/** The course name of the last `openNote`, for finding the note's file on disk. */
export let lastCourse = "";

/**
 * Signs in, seeds a class and a note holding `content` through the API, and opens the note.
 * Returns the note id. Notes e2e helpers still target CodeMirror, so this uses MDXEditor selectors.
 */
export async function openNote(page: Page, project: string, content: string, name = "Math note") {
  await signIn(page);
  const unique = `${project.includes("dark") ? "D" : "L"}${Date.now() % 1_000_000}${counter++}`;
  lastCourse = `DM${unique} 101`;
  const { courseId, lineageId } = await seedCourse(page, lastCourse);
  const key = `${lineageId}:2026-09-28`;
  const r = await page.request.post(`/api/v1/sessions/${encodeURIComponent(key)}/notes`, {
    data: { name, content },
    headers: { "X-CSRF-Token": await csrf(page) },
  });
  expect(r.status(), await r.text()).toBe(201);
  const note = await r.json();
  await page.goto(workspaceUrl(courseId, lineageId, "2026-09-28"));
  await page.getByRole("button", { name, exact: true }).click(); // the note in the side panel's Notes list
  await expect(page.getByRole("tab", { name: new RegExp(`^${name}`) })).toBeVisible();
  await expect(noteEditor(page)).toBeVisible();
  return note.id as string;
}

export function noteEditor(page: Page) {
  return page.locator(".mdx-note-content").first();
}

export async function noteFile(page: Page, id: string): Promise<string> {
  const r = await page.request.get(`/api/v1/notes/${id}`);
  return (await r.json()).content as string;
}

export async function waitSaved(page: Page, name = "Math note") {
  await expect(page.getByRole("tab", { name: new RegExp(`^${name}`) })).toContainText("Saved", { timeout: 10_000 });
}

/** The note's file in the e2e data folder (the backend runs with UNIHELPER_DATA_DIR=../data-e2e). */
export function noteFilePath(course: string, name = "Math note") {
  return path.resolve(import.meta.dirname, "../../../data-e2e/files/owner", `Year ${course}`, `Sem ${course}`, course, "2026-09-28", "notes", `${name}.md`);
}
