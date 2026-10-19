/** Task board seeding over the API (012). All projects share one backend, so tests reset first. */
import { expect, type Locator, type Page } from "@playwright/test";

interface Column {
  id: string;
  name: string;
  position: number;
  countsAsDone: boolean;
  version: number;
}
interface Task {
  id: string;
  title: string;
  columnId: string;
  position: number;
  completedAt: string | null;
  version: number;
}

async function csrf(page: Page) {
  return (await page.context().cookies()).find((c) => c.name === "uh_csrf")?.value ?? "";
}

export async function api<T = unknown>(page: Page, method: string, path: string, body?: unknown, version?: number): Promise<T> {
  const headers: Record<string, string> = { "X-CSRF-Token": await csrf(page) };
  if (version !== undefined) headers["If-Match"] = `"${version}"`;
  const r = await page.request.fetch(`/api/v1${path}`, { method, data: body, headers });
  expect(r.ok(), `${method} ${path}: ${r.status()} ${await r.text()}`).toBe(true);
  return (r.status() === 204 ? undefined : await r.json()) as T;
}

export const getColumns = async (page: Page) =>
  (await api<Column[]>(page, "GET", "/task-columns")).sort((a, b) => a.position - b.position);
export const getTasks = (page: Page) => api<Task[]>(page, "GET", "/tasks");

/** Titles of one column's tasks in board order. */
export async function columnTitles(page: Page, columnName: string): Promise<string[]> {
  const col = (await getColumns(page)).find((c) => c.name === columnName);
  if (!col) return [];
  return (await getTasks(page))
    .filter((t) => t.columnId === col.id)
    .sort((a, b) => a.position - b.position)
    .map((t) => t.title);
}

/** Back to the default board: To do, In progress, Done (done) and no tasks. */
export async function resetBoard(page: Page) {
  for (const t of await getTasks(page)) await api(page, "DELETE", `/tasks/${t.id}`, undefined, t.version);
  let cols = await getColumns(page);
  for (const c of cols.slice(1)) await api(page, "DELETE", `/task-columns/${c.id}`, undefined, c.version);
  cols = await getColumns(page);
  const first = cols[0];
  if (first.name !== "To do" || first.countsAsDone)
    await api(page, "PATCH", `/task-columns/${first.id}`, { name: "To do", countsAsDone: false }, first.version);
  await api(page, "POST", "/task-columns", { name: "In progress" });
  await api(page, "POST", "/task-columns", { name: "Done", countsAsDone: true });
}

export async function seedTasks(page: Page, columnName: string, titles: string[], extra: Record<string, unknown> = {}) {
  const col = (await getColumns(page)).find((c) => c.name === columnName)!;
  for (const title of titles) await api(page, "POST", "/tasks", { title, columnId: col.id, ...extra });
}

export const board = (page: Page) => page.getByTestId("task-board");
export const column = (page: Page, name: string) => board(page).getByRole("group", { name, exact: true });
export const card = (page: Page, title: string) =>
  board(page).locator("[data-task-id]").filter({ has: page.getByRole("button", { name: title, exact: true }) });
export const announcer = (page: Page) => page.getByTestId("tasks-announcer");

/** Titles shown in a column, in order. */
export async function shownTitles(page: Page, name: string): Promise<string[]> {
  return column(page, name).locator("[data-task-id] [data-no-drag]:not([aria-label])").allTextContents();
}

/** Press on `from`, move in steps to (x, y), and release (unless `release` is false). */
export async function dragTo(page: Page, from: Locator, to: { x: number; y: number }, release = true) {
  // press the card's padding (its move surface, not the title or quick-note buttons)
  const b = (await from.boundingBox())!;
  const sx = b.x + 5;
  const sy = b.y + b.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 6, sy + 6, { steps: 2 });
  await page.mouse.move(to.x, to.y, { steps: 12 });
  if (release) await page.mouse.up();
}

/** Full-width board: close the Calendar panel. */
export async function openBoardWide(page: Page) {
  await page.goto("/");
  await page.locator("#close-calendar").click();
  await expect(page.locator("#calendar-panel")).toBeHidden();
  await expect(board(page)).toBeVisible();
  // the Tasks panel widens with a short transition: measure cards only once it has settled
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
}
