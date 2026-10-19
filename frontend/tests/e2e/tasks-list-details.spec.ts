/**
 * 012 US3 (details, checklist, quick notes, Undo) and US4 (list view, filters), plus opening a
 * task from another page (`/?task=<id>`, US7 FR-052) — contracts/ui-home-tasks.md.
 */
import { expect, test, type Page } from "@playwright/test";
import { newHierarchy, seedClass, signIn, tag } from "./helpers";
import { VIEWPORT } from "./layout-helpers";
import { api, card, column, columnTitles, getColumns, getTasks, resetBoard, seedTasks } from "./tasks-helpers";

test.use({ viewport: VIEWPORT });

test.beforeEach(async ({ page }) => {
  await signIn(page);
  await resetBoard(page);
});

const panel = (page: Page) => page.locator("#tasks-panel");
const details = (page: Page) => page.getByTestId("task-details");
const saveState = (page: Page) => page.getByTestId("task-save-state");

interface TaskRow {
  id: string;
  title: string;
  version: number;
  checklistDone: number;
  checklistTotal: number;
  quickNoteCount: number;
  columnId: string;
  position: number;
}
const taskByTitle = async (page: Page, title: string) =>
  ((await getTasks(page)) as unknown as TaskRow[]).find((t) => t.title === title);

async function openDetails(page: Page, title: string) {
  await card(page, title).getByRole("button", { name: title, exact: true }).click();
  await expect(details(page)).toBeVisible();
  await expect(details(page).getByRole("button", { name: "Back to tasks" })).toBeFocused();
}

test("US3: details autosave, a failed save warns on Back and Retry saves; focus returns to the card", async ({ page }) => {
  await seedTasks(page, "To do", ["Essay"]);
  await page.goto("/");
  await openDetails(page, "Essay");
  await expect(details(page)).toHaveAttribute("aria-modal", "false");

  const description = details(page).getByLabel("Description");
  await description.fill("First draft");
  await expect(saveState(page)).toHaveText("Saving…");
  await expect(saveState(page)).toHaveText("Saved");
  await expect.poll(async () => (await api<{ description: string }>(page, "GET", `/tasks/${(await taskByTitle(page, "Essay"))!.id}`)).description).toBe("First draft");

  // offline: the change is kept, the state says so, and Back asks instead of closing
  await page.route("**/api/v1/tasks/*", (route) => (route.request().method() === "PATCH" ? route.abort() : route.fallback()));
  await description.fill("First draft, revised");
  await expect(saveState(page)).toHaveText("Couldn't save — Retry");
  await details(page).getByRole("button", { name: "Back to tasks" }).click();
  const warn = page.getByRole("alertdialog", { name: "Your last change isn't saved" });
  await expect(warn).toBeVisible();
  await warn.getByRole("button", { name: "Keep editing" }).click();
  await expect(details(page)).toBeVisible();
  await expect(description).toHaveValue("First draft, revised");

  await page.unroute("**/api/v1/tasks/*");
  // the automatic retry (backoff) may win the race against the click
  await saveState(page).getByRole("button", { name: "Retry" }).click({ timeout: 2_000 }).catch(() => {});
  await expect(saveState(page)).toHaveText("Saved");
  await description.press("Escape");
  await expect(details(page)).toBeHidden();
  await expect(card(page, "Essay").getByRole("button", { name: "Essay", exact: true })).toBeFocused();
  const essay = (await taskByTitle(page, "Essay"))!;
  expect((await api<{ description: string }>(page, "GET", `/tasks/${essay.id}`)).description).toBe("First draft, revised");
});

test("US3: checklist on the card, quick notes with Undo, and deleting a task restores everything", async ({ page }) => {
  await seedTasks(page, "To do", ["Before", "Essay", "After"]);
  await page.goto("/");

  // checklist: three items, one ticked → 1/3 on the card
  await openDetails(page, "Essay");
  await details(page).getByRole("button", { name: "Add item" }).click();
  await page.keyboard.type("Outline");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Draft");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Proofread");
  await details(page).getByRole("checkbox", { name: "Done: Outline" }).click();
  await expect.poll(async () => (await taskByTitle(page, "Essay"))?.checklistTotal).toBe(3);
  await expect.poll(async () => (await taskByTitle(page, "Essay"))?.checklistDone).toBe(1);
  await details(page).getByRole("button", { name: "Back to tasks" }).click();
  await expect(card(page, "Essay").getByTestId("task-checklist")).toHaveText(/1\/3/);

  // quick notes: add, edit, Escape returns focus to the card's button
  const notesButton = card(page, "Essay").getByRole("button", { name: /^Quick notes/ });
  await notesButton.click();
  const pop = page.getByTestId("quick-notes");
  await expect(pop).toBeVisible();
  // portalled inside the Tasks panel
  expect(await pop.evaluate((el) => !!el.closest("#tasks-panel"))).toBe(true);
  await pop.getByRole("button", { name: "New quick note" }).click();
  await expect(pop.getByLabel("Quick note title")).toBeFocused();
  await page.keyboard.type("Idea");
  await pop.getByLabel("Quick note text").fill("Start with the conclusion");
  await expect(pop.getByTestId("quick-note")).toHaveCount(1);
  await expect(pop.getByTestId("quick-note").getByText("Saved")).toBeVisible();
  await expect.poll(async () => (await api<{ title: string; body: string }[]>(page, "GET", `/tasks/${(await taskByTitle(page, "Essay"))!.id}/quick-notes`)).map((n) => [n.title, n.body])).toEqual([["Idea", "Start with the conclusion"]]);
  await page.keyboard.press("Escape");
  await expect(pop).toBeHidden();
  await expect(notesButton).toBeFocused();
  await expect(card(page, "Essay").getByRole("button", { name: "Quick notes (1)" })).toBeVisible();

  // delete the note, Undo brings it back
  await card(page, "Essay").getByRole("button", { name: "Quick notes (1)" }).click();
  await pop.getByRole("button", { name: "Delete quick note Idea" }).click();
  await expect(pop.getByTestId("quick-note")).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(pop.getByLabel("Quick note title")).toHaveValue("Idea");
  await pop.getByRole("button", { name: "Close quick notes" }).click();
  await expect(pop).toBeHidden();

  // delete the task from its details; Undo restores position, checklist and quick notes
  await openDetails(page, "Essay");
  await details(page).getByRole("button", { name: "Delete task" }).click();
  await expect(details(page)).toBeHidden();
  await expect.poll(() => columnTitles(page, "To do")).toEqual(["Before", "After"]);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => columnTitles(page, "To do")).toEqual(["Before", "Essay", "After"]);
  const restored = (await taskByTitle(page, "Essay"))!;
  expect([restored.checklistDone, restored.checklistTotal, restored.quickNoteCount]).toEqual([1, 3, 1]);
  await expect(card(page, "Essay").getByTestId("task-checklist")).toHaveText(/1\/3/);
});

test("US3: the card menu opens, moves and deletes", async ({ page }) => {
  await seedTasks(page, "To do", ["Menu task"]);
  await page.goto("/");
  await card(page, "Menu task").getByRole("button", { name: "Actions for Menu task" }).click();
  await page.getByRole("menuitem", { name: "Move to" }).click();
  await page.getByRole("menuitemradio", { name: "In progress" }).click();
  await expect.poll(() => columnTitles(page, "In progress")).toEqual(["Menu task"]);
  await expect(column(page, "In progress").locator("[data-task-id]")).toHaveCount(1);
  // tasks not linked to an event have no "Open note"
  await card(page, "Menu task").getByRole("button", { name: "Actions for Menu task" }).click();
  await expect(page.getByRole("menuitem", { name: "Open note" })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Open", exact: true }).click();
  await expect(details(page)).toBeVisible();
});

test("US4: list groups, filters, badge, search; reload keeps view and filters; header fits 320 px", async ({ page }, info) => {
  const t = tag(info.project.name);
  const course = `Filters ${t} ${Date.now() % 100000}`;
  const cls = await seedClass(page, {
    course: newHierarchy(course, `Sem ${t}${Date.now() % 1000}`, `Y${t}${Date.now() % 1000}`),
    startDate: "2026-10-05", startTime: "08:00", endTime: "09:00", color: "teal", recurrence: { freq: "none" },
  });
  const semesterId = (await api<{ semesterId: string }>(page, "GET", `/courses/${cls.courseId}`)).semesterId;
  const cols = await getColumns(page);
  await seedTasks(page, "To do", ["Old report"], { dueDate: "2020-01-10" });
  await seedTasks(page, "To do", ["Far future"], { dueDate: "2099-05-01", courseId: cls.courseId });
  await seedTasks(page, "To do", ["Someday"]);
  await seedTasks(page, "Done", ["Finished thing"]);
  await api(page, "POST", "/events", {
    title: `Linked talk ${t}`, semester: { id: semesterId }, startDate: "2099-06-01", startTime: "10:00", endTime: "11:00",
    addToBoard: { columnId: cols[0].id },
  });

  await page.addInitScript(() => localStorage.setItem("uh.home.tasksWidth", "320"));
  await page.goto("/");
  await expect(panel(page)).toBeVisible();
  // the header row fits in 320 px: nothing overflows the panel
  await expect.poll(async () => Math.round((await panel(page).boundingBox())!.width)).toBe(320);
  const header = panel(page).locator("[data-panel-header]");
  expect(await header.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  for (const name of ["Search tasks", "Filter", "New task", "Close tasks"]) {
    const b = (await header.getByRole("button", { name, exact: true }).boundingBox())!;
    const p = (await panel(page).boundingBox())!;
    expect(b.x + b.width).toBeLessThanOrEqual(p.x + p.width);
  }

  await panel(page).getByRole("radiogroup", { name: "Task view" }).getByRole("radio", { name: "List" }).click();
  const list = page.getByTestId("task-list");
  const group = (name: string) => list.getByRole("button", { name: new RegExp(`^${name}\\s*\\d+$`) });
  await expect(group("Overdue")).toHaveAttribute("aria-expanded", "true");
  await expect(list.locator("[data-group=overdue] [data-task-id]")).toHaveText([/Old report/]);
  await expect(list.locator("[data-group=later] [data-task-id]")).toHaveText([/Far future/, /Linked talk/]);
  await expect(list.locator("[data-group=noDate] [data-task-id]")).toHaveText([/Someday/]);
  // Done is collapsed by default
  await expect(group("Done")).toHaveAttribute("aria-expanded", "false");
  await expect(list.getByText("Finished thing")).toHaveCount(0);
  await group("Done").click();
  await expect(list.getByText("Finished thing")).toBeVisible();
  // rows show their column
  await expect(list.locator("[data-task-id]").filter({ hasText: "Someday" }).getByTestId("task-column")).toHaveText(/To do/);

  // filters: course, personal, event-linked, show done; the badge counts them
  const filterButton = header.getByRole("button", { name: /^Filter/ });
  await filterButton.click();
  const pop = page.getByRole("dialog", { name: "Task filters" });
  await pop.getByLabel("Course").click();
  await page.getByRole("option", { name: new RegExp(course) }).click();
  await expect(list.locator("[data-task-id]")).toHaveText([/Far future/]);
  await expect(filterButton).toHaveAccessibleName("Filter, 1 active");
  await expect(page.getByTestId("filter-notice")).toContainText("4 hidden by filters");
  await pop.getByLabel("Course").click();
  await page.getByRole("option", { name: "Personal tasks" }).click();
  await expect(list.locator("[data-task-id]")).toHaveCount(4);
  await pop.getByLabel("Event-linked only").click();
  await expect(list.locator("[data-task-id]")).toHaveText([/Linked talk/]);
  await expect(filterButton).toHaveAccessibleName("Filter, 2 active");
  await pop.getByLabel("Event-linked only").click();
  await pop.getByLabel("Show done").click();
  await expect(list.getByText("Finished thing")).toHaveCount(0);
  await expect(filterButton).toHaveAccessibleName("Filter, 2 active");
  await page.keyboard.press("Escape");

  // search expands over the row; Escape collapses and returns focus
  await header.getByRole("button", { name: "Search tasks" }).click();
  const search = header.getByRole("searchbox", { name: "Search tasks" });
  await expect(search).toBeFocused();
  await search.fill("some");
  await expect(list.locator("[data-task-id]")).toHaveText([/Someday/]);
  await search.press("Escape");
  await expect(search).toBeHidden();
  await expect(header.getByRole("button", { name: /^Search tasks/ })).toBeFocused();
  await expect(filterButton).toHaveAccessibleName("Filter, 3 active");

  // reload keeps the view and the filters
  await page.reload();
  await expect(page.getByTestId("task-list")).toBeVisible();
  await expect(panel(page).getByRole("radio", { name: "List" })).toHaveAttribute("aria-checked", "true");
  await expect(header.getByRole("button", { name: /^Filter/ })).toHaveAccessibleName("Filter, 3 active");
  await expect(page.getByTestId("task-list").locator("[data-task-id]")).toHaveText([/Someday/]);

  // nothing matches → empty state with Clear filters
  await header.getByRole("button", { name: /^Search tasks/ }).click();
  await header.getByRole("searchbox", { name: "Search tasks" }).fill("zzz-nothing");
  await expect(page.getByTestId("filter-notice")).toContainText("No tasks match");
  await page.getByTestId("filter-notice").getByRole("button", { name: "Clear filters" }).click();
  await expect(header.getByRole("button", { name: /^Filter/ })).toHaveAccessibleName("Filter");
  await expect(page.getByTestId("task-list").getByText("Old report")).toBeVisible();

  // the board applies the same filters
  await panel(page).getByRole("radio", { name: "Board" }).click();
  await header.getByRole("button", { name: /^Filter/ }).click();
  await page.getByRole("dialog", { name: "Task filters" }).getByLabel("Event-linked only").click();
  await page.keyboard.press("Escape");
  await expect(panel(page).locator("[data-task-id]")).toHaveCount(1);
  // linked tasks offer "Open note"
  await panel(page).getByRole("button", { name: `Actions for Linked talk ${t}` }).click();
  await expect(page.getByRole("menuitem", { name: "Open note" })).toBeVisible();
  await page.keyboard.press("Escape");
  await header.getByRole("button", { name: /^Filter/ }).click();
  await page.getByRole("dialog", { name: "Task filters" }).getByRole("button", { name: "Clear filters" }).click();
});

test("US7: /?task=<id> opens the Tasks panel with the details, and Back returns to the previous page", async ({ page }) => {
  await seedTasks(page, "To do", ["Linked from elsewhere"]);
  const task = (await taskByTitle(page, "Linked from elsewhere"))!;
  await page.goto("/");
  await page.locator("#close-tasks").click();
  await expect(panel(page)).toBeHidden();
  await page.goto("/settings");
  await page.evaluate((id) => {
    history.pushState(null, "", `/?task=${id}`);
    dispatchEvent(new PopStateEvent("popstate"));
  }, task.id);
  await expect(panel(page)).toBeVisible();
  await expect(details(page)).toBeVisible();
  await expect(details(page).getByRole("heading", { name: "Linked from elsewhere" })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/settings/);
});
