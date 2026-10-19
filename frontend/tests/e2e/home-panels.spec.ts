/**
 * 012 Part B (contracts/ui-home-tasks.md): the home page's Calendar and Tasks panels — cards with
 * one 40 px header (US8), closing to a rail and back (US9), at least one stays open (US10), the
 * divider (US11), smaller windows (US12), focus mode and coming back (US13), reduced motion.
 */
import { expect, test, type Page } from "@playwright/test";
import { newHierarchy, seedClass, signIn, tag } from "./helpers";
import { workspaceUrl } from "./notes-helpers";
import { board, resetBoard, seedTasks } from "./tasks-helpers";
import { box, mainCard, radius, VIEWPORT } from "./layout-helpers";

test.use({ viewport: VIEWPORT });

const calendar = (page: Page) => page.locator("#calendar-panel");
const tasks = (page: Page) => page.locator("#tasks-panel");
const announcer = (page: Page) => page.getByTestId("home-announcer");
const headerHasFocus = (page: Page, panel: "calendar" | "tasks") =>
  page.evaluate((id) => !!document.activeElement?.closest(`#${id} [data-panel-header]`), `${panel}-panel`);

test("US8: first use at 1366 × 768 shows the left card, Calendar and Tasks as three cards", async ({ page }) => {
  await signIn(page);
  await page.goto("/");
  const left = page.locator("#course-panel");
  for (const card of [left, calendar(page), tasks(page)]) await expect(card).toBeVisible();
  await expect(page.getByRole("region", { name: "Calendar" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Tasks" })).toBeVisible();

  for (const card of [calendar(page), tasks(page)]) {
    expect(await radius(card)).toBeGreaterThanOrEqual(13);
    expect(await card.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe("1px");
    // one header row of at most 40 px
    const header = await box(card.locator("[data-panel-header]"));
    expect(header.height).toBeLessThanOrEqual(40);
  }
  const [l, c, t] = [await box(left), await box(calendar(page)), await box(tasks(page))];
  // left to right with 8 px gaps, all starting at the top: no bar above, below or between them
  expect(Math.round(c.x - (l.x + l.width))).toBe(8);
  expect(Math.round(t.x - (c.x + c.width))).toBe(8);
  expect(Math.round(VIEWPORT.width - (t.x + t.width))).toBe(8);
  for (const b of [c, t]) {
    expect(Math.round(b.y)).toBe(Math.round(l.y));
    expect(Math.round(b.height)).toBe(Math.round(l.height));
  }
  expect(Math.round(t.width)).toBe(420);
  expect(c.width).toBeGreaterThanOrEqual(480);
  await expect(tasks(page).getByRole("group", { name: "To do" })).toBeVisible();
});

test("US8: calendar deep links and shortcuts work in the Calendar panel, not from the Tasks panel", async ({ page }) => {
  await signIn(page);
  await page.goto("/calendar/week/2026-10-05");
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toHaveAccessibleName("5 – 11 October 2026");
  await expect(tasks(page)).toBeVisible();

  await page.locator("body").press("d");
  await expect(page).toHaveURL(/\/calendar\/day\/2026-10-05$/);
  await page.locator("body").press("w");
  await expect(page).toHaveURL(/\/calendar\/week\/2026-10-05$/);

  // focus inside the Tasks panel: the calendar's single keys do nothing
  await page.locator("#close-tasks").focus();
  for (const key of ["d", "t", "m", "j"]) await page.keyboard.press(key);
  await expect(page).toHaveURL(/\/calendar\/week\/2026-10-05$/);
  await expect(heading).toHaveAccessibleName("5 – 11 October 2026");
});

test("US9: Tasks closes to a 44 px rail and comes back by rail and Shift+T", async ({ page }) => {
  await signIn(page);
  await page.goto("/");
  const calBefore = (await box(calendar(page))).width;

  await page.locator("#close-tasks").click();
  await expect(tasks(page)).toBeHidden();
  const rail = page.locator("[data-rail=tasks]");
  await expect(rail).toBeVisible();
  // after the ≤ 200 ms transition
  await expect.poll(async () => Math.round((await box(rail)).width)).toBe(44);
  await expect(rail).toContainText("Tasks");
  const show = page.locator("#show-tasks");
  await expect(show).toHaveAttribute("aria-keyshortcuts", "Shift+T");
  await expect(show).toHaveAccessibleName(/^Show tasks/);
  await expect(show).toBeFocused();
  await expect(announcer(page)).toHaveText("Tasks closed");
  // the Calendar takes the freed width
  await expect.poll(async () => (await box(calendar(page))).width).toBeGreaterThan(calBefore + 300);

  // reopen by the rail: focus on the first header control, announced
  await show.click();
  await expect(tasks(page)).toBeVisible();
  await expect(announcer(page)).toHaveText("Tasks opened");
  await expect.poll(() => headerHasFocus(page, "tasks")).toBe(true);
  await expect.poll(async () => Math.round((await box(tasks(page))).width)).toBe(420);

  // and by Shift+T
  await page.locator("body").press("Shift+T");
  await expect(tasks(page)).toBeHidden();
  await expect(page.locator("#show-tasks")).toBeFocused();
  await page.keyboard.press("Shift+T");
  await expect(tasks(page)).toBeVisible();
  await expect.poll(() => headerHasFocus(page, "tasks")).toBe(true);

  // the open/close transition takes at most 200 ms, none with reduced motion
  const slot = tasks(page).locator("xpath=..");
  expect(await slot.evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration))).toBeLessThanOrEqual(0.2);
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await slot.evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration))).toBeLessThanOrEqual(0.01);
});

test("US9: the Calendar closes to its rail and reopens on the same view and date", async ({ page }) => {
  await signIn(page);
  await page.goto("/calendar/day/2026-10-06");
  await page.locator("#close-calendar").click();
  await expect(calendar(page)).toBeHidden();
  const rail = page.locator("[data-rail=calendar]");
  await expect.poll(async () => Math.round((await box(rail)).width)).toBe(44);
  await expect(page.locator("#show-calendar")).toBeFocused();
  await expect(page.locator("#show-calendar")).toHaveAccessibleName("Show calendar");
  await expect(announcer(page)).toHaveText("Calendar closed");
  // the rail sits between the left card and Tasks, which fills the width
  const [l, r] = [await box(page.locator("#course-panel")), await box(rail)];
  expect(Math.round(r.x - (l.x + l.width))).toBe(8);
  await expect.poll(async () => Math.round((await box(tasks(page))).x - (r.x + r.width))).toBe(8);
  await expect.poll(async () => Math.round(VIEWPORT.width - ((await box(tasks(page))).x + (await box(tasks(page))).width))).toBe(8);
  // calendar keys are off while it is closed
  await page.locator("body").press("w");
  await expect(page).toHaveURL(/\/calendar\/day\/2026-10-06$/);

  await page.locator("body").press("Shift+C");
  await expect(calendar(page)).toBeVisible();
  await expect(announcer(page)).toHaveText("Calendar opened");
  await expect.poll(() => headerHasFocus(page, "calendar")).toBe(true);
  await expect(page).toHaveURL(/\/calendar\/day\/2026-10-06$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveAccessibleName("Tuesday, 6 October 2026");
});

test("US10: the last open panel can't be closed, by button or shortcut", async ({ page }) => {
  await signIn(page);
  await page.goto("/");
  await page.locator("#close-tasks").click();
  await expect(tasks(page)).toBeHidden();

  const close = page.locator("#close-calendar");
  await expect(close).toBeDisabled();
  await expect(close).toHaveAccessibleDescription("At least one panel stays open");
  // a real pointer path (Radix ignores a single jump that leaves another tooltip's trigger)
  const b = await box(close);
  await page.mouse.move(400, 400, { steps: 5 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 });
  await expect(page.getByRole("tooltip").filter({ hasText: "At least one panel stays open" })).toBeVisible();
  await close.click({ force: true });
  await expect(calendar(page)).toBeVisible();

  await page.locator("body").press("Shift+C");
  await expect(calendar(page)).toBeVisible();
  await expect(announcer(page)).toHaveText("At least one panel stays open");

  // reopening Tasks enables it again
  await page.locator("#show-tasks").click();
  await expect(close).toBeEnabled();
});

test("US10: the state is remembered after a reload", async ({ page }) => {
  await signIn(page);
  await page.goto("/");
  await page.locator("#close-calendar").click();
  await page.reload();
  await expect(tasks(page)).toBeVisible();
  await expect(calendar(page)).toBeHidden();
  await expect(page.locator("#close-tasks")).toBeDisabled();
});

test("US9: the Tasks rail shows the open count and an overdue \"!\"; unfinished input survives", async ({ page }) => {
  await signIn(page);
  await resetBoard(page);
  await seedTasks(page, "To do", ["Fresh"]);
  await seedTasks(page, "To do", ["Late"], { dueDate: "2020-01-06" });
  await seedTasks(page, "Done", ["Finished"], { dueDate: "2020-01-06" });
  await page.goto("/");

  // a half-typed title in a column's "Add task" field
  const add = tasks(page).getByRole("textbox", { name: "Add task to In progress" });
  await add.fill("Half typ");

  await page.locator("#close-tasks").click();
  const show = page.locator("#show-tasks");
  await expect(show).toHaveAccessibleName("Show tasks, 2 open, 1 overdue");
  await expect(page.getByTestId("rail-open-count")).toHaveText("2");
  const overdue = page.getByTestId("rail-overdue");
  await expect(overdue).toContainText("!");
  await expect(overdue.locator(".sr-only")).toHaveText("1 overdue");

  await show.click();
  await expect(tasks(page)).toBeVisible();
  await expect(add).toHaveValue("Half typ");

  // no overdue task: no "!"
  await resetBoard(page);
  await seedTasks(page, "To do", ["Only"]);
  await page.reload();
  await page.locator("#close-tasks").click();
  await expect(page.locator("#show-tasks")).toHaveAccessibleName("Show tasks, 1 open");
  await expect(page.getByTestId("rail-overdue")).toHaveCount(0);
});

const divider = (page: Page) => page.getByTestId("tasks-divider");
const width = async (l: ReturnType<Page["locator"]>) => Math.round((await box(l)).width);
const toast = (page: Page, text: string) => page.locator("[data-sonner-toast]").filter({ hasText: text });

/** Press the divider and move it by `dx` px (negative = left = wider Tasks). */
async function dragDivider(page: Page, dx: number) {
  const b = await box(divider(page));
  const [x, y] = [b.x + b.width / 2, b.y + b.height / 2];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y, { steps: 5 });
  await page.mouse.move(x + dx, y, { steps: 5 });
  await page.mouse.up();
}

test("US11: the divider resizes Tasks within its limits by pointer and keyboard; the width is remembered", async ({ page }) => {
  await signIn(page);
  await page.goto("/");
  await expect(divider(page)).toHaveAttribute("role", "separator");
  await expect(divider(page)).toHaveAccessibleName("Resize tasks panel");
  await expect(divider(page)).toHaveAttribute("aria-controls", "tasks-panel");
  const main = (await width(calendar(page))) + (await width(tasks(page))) + 8;
  const max = Math.floor(Math.min(0.6 * VIEWPORT.width, main - 480 - 8));

  // far right: stops at 320 px; far left: stops where the Calendar keeps 480 px (or 60 %)
  await dragDivider(page, 600);
  await expect.poll(() => width(tasks(page))).toBe(320);
  await dragDivider(page, -900);
  await expect.poll(() => width(tasks(page))).toBe(max);
  expect(await width(calendar(page))).toBeGreaterThanOrEqual(480);

  // keyboard: Enter resets to 420, arrows step 16 px, Home / End go to the limits
  await divider(page).focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => width(tasks(page))).toBe(420);
  await page.keyboard.press("ArrowLeft");
  await expect.poll(() => width(tasks(page))).toBe(436);
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => width(tasks(page))).toBe(420);
  await page.keyboard.press("Home");
  await expect.poll(() => width(tasks(page))).toBe(320);
  await page.keyboard.press("End");
  await expect.poll(() => width(tasks(page))).toBe(max);
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect.poll(() => width(tasks(page))).toBe(452);
  await expect(divider(page)).toHaveAttribute("aria-valuenow", "452");

  // remembered after a reload
  await page.reload();
  await expect.poll(() => width(tasks(page))).toBe(452);

  // Calendar closed: Tasks fills the column (no divider); reopened: back to the stored width
  await page.locator("#close-calendar").click();
  await expect(divider(page)).toHaveCount(0);
  await expect.poll(() => width(tasks(page))).toBe(main - 44 - 8);
  await page.locator("#show-calendar").click();
  await expect.poll(() => width(tasks(page))).toBe(452);
  await divider(page).focus();
  await page.keyboard.press("Enter");
});

test("US12: narrow windows keep one panel open and say why; the left card can take the room", async ({ page }) => {
  await signIn(page);
  await page.goto("/");
  await expect(tasks(page)).toBeVisible();

  // 900 px: Tasks closes with a notice
  await page.setViewportSize({ width: 900, height: 768 });
  await expect(tasks(page)).toBeHidden();
  await expect(calendar(page)).toBeVisible();
  await expect(toast(page, "Tasks closed to make room for the calendar")).toBeVisible();
  await expect(announcer(page)).toHaveText("Tasks closed to make room for the calendar");
  // the left card's opener sits at the start of the open panel's header
  await expect(calendar(page).locator("[data-panel-header] > :first-child")).toHaveAccessibleName("Show side panel");

  // opening Tasks closes the Calendar, with a notice
  await page.locator("#show-tasks").click();
  await expect(tasks(page)).toBeVisible();
  await expect(calendar(page)).toBeHidden();
  await expect(toast(page, "Calendar closed to make room for tasks")).toBeVisible();
  await expect(tasks(page).locator("[data-panel-header] > :first-child")).toHaveAccessibleName("Show side panel");
  await expect(page.locator("#close-tasks")).toHaveAttribute("aria-disabled", "true");

  // first use at 1024 px: Calendar open, Tasks as a rail, silently
  await page.evaluate(() => localStorage.clear());
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.reload();
  await expect(calendar(page)).toBeVisible();
  await expect(page.locator("[data-rail=tasks]")).toBeVisible();
  await expect(tasks(page)).toBeHidden();
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);

  // 1366 px with the left card at its widest: both still fit
  await page.evaluate(() => {
    localStorage.setItem("uh.panel.width", "480");
    localStorage.setItem("uh.panel.collapsed", "true");
    localStorage.setItem("uh.home.panels", JSON.stringify({ calendar: true, tasks: true }));
  });
  await page.setViewportSize(VIEWPORT);
  await page.reload();
  await expect(tasks(page)).toBeVisible();
  await page.locator("body").press("[");
  await expect.poll(() => width(page.locator("#course-panel"))).toBe(480);
  await expect(tasks(page)).toBeVisible();
  await page.locator("body").press("[");

  // 1280 px: opening the left card at 480 px leaves no room for both, so Tasks closes
  await page.setViewportSize({ width: 1280, height: 768 });
  await expect(tasks(page)).toBeVisible();
  await page.locator("body").press("[");
  await expect(tasks(page)).toBeHidden();
  await expect(toast(page, "Tasks closed to make room for the calendar")).toBeVisible();
  // closing the left card again gives the room back
  await page.locator("body").press("[");
  await expect(tasks(page)).toBeVisible();
});

test("US13: focus mode hides the left card and the rails, never the open panels", async ({ page }) => {
  await signIn(page);
  await page.goto("/");
  await page.locator("#close-tasks").click();
  await expect(page.locator("[data-rail=tasks]")).toBeVisible();

  await page.locator("body").press("\\");
  await expect(page.locator("#course-panel")).toBeHidden();
  await expect(page.locator("[data-rail=tasks]")).toHaveCount(0);
  await expect(calendar(page)).toBeVisible();
  // the Calendar fills the whole main column
  await expect.poll(async () => width(calendar(page))).toBe(VIEWPORT.width - 16);
  await expect(calendar(page).locator("#focus-mode-button")).toHaveAttribute("aria-pressed", "true");
  // Shift+T still opens Tasks; closing it moves focus into the Calendar (no rail to focus)
  await page.locator("body").press("Shift+T");
  await expect(tasks(page)).toBeVisible();
  await page.locator("#close-tasks").click();
  await expect(tasks(page)).toBeHidden();
  await expect.poll(() => headerHasFocus(page, "calendar")).toBe(true);
  // with the Calendar closed the focus button moves to the Tasks header
  await page.keyboard.press("Shift+T");
  await page.locator("#close-calendar").click();
  await expect(tasks(page).locator("#focus-mode-button")).toBeVisible();
  await expect(page.locator("#focus-mode-button")).toHaveCount(1);
  await expect.poll(() => headerHasFocus(page, "tasks")).toBe(true);

  // leaving focus mode brings back the left card and the rail; panel state is unchanged
  await page.locator("body").press("\\");
  await expect(page.locator("#course-panel")).toBeVisible();
  await expect(page.locator("[data-rail=calendar]")).toBeVisible();
  await expect(tasks(page)).toBeVisible();
  await page.locator("#show-calendar").click();
});

test("US13: leaving the home page and coming back keeps panels, widths and scroll; other pages look as before", async ({ page }, info) => {
  const t = tag(info.project.name);
  await signIn(page);
  await resetBoard(page);
  await seedTasks(page, "To do", Array.from({ length: 25 }, (_, i) => `Scroll task ${i + 1}`));
  const course = `Back ${t} ${Date.now() % 100000}`;
  const cls = await seedClass(page, {
    course: newHierarchy(course, `Sem B${t}${Date.now() % 1000}`, `Y B${t}${Date.now() % 1000}`),
    startDate: "2026-10-05", startTime: "08:00", endTime: "09:00", color: "teal", recurrence: { freq: "none" },
  });
  await page.goto("/calendar/week/2026-10-05");
  await divider(page).focus();
  await page.keyboard.press("ArrowLeft");
  await expect.poll(() => width(tasks(page))).toBe(436);

  const grid = calendar(page).locator("[data-calendar-scroll]");
  const col = board(page).getByRole("group", { name: "To do", exact: true }).locator("[data-column-scroll]");
  await grid.evaluate((el) => (el.scrollTop = 600));
  await board(page).evaluate((el) => (el.scrollLeft = 200));
  await col.evaluate((el) => (el.scrollTop = 300));
  const before = {
    grid: await grid.evaluate((el) => el.scrollTop),
    board: await board(page).evaluate((el) => el.scrollLeft),
    col: await col.evaluate((el) => el.scrollTop),
  };
  expect(before.board).toBeGreaterThan(0);
  expect(before.col).toBeGreaterThan(0);

  // a course page (client-side navigation, as from the left card) looks as before: no panels
  await page.evaluate((id) => {
    history.pushState(null, "", `/courses/${id}`);
    dispatchEvent(new PopStateEvent("popstate"));
  }, cls.courseId as string);
  await expect(page).toHaveURL(new RegExp(`/courses/${cls.courseId}$`));
  await expect(mainCard(page)).toBeVisible();
  await expect(tasks(page)).toHaveCount(0);
  await expect(calendar(page)).toHaveCount(0);
  await expect(mainCard(page).getByRole("heading", { level: 1, name: course })).toBeVisible();

  await page.goBack();
  await expect(tasks(page)).toBeVisible();
  await expect.poll(() => width(tasks(page))).toBe(436);
  await expect.poll(() => grid.evaluate((el) => el.scrollTop)).toBe(before.grid);
  await expect.poll(() => board(page).evaluate((el) => el.scrollLeft)).toBe(before.board);
  await expect.poll(() => col.evaluate((el) => el.scrollTop)).toBe(before.col);

  // a session workspace: the main card as before, no Tasks panel
  await page.goto(workspaceUrl(cls.courseId, cls.lineageId, "2026-10-05"));
  await expect(mainCard(page)).toBeVisible();
  await expect(tasks(page)).toHaveCount(0);
  await page.goto("/");
  await divider(page).focus();
  await page.keyboard.press("Enter");
});

test("reduced motion: panels open and close without transitions", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signIn(page);
  await page.goto("/");
  const slot = page.locator("[data-slot-panel=tasks]");
  expect(await slot.evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration))).toBeLessThanOrEqual(0.01);
  // closing takes effect at once: the rail has its final width in the next frame
  await page.locator("#close-tasks").click();
  const rail = page.locator("[data-rail=tasks]");
  await expect(rail).toBeVisible();
  expect(await width(rail)).toBe(44);
  // toasts and popovers don't animate either
  await page.setViewportSize({ width: 900, height: 768 });
  await page.locator("#show-tasks").click();
  const note = toast(page, "Calendar closed to make room for tasks");
  await expect(note).toBeVisible();
  expect(await note.evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration))).toBeLessThanOrEqual(0.01);
  await page.setViewportSize(VIEWPORT);
  await page.locator("#show-calendar").click();
});
