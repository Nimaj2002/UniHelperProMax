/**
 * 012 US1 (board, cards, pointer and keyboard moves) and US2 (columns), contracts/ui-home-tasks.md.
 */
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";
import { VIEWPORT } from "./layout-helpers";
import {
  announcer,
  api,
  board,
  card,
  column,
  columnTitles,
  dragTo,
  getColumns,
  getTasks,
  openBoardWide,
  resetBoard,
  seedTasks,
  shownTitles,
} from "./tasks-helpers";

test.use({ viewport: VIEWPORT });

test.beforeEach(async ({ page }) => {
  await signIn(page);
  await resetBoard(page);
});

const columnNames = (page: Page) => board(page).locator("[data-column-id] h3").allTextContents();

test("US1: the board starts with To do / In progress / Done; create by New task and by a column field", async ({ page }) => {
  await page.goto("/");
  await expect.poll(() => columnNames(page)).toEqual(["To do", "In progress", "Done"]);
  await expect(column(page, "Done").getByTestId("done-column-badge")).toHaveText("Done column");
  await expect(column(page, "To do")).toContainText("No tasks");

  // "New task": title only, lands at the end of the first column
  await page.locator("#tasks-panel").getByRole("button", { name: "New task" }).click();
  const title = page.getByRole("textbox", { name: "New task title" });
  await expect(title).toBeFocused();
  await title.fill("Read ch. 4");
  await title.press("Enter");
  await expect(title).toBeHidden();
  await expect(card(page, "Read ch. 4")).toBeVisible();
  await expect.poll(() => shownTitles(page, "To do")).toEqual(["Read ch. 4"]);

  // the column's "Add task" field: Enter creates at the end, clears and keeps focus; empty does nothing
  const add = page.getByRole("textbox", { name: "Add task to In progress" });
  await add.fill("Write essay");
  await add.press("Enter");
  await expect(add).toHaveValue("");
  await expect(add).toBeFocused();
  await add.fill("Second");
  await add.press("Enter");
  await add.press("Enter");
  await expect.poll(() => shownTitles(page, "In progress")).toEqual(["Write essay", "Second"]);
  await add.fill("typo");
  await add.press("Escape");
  await expect(add).toHaveValue("");
  await expect.poll(() => columnTitles(page, "In progress")).toEqual(["Write essay", "Second"]);
});

test("US1: pointer drag to another column and to the top of the same column; reload keeps the order", async ({ page }) => {
  await seedTasks(page, "To do", ["A", "B", "C"]);
  await seedTasks(page, "In progress", ["X"]);
  await openBoardWide(page);

  // C → In progress, below X
  const x = (await card(page, "X").boundingBox())!;
  await dragTo(page, card(page, "C"), { x: x.x + x.width / 2, y: x.y + x.height + 30 }, false);
  await expect(page.getByTestId("drag-clone")).toBeVisible();
  await expect(column(page, "In progress").locator("[data-ghost]")).toBeVisible();
  await page.mouse.up();
  await expect(page.getByTestId("drag-clone")).toBeHidden();
  await expect.poll(() => columnTitles(page, "In progress")).toEqual(["X", "C"]);
  await expect(announcer(page)).toHaveText("Dropped in In progress, position 2 of 2.");

  // B → top of To do
  const a = (await card(page, "A").boundingBox())!;
  await dragTo(page, card(page, "B"), { x: a.x + a.width / 2, y: a.y + 4 });
  await expect.poll(() => columnTitles(page, "To do")).toEqual(["B", "A"]);

  await page.reload();
  await expect.poll(() => shownTitles(page, "To do")).toEqual(["B", "A"]);
  await expect.poll(() => shownTitles(page, "In progress")).toEqual(["X", "C"]);
});

test("US1: Escape cancels a drag; a press under 4 px is a click, not a drag", async ({ page }) => {
  await seedTasks(page, "To do", ["A", "B"]);
  await openBoardWide(page);
  const target = (await column(page, "Done").boundingBox())!;
  await dragTo(page, card(page, "A"), { x: target.x + 100, y: target.y + 100 }, false);
  await expect(page.getByTestId("drag-clone")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("drag-clone")).toBeHidden();
  await page.mouse.up();
  await expect(announcer(page)).toHaveText("Move cancelled.");
  await expect.poll(() => shownTitles(page, "To do")).toEqual(["A", "B"]);
  expect(await columnTitles(page, "To do")).toEqual(["A", "B"]);

  // a 2 px wiggle: no drag starts, nothing moves
  const b = (await card(page, "B").boundingBox())!;
  await page.mouse.move(b.x + 5, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + 7, b.y + b.height / 2 + 1, { steps: 2 });
  await expect(page.getByTestId("drag-clone")).toHaveCount(0);
  await page.mouse.up();
  expect(await columnTitles(page, "To do")).toEqual(["A", "B"]);

  // presses on the card's controls never start a drag
  const notes = card(page, "A").getByRole("button", { name: /^Quick notes/ });
  const n = (await notes.boundingBox())!;
  await page.mouse.move(n.x + n.width / 2, n.y + n.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + 100, target.y + 100, { steps: 10 });
  await expect(page.getByTestId("drag-clone")).toHaveCount(0);
  await page.mouse.up();
  expect(await columnTitles(page, "To do")).toEqual(["A", "B"]);
});

test("US1: keyboard move — Enter, arrows, Enter moves and announces; Escape cancels", async ({ page }) => {
  await seedTasks(page, "To do", ["A", "B"]);
  await seedTasks(page, "In progress", ["X"]);
  await openBoardWide(page);

  const move = page.getByRole("button", { name: "Move A", exact: true });
  await move.focus();
  await page.keyboard.press("Enter");
  await expect(move).toHaveAttribute("aria-pressed", "true");
  await expect(announcer(page)).toHaveText("Picked up A. Position 1 of 2 in To do.");
  await page.keyboard.press("ArrowRight");
  await expect(announcer(page)).toHaveText("Moved to In progress, position 1 of 2.");
  await expect(column(page, "In progress").locator("[data-ghost]")).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(announcer(page)).toHaveText("Moved to In progress, position 2 of 2.");
  await page.keyboard.press("Enter");
  await expect(announcer(page)).toHaveText("Dropped in In progress, position 2 of 2.");
  await expect.poll(() => columnTitles(page, "In progress")).toEqual(["X", "A"]);
  await expect(page.getByRole("button", { name: "Move A", exact: true })).toBeFocused();
  await expect(page.getByRole("button", { name: "Move A", exact: true })).toHaveAttribute("aria-pressed", "false");

  // Enter → arrow → Escape: back where it was
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Escape");
  await expect(announcer(page)).toHaveText("Move cancelled.");
  await expect(column(page, "In progress").locator("[data-ghost]")).toHaveCount(0);
  expect(await columnTitles(page, "In progress")).toEqual(["X", "A"]);

  // into Done: completion recorded
  await page.getByRole("button", { name: "Move B", exact: true }).focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect.poll(() => columnTitles(page, "Done")).toEqual(["B"]);
  const b = (await getTasks(page)).find((t) => t.title === "B")!;
  expect(b.completedAt).not.toBeNull();
});

test("US1: dragging at a long column's bottom edge scrolls it", async ({ page }) => {
  await seedTasks(page, "To do", Array.from({ length: 16 }, (_, i) => `Task ${i + 1}`));
  await openBoardWide(page);
  const scroller = column(page, "To do").locator("[data-column-scroll]");
  await expect.poll(() => scroller.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  const s = (await scroller.boundingBox())!;
  await dragTo(page, card(page, "Task 1"), { x: s.x + s.width / 2, y: s.y + s.height - 4 }, false);
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop), { timeout: 5_000 }).toBeGreaterThan(50);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect((await columnTitles(page, "To do"))[0]).toBe("Task 1");
});

// ---- US2: columns -------------------------------------------------------------------------------

async function addColumn(page: Page, name: string) {
  await board(page).getByRole("button", { name: "Add column" }).click();
  const input = page.getByRole("textbox", { name: "New column name" });
  await input.fill(name);
  await input.press("Enter");
  return input;
}

async function columnMenu(page: Page, name: string, item: string | RegExp) {
  await page.getByRole("button", { name: `Column actions for ${name}` }).click();
  await page.getByRole("menuitem", { name: item }).or(page.getByRole("menuitemcheckbox", { name: item })).click();
}

test("US2: add, duplicate refused, rename, reorder by keyboard and pointer, counts as done", async ({ page }) => {
  await openBoardWide(page);
  const input = await addColumn(page, "Waiting");
  await expect(input).toBeHidden();
  await expect.poll(() => columnNames(page)).toEqual(["To do", "In progress", "Done", "Waiting"]);

  const again = await addColumn(page, "waiting");
  await expect(page.getByRole("alert")).toHaveText("A column with this name already exists");
  await again.press("Escape");
  await expect.poll(async () => (await getColumns(page)).length).toBe(4);

  await addColumn(page, "x".repeat(41));
  await expect(page.getByRole("alert")).toHaveText("Names can be at most 40 characters");
  await page.keyboard.press("Escape");

  await columnMenu(page, "Waiting", "Rename");
  const rename = page.getByRole("textbox", { name: "Column name" });
  await expect(rename).toBeFocused();
  await rename.fill("Blocked");
  await rename.press("Enter");
  await expect.poll(() => columnNames(page)).toEqual(["To do", "In progress", "Done", "Blocked"]);

  // keyboard: Blocked two places left
  const handle = page.getByRole("button", { name: "Reorder column Blocked" });
  await handle.focus();
  await page.keyboard.press("Enter");
  await expect(announcer(page)).toHaveText("Picked up column Blocked. Position 4 of 4.");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(announcer(page)).toHaveText("Column Blocked, position 2 of 4.");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await getColumns(page)).map((c) => c.name)).toEqual(["To do", "Blocked", "In progress", "Done"]);
  await expect(page.getByRole("button", { name: "Reorder column Blocked" })).toBeFocused();

  // pointer: drag Done's header before To do
  const doneHeader = column(page, "Done").locator("h3");
  const todo = (await column(page, "To do").boundingBox())!;
  await dragTo(page, doneHeader, { x: todo.x + 20, y: todo.y + 20 });
  await expect.poll(async () => (await getColumns(page)).map((c) => c.name)).toEqual(["Done", "To do", "Blocked", "In progress"]);
  await page.reload();
  await expect.poll(() => columnNames(page)).toEqual(["Done", "To do", "Blocked", "In progress"]);

  // Move right from the menu
  await columnMenu(page, "Done", "Move right");
  await expect.poll(() => columnNames(page)).toEqual(["To do", "Done", "Blocked", "In progress"]);

  await columnMenu(page, "Blocked", "Counts as done");
  await expect(column(page, "Blocked").getByTestId("done-column-badge")).toBeVisible();
  expect((await getColumns(page)).find((c) => c.name === "Blocked")!.countsAsDone).toBe(true);
});

test("US2: deleting a column with tasks asks for a target; an empty one offers Undo; the last can't go", async ({ page }) => {
  await seedTasks(page, "In progress", ["P1", "P2"]);
  await openBoardWide(page);

  await columnMenu(page, "In progress", "Delete");
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Move its 2 tasks to");
  await dialog.getByRole("combobox").click();
  await page.getByRole("option", { name: "Done" }).click();
  // nothing changes before confirming
  expect((await getColumns(page)).length).toBe(3);
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => columnNames(page)).toEqual(["To do", "Done"]);
  await expect.poll(() => columnTitles(page, "Done")).toEqual(["P1", "P2"]);

  // empty column: deleted at once, Undo brings it back in place
  await columnMenu(page, "To do", "Delete");
  await expect.poll(() => columnNames(page)).toEqual(["Done"]);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => columnNames(page)).toEqual(["To do", "Done"]);

  // the last column cannot be deleted
  const cols = await getColumns(page);
  for (const c of cols.filter((c) => c.name !== "Done"))
    await api(page, "DELETE", `/task-columns/${c.id}`, undefined, c.version);
  await page.reload();
  await expect.poll(() => columnNames(page)).toEqual(["Done"]);
  await page.getByRole("button", { name: "Column actions for Done" }).click();
  const del = page.getByRole("menuitem", { name: /Delete/ });
  await expect(del).toHaveAttribute("aria-disabled", "true");
  await expect(del).toContainText("The board needs at least one column");
});

test("US2: a 13th column is refused", async ({ page }) => {
  for (let i = 4; i <= 12; i++) await api(page, "POST", "/task-columns", { name: `Col ${i}` });
  await openBoardWide(page);
  const add = board(page).getByRole("button", { name: "Add column" });
  await add.scrollIntoViewIfNeeded();
  await expect(add).toHaveAttribute("aria-disabled", "true");
  await expect(add).toHaveAccessibleDescription("A board holds at most 12 columns");
  await add.click({ force: true });
  await expect(page.getByRole("textbox", { name: "New column name" })).toHaveCount(0);
});

/** Milliseconds from the next `trigger` event (pointerup, click…) to the moment `done()` holds in the DOM. */
async function armTimer(page: Page, trigger: string, done: string) {
  await page.evaluate(
    ([trigger, done]) => {
      const w = window as unknown as { __perf: Promise<number> };
      w.__perf = new Promise<number>((resolve) => {
        window.addEventListener(
          trigger,
          (e) => {
            const t0 = e.timeStamp;
            const check = new Function(`return (${done})`) as () => boolean;
            if (check()) return resolve(performance.now() - t0);
            const mo = new MutationObserver(() => {
              if (!check()) return;
              mo.disconnect();
              resolve(performance.now() - t0);
            });
            mo.observe(document.body, { childList: true, subtree: true, attributes: true });
          },
          { capture: true, once: true },
        );
      });
    },
    [trigger, done],
  );
}
const elapsed = (page: Page) => page.evaluate(() => (window as unknown as { __perf: Promise<number> }).__perf);

test("SC: with 300 tasks in 12 columns a cross-column drop and a filter change render within 100 ms", async ({ page }) => {
  test.setTimeout(180_000);
  for (let i = 4; i <= 12; i++) await api(page, "POST", "/task-columns", { name: `Column ${i}` });
  const cols = await getColumns(page);
  expect(cols).toHaveLength(12);
  await Promise.all(
    cols.map(async (c) => {
      for (let i = 1; i <= 25; i++) await api(page, "POST", "/tasks", { title: `${c.name} task ${i}`, columnId: c.id });
    }),
  );
  expect(await getTasks(page)).toHaveLength(300);

  await openBoardWide(page);
  await expect(board(page).locator("[data-task-id]")).toHaveCount(300);
  const moving = (await getTasks(page)).find((t) => t.title === "To do task 1")!;
  const target = cols.find((c) => c.name === "In progress")!;

  // drop "To do task 1" at the top of "In progress"
  const into = (await column(page, "In progress").locator("[data-task-id]").first().boundingBox())!;
  await dragTo(page, card(page, "To do task 1"), { x: into.x + into.width / 2, y: into.y + 4 }, false);
  await armTimer(page, "pointerup", `!!document.querySelector('[data-column-id="${target.id}"] [data-task-id="${moving.id}"]')`);
  await page.mouse.up();
  const drop = await elapsed(page);
  test.info().annotations.push({ type: "drop ms", description: String(Math.round(drop)) });
  expect(drop, `drop rendered in ${Math.round(drop)} ms`).toBeLessThan(100);
  await expect.poll(async () => (await getTasks(page)).find((t) => t.id === moving.id)?.columnId).toBe(target.id);

  // a filter change: "Show done" off hides the Done column's 25 cards
  const done = cols.find((c) => c.countsAsDone)!;
  await page.locator("#tasks-panel").getByRole("button", { name: /^Filter/ }).click();
  const show = page.getByRole("dialog", { name: "Task filters" }).getByLabel("Show done");
  await armTimer(page, "click", `document.querySelectorAll('[data-column-id="${done.id}"] [data-task-id]').length === 0`);
  await show.click();
  const filter = await elapsed(page);
  test.info().annotations.push({ type: "filter ms", description: String(Math.round(filter)) });
  expect(filter, `filter rendered in ${Math.round(filter)} ms`).toBeLessThan(100);
  await show.click();
  await page.keyboard.press("Escape");
});
