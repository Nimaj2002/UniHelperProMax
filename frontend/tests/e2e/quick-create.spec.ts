import { expect, test, type Page } from "@playwright/test";
import { newHierarchy, seedClass, signIn, tag } from "./helpers";

/** 009 US5–US7: drafts by press-and-drag, click, month click, keyboard and touch; the quick form. */

const HOUR_PX = 48;

async function api(page: Page, method: "PATCH" | "POST", url: string, data: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === "uh_csrf")?.value ?? "";
  const r = await page.request.fetch(url, { method, data, headers: { "X-CSRF-Token": csrf } });
  expect(r.ok(), await r.text()).toBe(true);
  return r.status() === 204 ? null : r.json();
}

/** Its own year/semester (a one-off class far from the test weeks) chosen as the last used
 * semester, and a fixed starting type for the quick form. Each project uses its own month. */
async function setup(page: Page, testInfo: { project: { name: string } }, prefix: string, type: "class" | "event" = "event") {
  const t = tag(testInfo.project.name);
  await signIn(page);
  const year = `Year ${prefix}${t}`;
  const semester = `Spring ${prefix}${t}`;
  const course = `${prefix}${t} 100`;
  const cls = await seedClass(page, {
    course: newHierarchy(course, semester, year, "2027-12-31"),
    startDate: "2027-01-04", startTime: "07:00", endTime: "08:00", color: "teal", recurrence: { freq: "none" },
  });
  const detail = await (await page.request.get(`/api/v1/courses/${cls.courseId}`)).json();
  await api(page, "PATCH", "/api/v1/preferences", { lastSemesterId: detail.semesterId, quickCreateType: type });
  // light and dark projects share one backend: separate weeks keep their entries apart (and
  // away from calendar-performance.spec's entries from 15 February 2027 on)
  const week = t === "L" ? { mon: "2027-02-01", tue: "2027-02-02", wed: "2027-02-03", tueLabel: "Tuesday 2 February", wedLabel: "Wednesday 3 February" }
    : { mon: "2027-01-18", tue: "2027-01-19", wed: "2027-01-20", tueLabel: "Tuesday 19 January", wedLabel: "Wednesday 20 January" };
  return { t, year, semester, course, semesterId: detail.semesterId as string, ...week };
}

/** Page y of a time in a day column (scrolled into view first). */
async function yAt(page: Page, day: string, min: number) {
  const scroller = page.locator("[data-calendar-grid] .overflow-y-auto");
  await scroller.evaluate((el, top) => (el.scrollTop = top), Math.max(0, (min / 60 - 2) * HOUR_PX));
  const box = (await page.locator(`[data-day="${day}"]`).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + (min / 60) * HOUR_PX + 6, box };
}

const quickForm = (page: Page) => page.getByRole("dialog", { name: "New entry" });
const draft = (page: Page) => page.locator("[data-draft]");

test("US5/US6: drag-create an event, Undo it, and the live draft label", async ({ page }, testInfo) => {
  const s = await setup(page, testInfo, "QCA");
  await page.goto(`/calendar/week/${s.mon}`);

  // press Tuesday 13:00, drag into Wednesday down to 14:30 → stays Tuesday, 13:00 – 14:45
  const from = await yAt(page, s.tue, 13 * 60);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const wed = (await page.locator(`[data-day="${s.wed}"]`).boundingBox())!;
  for (let i = 1; i <= 6; i++) await page.mouse.move(from.x + ((wed.x - from.x + 20) * i) / 6, from.y + (90 * HOUR_PX * i) / 60 / 6);
  await expect(draft(page)).toHaveText("13:00 – 14:45");
  await expect(page.locator(`[data-day="${s.tue}"] [data-draft]`)).toHaveCount(1);
  await page.mouse.up();

  const form = quickForm(page);
  await expect(form).toBeVisible();
  await expect(page.getByTestId("draft-announcer")).toHaveText("New entry, from 13:00 to 14:45");
  await expect(form.getByRole("radio", { name: "Event" })).toHaveAttribute("aria-checked", "true");
  await expect(form.getByRole("combobox", { name: "Semester" })).toContainText(s.semester);
  await expect(form.getByLabel("Title")).toBeFocused();
  await expect(form.getByRole("button", { name: "Save" })).toBeDisabled();
  await form.getByLabel("Title").fill(`Study group ${s.t}`);

  // date/time edits move the draft live; an end before the start blocks Save
  await form.getByLabel("End time").fill("15:00");
  await expect(draft(page)).toHaveText("13:00 – 15:00");
  await form.getByLabel("End time").fill("12:00");
  await expect(form.getByText("End must be after start")).toBeVisible();
  await expect(form.getByRole("button", { name: "Save" })).toBeDisabled();
  await form.getByLabel("End time").fill("14:45");
  await form.getByRole("button", { name: "Save" }).click();

  await expect(form).toBeHidden();
  const entry = page.getByRole("button", { name: `Event: Study group ${s.t}, ${s.tueLabel}, 13:00 to 14:45` });
  await expect(entry).toBeVisible();
  await expect(entry).toBeFocused();
  await expect(draft(page)).toHaveCount(0);
  const toast = page.locator("[data-sonner-toast]").filter({ hasText: "Event created" });
  await expect(toast).toBeVisible();
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(entry).toHaveCount(0);
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Event removed" })).toBeVisible();

  // Escape mid-drag leaves nothing behind
  const again = await yAt(page, s.tue, 16 * 60);
  await page.mouse.move(again.x, again.y);
  await page.mouse.down();
  await page.mouse.move(again.x, again.y + 60, { steps: 4 });
  await expect(draft(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(draft(page)).toHaveCount(0);
  await page.mouse.up();
  await expect(quickForm(page)).toBeHidden();
});

test("US6: click-create a class with a new course; same entry as the full form", async ({ page }, testInfo) => {
  const s = await setup(page, testInfo, "QCB", "class");
  await page.goto(`/calendar/week/${s.mon}`);
  const course = `QCB${s.t} 300`;

  // a click (no drag) at 10:20 → 10:15–11:15
  const at = await yAt(page, s.wed, 10 * 60 + 20);
  await page.mouse.click(at.x, at.box.y + ((10 * 60 + 20) / 60) * HOUR_PX);
  const form = quickForm(page);
  await expect(form).toBeVisible();
  await expect(draft(page)).toHaveText("10:15 – 11:15");
  await expect(form.getByRole("radio", { name: "Class" })).toHaveAttribute("aria-checked", "true");
  await expect(form.getByRole("combobox", { name: "Course" })).toBeFocused();
  await form.getByRole("combobox", { name: "Course" }).click();
  await page.keyboard.type(course);
  await page.getByRole("option", { name: `Create “${course}”` }).click();
  // the new course needs year and semester (preselected: the last used)
  await expect(form.getByRole("combobox", { name: "Semester" })).toContainText(s.semester);
  await form.getByLabel("Location (optional)").fill("FENS G032");
  await form.getByRole("button", { name: "Save" }).click();
  await expect(form).toBeHidden();
  await expect(page.getByRole("button", { name: `${course}, ${s.wedLabel}, 10:15 to 11:15, FENS G032` })).toBeVisible();

  // the same class through "More options" → full form, one week later
  const next = s.t === "L" ? "2027-02-10" : "2027-01-27";
  await page.goto(`/calendar/week/${next}`);
  const at2 = await yAt(page, next, 10 * 60 + 20);
  await page.mouse.click(at2.x, at2.box.y + ((10 * 60 + 20) / 60) * HOUR_PX);
  await quickForm(page).getByRole("combobox", { name: "Course" }).click();
  await page.getByRole("option", { name: new RegExp(`^${course} · ${s.semester}`) }).click();
  await quickForm(page).getByLabel("Location (optional)").fill("FENS G032");
  await quickForm(page).getByRole("button", { name: "More options" }).click();
  const full = page.getByRole("dialog", { name: "New class" });
  await expect(full.getByLabel("First session")).toHaveValue(next);
  await expect(full.getByLabel("Start time")).toHaveValue("10:15");
  await expect(full.getByLabel("End time")).toHaveValue("11:15");
  await expect(full.getByLabel("Location (optional)")).toHaveValue("FENS G032");
  await expect(full.getByRole("combobox", { name: "Course" })).toContainText(course);
  await full.getByRole("button", { name: "Save class" }).click();
  await expect(full).toBeHidden();

  const rows = (await (await page.request.get(`/api/v1/sessions?from=2027-01-01&to=2027-03-31`)).json()) as Record<string, unknown>[];
  const mine = rows.filter((r) => r.courseName === course);
  expect(mine).toHaveLength(2);
  const strip = ({ key: _k, lineageId: _l, seriesId: _s, date: _d, start: _st, end: _e, ...rest }: Record<string, unknown>) => rest;
  expect(strip(mine[0])).toEqual(strip(mine[1]));
  expect(mine.map((r) => [String(r.start).slice(11, 16), String(r.end).slice(11, 16)])).toEqual([["10:15", "11:15"], ["10:15", "11:15"]]);
});

test("US6: discard rules, failed save and retry, month click", async ({ page }, testInfo) => {
  const s = await setup(page, testInfo, "QCC");
  await page.goto(`/calendar/week/${s.mon}`);
  const clickAt = async (min: number, day = s.tue) => {
    const p = await yAt(page, day, min);
    await page.mouse.click(p.x, p.y);
  };

  // Cancel and Escape discard
  await clickAt(9 * 60);
  await quickForm(page).getByRole("button", { name: "Cancel" }).click();
  await expect(draft(page)).toHaveCount(0);
  await clickAt(9 * 60);
  await expect(quickForm(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(quickForm(page)).toBeHidden();
  await expect(draft(page)).toHaveCount(0);

  // click outside: an empty form goes; pressing another slot replaces the draft
  await clickAt(9 * 60);
  await expect(draft(page)).toHaveText("09:00 – 10:00");
  await clickAt(15 * 60);
  await expect(draft(page)).toHaveCount(1);
  await expect(draft(page)).toHaveText("15:00 – 16:00");
  await page.getByRole("heading", { level: 1 }).click();
  await expect(draft(page)).toHaveCount(0);

  // something entered: outside clicks and other slots keep the form
  await clickAt(9 * 60);
  await quickForm(page).getByLabel("Title").fill(`Exam ${s.t}`);
  await clickAt(15 * 60, s.wed);
  await expect(quickForm(page)).toBeVisible();
  await expect(draft(page)).toHaveText("09:00 – 10:00");
  await page.getByRole("heading", { level: 1 }).click();
  await expect(quickForm(page).getByLabel("Title")).toHaveValue(`Exam ${s.t}`);

  // a failed save keeps everything; Save retries
  let fail = true;
  await page.route("**/api/v1/events", async (route) => {
    if (route.request().method() === "POST" && fail) {
      fail = false;
      return route.fulfill({ status: 500, contentType: "application/problem+json", body: JSON.stringify({ type: "/problems/internal", title: "The server had a problem. Try again.", status: 500, code: "internal" }) });
    }
    return route.continue();
  });
  await quickForm(page).getByRole("button", { name: "Save" }).click();
  await expect(quickForm(page).getByRole("alert")).toContainText("The server had a problem");
  await expect(quickForm(page).getByLabel("Title")).toHaveValue(`Exam ${s.t}`);
  await quickForm(page).getByRole("button", { name: "Save" }).click();
  await expect(quickForm(page)).toBeHidden();
  const exam = page.getByRole("button", { name: `Event: Exam ${s.t}, ${s.tueLabel}, 09:00 to 10:00` });
  await expect(exam).toBeVisible();

  // something entered: a click on an existing entry doesn't open it and lose the form
  await clickAt(15 * 60);
  await quickForm(page).getByLabel("Title").fill("Kept");
  await yAt(page, s.tue, 9 * 60);
  await exam.click();
  await expect(page).toHaveURL(new RegExp(`/calendar/week/${s.mon}$`));
  await expect(quickForm(page).getByLabel("Title")).toHaveValue("Kept");
  await expect(quickForm(page).getByLabel("Title")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(draft(page)).toHaveCount(0);

  // leaving the page discards an unsaved draft
  await clickAt(17 * 60);
  await quickForm(page).getByLabel("Title").fill("Never stored");
  await page.goto("/settings/trash");
  await page.goBack();
  await expect(draft(page)).toHaveCount(0);

  // month view: a click on empty day space → 09:00–10:00 draft and the form
  await page.goto(`/calendar/month/${s.wed}`);
  const cell = page.getByRole("gridcell", { name: s.wedLabel });
  const box = (await cell.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 8);
  await expect(cell.locator("[data-draft]")).toHaveText("09:00 – 10:00 New entry");
  await expect(quickForm(page).getByLabel("Start time")).toHaveValue("09:00");
  await expect(quickForm(page).getByLabel("End time")).toHaveValue("10:00");
  await page.keyboard.press("Escape");
  await expect(cell.locator("[data-draft]")).toHaveCount(0);
});

test("US7: keyboard-only creation with announcements and focus return", async ({ page }, testInfo) => {
  const s = await setup(page, testInfo, "QCD");
  await page.goto(`/calendar/day/${s.tue}`);
  const slot = page.getByRole("button", { name: `New entry on ${s.tueLabel} at 09:45` });
  await slot.focus();
  await page.keyboard.press("ArrowDown"); // 15-minute steps
  const ten = page.getByRole("button", { name: `New entry on ${s.tueLabel} at 10:00` });
  await expect(ten).toBeFocused();
  for (let i = 0; i < 3; i++) await page.keyboard.press("Shift+ArrowDown");
  await expect(page.getByTestId("draft-announcer")).toHaveText("New entry, from 10:00 to 11:00");
  await expect(draft(page)).toHaveText("10:00 – 11:00");
  await page.keyboard.press("Shift+ArrowUp");
  await expect(page.getByTestId("draft-announcer")).toHaveText("New entry, from 10:00 to 10:45");
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Escape");
  await expect(draft(page)).toHaveCount(0);
  await expect(ten).toBeFocused();

  for (let i = 0; i < 3; i++) await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Enter");
  const form = quickForm(page);
  await expect(form.getByLabel("Title")).toBeFocused();
  await expect(form.getByLabel("Start time")).toHaveValue("10:00");
  await expect(form.getByLabel("End time")).toHaveValue("11:00");
  await page.keyboard.type(`Keyboard event ${s.t}`);
  await page.keyboard.press("Enter"); // submits
  await expect(form).toBeHidden();
  const entry = page.getByRole("button", { name: `Event: Keyboard event ${s.t}, ${s.tueLabel}, 10:00 to 11:00` });
  await expect(entry).toBeFocused();

  // Escape on the form returns focus to the slot; the old shortcuts still work in the grid
  const twelve = page.getByRole("button", { name: `New entry on ${s.tueLabel} at 12:00` });
  await twelve.focus();
  await page.keyboard.press("Enter");
  await expect(quickForm(page)).toBeVisible();
  await expect(quickForm(page).getByLabel("End time")).toHaveValue("13:00");
  await page.keyboard.press("Escape");
  await expect(quickForm(page)).toBeHidden();
  await expect(twelve).toBeFocused();
  await page.keyboard.press("PageDown");
  await expect(page.getByRole("button", { name: `New entry on ${s.tueLabel} at 13:00` })).toBeFocused();
  await page.keyboard.press("w");
  await expect(page).toHaveURL(new RegExp(`/calendar/week/${s.tue}$`));
});

test.describe("touch", () => {
  test.use({ hasTouch: true });

  test("US7: a tap creates a one-hour draft", async ({ page }, testInfo) => {
    const s = await setup(page, testInfo, "QCE");
    await page.goto(`/calendar/week/${s.mon}`);
    const p = await yAt(page, s.tue, 18 * 60 + 20);
    await page.touchscreen.tap(p.x, p.y);
    await expect(quickForm(page)).toBeVisible();
    await expect(draft(page)).toHaveText("18:15 – 19:15");
    await quickForm(page).getByRole("button", { name: "Cancel" }).click();
    await expect(draft(page)).toHaveCount(0);
  });
});
