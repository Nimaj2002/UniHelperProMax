/**
 * 012 US5 (events on the board, deletion choice, Trash, Open note), US6 (tasks on the calendar)
 * and US7 (course tasks, course deletion, CSV export) — contracts/ui-home-tasks.md.
 *
 * Both colour-scheme projects share one backend: each uses its own week and tagged names, and every
 * test starts from the default board.
 */
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { newHierarchy, seedClass, signIn, tag } from "./helpers";
import { box, VIEWPORT } from "./layout-helpers";
import { api, card, column, getColumns, getTasks, resetBoard, seedTasks } from "./tasks-helpers";

test.use({ viewport: VIEWPORT });

interface TaskRow {
  id: string;
  title: string;
  columnId: string;
  dueDate: string | null;
  dueTime: string | null;
  previousColumnId: string | null;
  event: { sessionKey: string } | null;
  version: number;
}
interface SessionRow {
  key: string;
  taskId?: string | null;
  seriesVersion: number;
  exceptionVersion: number | null;
}

const panel = (page: Page) => page.locator("#tasks-panel");
const details = (page: Page) => page.getByTestId("task-details");
const toast = (page: Page, text: string) => page.locator("[data-sonner-toast]").filter({ hasText: text });
const tasksNamed = async (page: Page, title: string) =>
  ((await getTasks(page)) as unknown as TaskRow[]).filter((t) => t.title === title);
const sessionOf = (page: Page, key: string) => api<SessionRow>(page, "GET", `/sessions/${encodeURIComponent(key)}`);

/** The project's own week (Monday … Sunday) and a semester to put events in. */
async function setup(page: Page, project: string, prefix: string) {
  const t = tag(project);
  const n = Date.now() % 100000;
  const course = `${prefix}${t} ${n}`;
  const cls = await seedClass(page, {
    course: newHierarchy(course, `Sem ${prefix}${t}${n}`, `Y ${prefix}${t}${n}`, "2027-01-10"),
    startDate: "2026-09-21", startTime: "05:00", endTime: "06:00", color: "teal", recurrence: { freq: "none" },
  });
  const semesterId = (await api<{ semesterId: string }>(page, "GET", `/courses/${cls.courseId}`)).semesterId;
  await api(page, "PATCH", "/preferences", { lastSemesterId: semesterId, quickCreateType: "event" });
  const days = t === "L"
    ? ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"]
    : ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"];
  return { t, n, course, courseId: cls.courseId as string, lineageId: cls.lineageId as string, semesterId, days };
}

async function seedEvent(page: Page, body: Record<string, unknown>) {
  return api<{ lineageId: string }>(page, "POST", "/events", body);
}

/** The quick form for a one-hour entry at 06:00 (keyboard: focus the slot, Enter). */
async function quickFormAt(page: Page, date: string) {
  await page.locator(`[data-slot-at="${date} 24"]`).focus();
  await page.keyboard.press("Enter");
  const form = page.getByRole("dialog", { name: "New entry" });
  await expect(form).toBeVisible();
  await expect(form.getByRole("radio", { name: "Event" })).toHaveAttribute("aria-checked", "true");
  return form;
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
  await resetBoard(page);
});

// ---- US5 ---------------------------------------------------------------------------------------

test("US5: Add to kanban in the quick form links a task; Undo removes it; repeating events link the first occurrence", async ({ page }, info) => {
  const s = await setup(page, info.project.name, "KQF");
  await page.goto(`/calendar/week/${s.days[0]}`);

  const title = `Kanban talk ${s.t}${s.n}`;
  let form = await quickFormAt(page, s.days[1]);
  await form.getByLabel("Title").fill(title);
  const add = form.getByRole("switch", { name: "Add to kanban" });
  await expect(add).toHaveAttribute("aria-checked", "false");
  await add.click();
  await expect(form.getByRole("combobox", { name: "Column" })).toContainText("To do");
  await form.getByRole("button", { name: "Save" }).click();
  await expect(form).toBeHidden();

  const linked = card(page, title);
  await expect(column(page, "To do").locator("[data-task-id]").filter({ hasText: title })).toHaveCount(1);
  await expect(linked.getByText("Event", { exact: true })).toHaveCount(1);
  const [task] = await tasksNamed(page, title);
  expect(task.event?.sessionKey).toMatch(new RegExp(`:${s.days[1]}$`));
  expect([task.dueDate, task.dueTime]).toEqual([s.days[1], "06:00"]);

  // Undo the creation: the event and its task go
  await toast(page, "Event created").getByRole("button", { name: "Undo" }).click();
  await expect(toast(page, "Event removed")).toBeVisible();
  await expect(linked).toHaveCount(0);
  expect(await tasksNamed(page, title)).toHaveLength(0);

  // a weekly event: helper text, and only its first occurrence becomes a task
  const weekly = `Weekly kanban ${s.t}${s.n}`;
  form = await quickFormAt(page, s.days[2]);
  await form.getByLabel("Title").fill(weekly);
  await form.getByRole("combobox", { name: "Repeat" }).click();
  await page.getByRole("option", { name: /^Weekly on/ }).click();
  await form.getByRole("switch", { name: "Add to kanban" }).click();
  await expect(form.getByText("Only the first occurrence is added to the board")).toBeVisible();
  await form.getByRole("button", { name: "Save" }).click();
  await expect(form).toBeHidden();
  await expect(card(page, weekly)).toBeVisible();
  const tasks = await tasksNamed(page, weekly);
  expect(tasks).toHaveLength(1);
  expect(tasks[0].dueDate).toBe(s.days[2]);
  const lineage = tasks[0].event!.sessionKey.split(":")[0];
  const next = await sessionOf(page, `${lineage}:${s.days[2].slice(0, 8)}${String(Number(s.days[2].slice(8)) + 7).padStart(2, "0")}`);
  expect(next.taskId ?? null).toBeNull();
  expect((await sessionOf(page, `${lineage}:${s.days[2]}`)).taskId).toBe(tasks[0].id);
});

test("US5: add from the details, the due follows the event, deletion deletes or keeps, Trash restores", async ({ page }, info) => {
  const s = await setup(page, info.project.name, "KDT");
  const title = `Detail talk ${s.t}${s.n}`;
  const ev = await seedEvent(page, { title, semester: { id: s.semesterId }, startDate: s.days[3], startTime: "06:00", endTime: "07:00" });
  const key = `${ev.lineageId}:${s.days[3]}`;

  // the event's details offer "Add to kanban"
  await page.goto(`/sessions/${encodeURIComponent(key)}`);
  const pop = page.getByRole("dialog", { name: `Event: ${title}` });
  await expect(pop).toBeVisible();
  await pop.getByRole("button", { name: "Add to kanban" }).click();
  await pop.getByRole("group", { name: "Add to kanban" }).getByRole("button", { name: "Add", exact: true }).click();
  await expect(toast(page, "Added to the board")).toBeVisible();
  await expect(pop.getByRole("button", { name: "Add to kanban" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(pop).toBeHidden();
  await expect(card(page, title)).toBeVisible();

  // editing the event's time moves the task's due time
  const sess = await sessionOf(page, key);
  await api(page, "PATCH", `/sessions/${encodeURIComponent(key)}?scope=this`, { startTime: "07:30", endTime: "08:30" }, sess.exceptionVersion ?? sess.seriesVersion);
  await expect.poll(async () => (await tasksNamed(page, title))[0]?.dueTime).toBe("07:30");

  // delete the event with "Delete with the event": the task goes to the Trash with it
  await page.goto(`/sessions/${encodeURIComponent(key)}`);
  await page.getByRole("dialog", { name: `Event: ${title}` }).getByRole("button", { name: "Delete" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("Linked tasks");
  await expect(confirm.getByRole("radio", { name: "Keep as tasks" })).toBeChecked();
  await confirm.getByRole("radio", { name: "Delete with the event" }).click();
  await confirm.getByRole("button", { name: "Move to Trash" }).click();
  await expect(confirm).toBeHidden();
  await expect(card(page, title)).toHaveCount(0);
  expect(await tasksNamed(page, title)).toHaveLength(0);

  await page.goto("/settings/trash");
  const entry = page.getByRole("region", { name: "Deleted events" }).getByRole("listitem").filter({ hasText: title });
  await expect(entry).toContainText("1 task");
  await entry.getByRole("button", { name: /^Restore/ }).click();
  await expect(entry).toHaveCount(0);
  await expect.poll(async () => (await tasksNamed(page, title))[0]?.event?.sessionKey).toBe(key);

  // the default keeps the task, unlinked
  await page.goto(`/sessions/${encodeURIComponent(key)}`);
  await page.getByRole("dialog", { name: `Event: ${title}` }).getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("alertdialog").getByRole("radio", { name: "Keep as tasks" })).toBeChecked();
  await page.getByRole("alertdialog").getByRole("button", { name: "Move to Trash" }).click();
  await expect(page.getByRole("alertdialog")).toBeHidden();
  await expect.poll(async () => (await tasksNamed(page, title)).map((t) => t.event)).toEqual([null]);
  await expect(card(page, title)).toBeVisible();
  await expect(card(page, title).getByText("Event", { exact: true })).toHaveCount(0);
});

test("US5: Open note goes to the event's workspace and Back returns to the same home page", async ({ page }, info) => {
  const s = await setup(page, info.project.name, "KON");
  const title = `Note talk ${s.t}${s.n}`;
  const cols = await getColumns(page);
  await seedEvent(page, {
    title, semester: { id: s.semesterId }, startDate: s.days[4], startTime: "06:00", endTime: "07:00", addToBoard: { columnId: cols[0].id },
  });
  await page.goto(`/calendar/week/${s.days[0]}`);
  const grid = page.locator("#calendar-panel [data-calendar-scroll]");
  await grid.evaluate((el) => (el.scrollTop = 500));
  const top = await grid.evaluate((el) => el.scrollTop);

  await card(page, title).getByRole("button", { name: `Actions for ${title}` }).click();
  await page.getByRole("menuitem", { name: "Open note" }).click();
  // `/workspace/<key>` opens the event's workspace (under its semester's events)
  await expect(page).toHaveURL(new RegExp(`/semesters/${s.semesterId}/events/`));
  await expect(page.locator("#tasks-panel")).toHaveCount(0);

  await page.goBack();
  await expect(panel(page)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/calendar/week/${s.days[0]}$`));
  await expect.poll(() => grid.evaluate((el) => el.scrollTop)).toBe(top);
  await expect(card(page, title)).toBeVisible();
});

// ---- US6 ---------------------------------------------------------------------------------------

test("US6: Show tasks puts timed and date-only tasks on the week and month; ticking moves them", async ({ page }, info) => {
  const s = await setup(page, info.project.name, "KCM");
  const timed = `Timed task ${s.t}${s.n}`;
  const dateOnly = `Due task ${s.t}${s.n}`;
  const blocker = `Blocker ${s.t}${s.n}`;
  await seedTasks(page, "In progress", [timed], { dueDate: s.days[1], dueTime: "06:00" });
  // Sunday: no weekly event of the other tests shares its month cell
  await seedTasks(page, "To do", [dateOnly], { dueDate: s.days[6] });
  // an event at the same time as the timed task: they collide, so they sit side by side
  await seedEvent(page, { title: blocker, semester: { id: s.semesterId }, startDate: s.days[1], startTime: "06:00", endTime: "07:00" });

  await page.goto(`/calendar/week/${s.days[0]}`);
  // the three-way switch starts on Both; Time only hides the tasks
  const both = page.locator("#show-on-calendar-both");
  await expect(both).toHaveAttribute("aria-checked", "true");
  await page.locator("#show-on-calendar-time").click();
  await expect(page.locator("[data-task-marker]")).toHaveCount(0);
  await expect(page.getByTestId("due-strip")).toHaveCount(0);
  const event = page.locator(`[data-day="${s.days[1]}"] [data-session-key]`).filter({ hasText: blocker });
  const before = await box(event);

  await both.click();
  await expect(both).toHaveAttribute("aria-checked", "true");
  // the timed task is a block at its time in its day, laid out with the entries like an event
  const marker = page.locator(`[data-day="${s.days[1]}"] [data-task-marker]`).filter({ hasText: timed });
  await expect(marker).toBeVisible();
  const day = await box(page.locator(`[data-day="${s.days[1]}"]`));
  expect(Math.round((await box(marker)).y - day.y)).toBe(6 * 48 + 1);
  const after = await box(event);
  expect(after.width).toBeLessThan(before.width);
  const m = await box(marker);
  expect(m.x >= after.x + after.width || m.x + m.width <= after.x).toBe(true);
  // the date-only task is in the due strip
  const strip = page.getByTestId("due-strip");
  await expect(strip.locator(`[data-due-day="${s.days[6]}"] [data-task-marker]`)).toHaveText(new RegExp(dateOnly));

  // tick → the Done column; untick → back to the previous column
  await marker.getByRole("checkbox", { name: `Done: ${timed}` }).click();
  await expect(marker.getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
  const doneId = (await getColumns(page)).find((c) => c.name === "Done")!.id;
  const progressId = (await getColumns(page)).find((c) => c.name === "In progress")!.id;
  await expect.poll(async () => (await tasksNamed(page, timed))[0].columnId).toBe(doneId);
  await expect(column(page, "Done").locator("[data-task-id]").filter({ hasText: timed })).toHaveCount(1);
  await expect(marker.getByRole("button", { name: timed })).toHaveClass(/line-through/);
  await marker.getByRole("checkbox", { name: `Done: ${timed}` }).click();
  await expect.poll(async () => (await tasksNamed(page, timed))[0].columnId).toBe(progressId);

  // the title opens the details in the Tasks panel
  await page.locator("#close-tasks").click();
  await expect(panel(page)).toBeHidden();
  await marker.getByRole("button", { name: timed }).click();
  await expect(panel(page)).toBeVisible();
  await expect(details(page).getByRole("heading", { name: timed })).toBeVisible();
  await details(page).getByRole("button", { name: "Back to tasks" }).click();

  // the month view lists them in their cells
  await page.locator("#calendar-panel").getByRole("radio", { name: "Month view" }).click();
  await expect(page.locator(`[data-month-cell="${s.days[1]}"] [data-task-marker]`)).toHaveText(new RegExp(timed));
  await expect(page.locator(`[data-month-cell="${s.days[6]}"] [data-task-marker]`)).toHaveText(new RegExp(dateOnly));

  // the choice is remembered; Time only removes the markers
  await page.locator("#show-on-calendar-tasks").click();
  await page.reload();
  await expect(page.locator("#show-on-calendar-tasks")).toHaveAttribute("aria-checked", "true");
  await page.locator("#show-on-calendar-time").click();
  await expect(page.locator("[data-task-marker]")).toHaveCount(0);
});

test("US6: many date-only tasks collapse to \"+N more\"; an event on the board opens its task", async ({ page }, info) => {
  const s = await setup(page, info.project.name, "KCN");
  const many = Array.from({ length: 15 }, (_, i) => `Many ${String(i + 1).padStart(2, "0")} ${s.t}${s.n}`);
  await seedTasks(page, "To do", many, { dueDate: s.days[5] });
  const title = `Board event ${s.t}${s.n}`;
  const cols = await getColumns(page);
  const ev = await seedEvent(page, {
    title, semester: { id: s.semesterId }, startDate: s.days[4], startTime: "06:00", endTime: "07:30", addToBoard: { columnId: cols[0].id },
  });
  await page.addInitScript(() => localStorage.setItem("uh.calendar.showTasks", "true"));
  await page.goto(`/calendar/week/${s.days[0]}`);

  const cell = page.getByTestId("due-strip").locator(`[data-due-day="${s.days[5]}"]`);
  await expect(cell.locator("[data-task-marker]")).toHaveCount(2);
  const more = cell.getByRole("button", { name: /^Show 13 more tasks/ });
  await expect(more).toHaveText("+13 more");
  await more.click();
  const list = page.getByRole("dialog", { name: /^Tasks on/ });
  await expect(list.locator("[data-task-marker]")).toHaveCount(15);
  await page.keyboard.press("Escape");

  // event-linked tasks have no marker of their own: the event shows "On board"
  await expect(page.locator("[data-task-marker]").filter({ hasText: title })).toHaveCount(0);
  const onBoard = page.locator(`[data-on-board]`).filter({ hasText: "On board" });
  await expect(onBoard).toHaveCount(1);
  await page.locator("#close-tasks").click();
  await expect(panel(page)).toBeHidden();
  await onBoard.click();
  await expect(panel(page)).toBeVisible();
  await expect(details(page).getByRole("heading", { name: title })).toBeVisible();
  const task = (await tasksNamed(page, title))[0];
  expect(task.event?.sessionKey).toBe(`${ev.lineageId}:${s.days[4]}`);
});

// ---- US7 ---------------------------------------------------------------------------------------

test("US7: course tasks with quick add, opening a task from the course page, course deletion, CSV export", async ({ page }, info) => {
  const s = await setup(page, info.project.name, "KCT");
  await seedTasks(page, "To do", [`Read chapter ş ${s.t}`], { courseId: s.courseId, dueDate: s.days[1] });
  await seedTasks(page, "Done", [`Finished reading ${s.t}`], { courseId: s.courseId });
  await seedTasks(page, "To do", [`Personal ${s.t}`]);

  // reach the course page in the app (so Back has somewhere to go)
  await page.goto("/");
  await page.evaluate((id) => {
    history.pushState(null, "", `/courses/${id}`);
    dispatchEvent(new PopStateEvent("popstate"));
  }, s.courseId);
  const section = page.getByTestId("course-tasks").first();
  await expect(section.getByRole("link")).toHaveText([new RegExp(`Read chapter ş ${s.t}`)]);

  // quick add preselects the course
  await section.getByRole("textbox", { name: `Add task to ${s.course}` }).fill(`Quick added ${s.t}`);
  await page.keyboard.press("Enter");
  await expect(section.getByRole("link", { name: new RegExp(`Quick added ${s.t}`) })).toBeVisible();
  await expect.poll(async () => ((await tasksNamed(page, `Quick added ${s.t}`))[0] as unknown as { courseId: string })?.courseId).toBe(s.courseId);

  // a task opens home with its details; Back returns to the course page
  await section.getByRole("link", { name: new RegExp(`Read chapter ş ${s.t}`) }).click();
  await expect(panel(page)).toBeVisible();
  await expect(details(page).getByRole("heading", { name: `Read chapter ş ${s.t}` })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/courses/${s.courseId}$`));

  // export: a CSV with the header first and the Turkish characters intact
  await page.goto("/settings/import-export");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export tasks" }).click()]);
  expect(download.suggestedFilename()).toMatch(/-tasks-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = readFileSync((await download.path())!, "utf8").replace(/^\uFEFF/, "");
  expect(csv.split(/\r?\n/)[0]).toBe("Title,Description,Column,Due date,Due time,Course,Linked event,Checklist,Quick notes,Completed at");
  expect(csv).toContain(`Read chapter ş ${s.t}`);
  await expect(toast(page, "Tasks exported")).toBeVisible();

  // deleting the course: the dialog counts the tasks, which become personal
  await page.goto(`/courses/${s.courseId}`);
  await page.locator("#course-panel").getByRole("button", { name: `Actions for ${s.course}` }).click();
  await page.getByRole("menuitem", { name: /^Delete/ }).click();
  const dialog = page.getByRole("alertdialog", { name: `Delete ${s.course}?` });
  await expect(dialog).toContainText("3 tasks will become personal tasks.");
  await dialog.getByRole("button", { name: "Delete course" }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(async () => {
    const rows = (await getTasks(page)) as unknown as { title: string; courseId: string | null }[];
    return rows.filter((r) => r.title.endsWith(s.t) && r.courseId !== null).length;
  }).toBe(0);
  expect(((await getTasks(page)) as unknown[]).length).toBe(4);
});
