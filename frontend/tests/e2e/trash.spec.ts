import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { newHierarchy, seedClass, signIn, tag } from "./helpers";

const DATA = path.resolve(import.meta.dirname, "../../../data-e2e/files/owner");

async function call(page: Page, method: "get" | "post" | "delete", url: string, data?: unknown, headers: Record<string, string> = {}) {
  const csrf = (await page.context().cookies()).find((c) => c.name === "uh_csrf")?.value ?? "";
  const r = await page.request[method](url, { data, headers: { "X-CSRF-Token": csrf, ...headers } });
  expect(r.ok(), await r.text()).toBe(true);
  return r.status() === 204 ? null : r.json();
}

/** A class (Mon 9:00, three weeks) and a one-off event in their own year/semester. */
async function seed(page: Page, t: string, prefix: string) {
  const course = `${prefix}${t} 201`;
  const semester = `Term ${prefix}${t}`;
  const year = `Year ${prefix}${t}`;
  const cls = await seedClass(page, {
    course: newHierarchy(course, semester, year, "2027-01-10"), startDate: "2026-10-05", startTime: "09:00", endTime: "10:00",
    color: "teal", recurrence: { freq: "weekly", byWeekday: ["MO"], end: { kind: "count", count: 3 } },
  });
  const semesterId = (await call(page, "get", `/api/v1/courses/${cls.courseId}`)).semesterId as string;
  const ev = await call(page, "post", "/api/v1/events", {
    title: `Exam ${prefix}${t}`, semester: { id: semesterId }, startDate: "2026-10-07", startTime: "13:00", endTime: "15:00",
  });
  return { course, semester, year, semesterId, cls, ev, exam: `Exam ${prefix}${t}` };
}

async function deleteFromCalendar(page: Page, name: RegExp, popover: string) {
  await page.getByRole("button", { name }).click();
  await page.getByRole("dialog", { name: popover }).getByRole("button", { name: "Delete" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("to the Trash. You can restore it from Settings → Trash.");
  await confirm.getByRole("button", { name: "Move to Trash" }).click();
  await expect(confirm).toBeHidden();
}

test("US4: delete event → listed → restore with its note; delete class → No keeps it → Yes removes files", async ({ page }, testInfo) => {
  const t = tag(testInfo.project.name);
  await signIn(page);
  const s = await seed(page, t, "TRA");
  const ekey = `${s.ev.lineageId}:2026-10-07`;
  await call(page, "post", `/api/v1/sessions/${ekey}/notes`, { name: "Revision", content: "# kept" });
  const ckey = `${s.cls.lineageId}:2026-10-12`;
  await call(page, "post", `/api/v1/sessions/${ckey}/notes`, { name: "Week 2", content: "bye" });

  await page.goto("/calendar/week/2026-10-05");
  await deleteFromCalendar(page, new RegExp(`^Event: ${s.exam}, Wednesday 7 October`), `Event: ${s.exam}`);
  await expect(page.locator("[data-kind=event]").filter({ hasText: s.exam })).toHaveCount(0);

  // Settings → Trash
  await page.goto("/settings");
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: "Trash" }).click();
  await expect(page).toHaveURL(/\/settings\/trash$/);
  const events = page.getByRole("region", { name: "Deleted events" });
  const card = events.getByRole("listitem").filter({ hasText: s.exam });
  await expect(card).toContainText(`${s.year} · ${s.semester}`);
  await expect(card).toContainText("Wed 7 Oct 2026, 13:00–15:00");
  await expect(card).toContainText("1 note");
  const scan = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(scan.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);

  await card.getByRole("button", { name: `Restore ${s.exam}` }).click();
  await expect(page.getByText(`Restored ${s.exam}`)).toBeVisible();
  await expect(events.getByRole("listitem").filter({ hasText: s.exam })).toHaveCount(0);
  await page.getByRole("button", { name: "Show in calendar" }).click();
  await expect(page).toHaveURL(/\/calendar\/week\/2026-10-0/);
  await expect(page.getByRole("button", { name: new RegExp(`^Event: ${s.exam}, Wednesday 7 October`) })).toBeVisible();
  const notes = await call(page, "get", `/api/v1/sessions/${ekey}/notes`);
  expect(notes.map((n: { name: string }) => n.name)).toEqual(["Revision"]);

  // a class session: Delete → "Are you sure?" → No (focused) keeps it, Yes removes its files
  await page.goto("/calendar/week/2026-10-12");
  await page.getByRole("button", { name: new RegExp(`^${s.course}, Monday 12 October`) }).click();
  await page.getByRole("dialog", { name: s.course }).getByRole("button", { name: "Delete" }).click();
  const scope = page.getByRole("dialog", { name: "Delete recurring class" });
  await scope.getByRole("radio", { name: "This session" }).check();
  await scope.getByRole("button", { name: "Continue" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Delete this session?" });
  await expect(confirm).toContainText(`This will move 1 session of ${s.course} with 1 note to the Trash.`);
  await confirm.getByRole("button", { name: "Move to Trash" }).click();
  const folder = path.join(DATA, s.year, s.semester, s.course, "2026-10-12");
  expect(readFileSync(path.join(folder, "notes", "Week 2.md"), "utf8")).toBe("bye");

  await page.goto("/settings/trash");
  const classes = page.getByRole("region", { name: "Deleted classes" });
  const entry = classes.getByRole("listitem").filter({ hasText: "Mon 12 Oct 2026" }).filter({ hasText: s.course });
  await entry.getByRole("button", { name: `Delete ${s.course} permanently` }).click();
  const sure = page.getByRole("alertdialog", { name: "Are you sure?" });
  await expect(sure.getByRole("button", { name: "No" })).toBeFocused();
  await sure.getByRole("button", { name: "No" }).click();
  await expect(entry).toHaveCount(1);
  expect(existsSync(folder)).toBe(true);
  await entry.getByRole("button", { name: `Delete ${s.course} permanently` }).click();
  await sure.getByRole("button", { name: "Yes" }).click();
  await expect(page.getByText(`Deleted ${s.course} permanently`)).toBeVisible();
  await expect(entry).toHaveCount(0);
  expect(existsSync(folder)).toBe(false);
});

test("US4: deleting a semester puts each class and event in the Trash; restoring one recreates the semester", async ({ page }, testInfo) => {
  const t = tag(testInfo.project.name);
  await signIn(page);
  const s = await seed(page, t, "TRB");
  await call(page, "post", `/api/v1/sessions/${s.cls.lineageId}:2026-10-05/notes`, { name: "Intro", content: "hello" });

  await page.goto("/calendar/week/2026-10-05");
  const nav = page.getByRole("navigation", { name: "Courses" });
  await nav.getByRole("button", { name: `Actions for ${s.semester}` }).click();
  await page.getByRole("menuitem", { name: "Delete…" }).click();
  const confirm = page.getByRole("alertdialog", { name: `Delete ${s.semester}?` });
  await expect(confirm).toContainText("Its 1 class and 1 event, with 1 note, move to the Trash");
  await confirm.getByRole("button", { name: "Delete semester" }).click();
  await expect(confirm).toBeHidden();
  await expect(nav.getByText(s.semester)).toHaveCount(0);
  const folder = path.join(DATA, s.year, s.semester, s.course, "2026-10-05");
  expect(readFileSync(path.join(folder, "notes", "Intro.md"), "utf8")).toBe("hello"); // nothing removed

  await page.goto("/settings/trash");
  const classes = page.getByRole("region", { name: "Deleted classes" });
  const events = page.getByRole("region", { name: "Deleted events" });
  await expect(events.getByRole("listitem").filter({ hasText: s.exam })).toHaveCount(1);
  const entry = classes.getByRole("listitem").filter({ hasText: s.course });
  await expect(entry).toContainText("3 occurrences, 5 Oct – 19 Oct 2026");
  await entry.getByRole("button", { name: `Restore ${s.course}` }).click();
  await expect(page.getByText(`Restored ${s.course}`)).toBeVisible();
  await expect(page.getByText(`Recreated semester “${s.semester}”, course “${s.course}”.`)).toBeVisible();

  await page.goto("/calendar/week/2026-10-05");
  await expect(nav.getByText(s.semester)).toBeVisible();
  await expect(nav.getByText(s.course)).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(`^${s.course}, Monday 5 October`) })).toBeVisible();
  const notes = await call(page, "get", `/api/v1/sessions/${s.cls.lineageId}:2026-10-05/notes`);
  expect(notes.map((n: { name: string }) => n.name)).toEqual(["Intro"]);
});
