import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { newHierarchy, seedClass, signIn, tag } from "./helpers";
import { uploadPdf } from "./documents-helpers";
import { editor, newNote, waitSaved } from "./notes-helpers";
import { textPdf } from "./pdf-fixtures";

const DATA = path.resolve(import.meta.dirname, "../../../data-e2e/files/owner");

/** A class in its own year/semester (Mon+Thu 14:00–15:00), so semester names are unique per project. */
async function seedSemester(page: Page, t: string, prefix: string) {
  const course = `${prefix}${t} 101`;
  const semester = `Fall ${prefix}${t}`;
  const year = `Year ${prefix}${t}`;
  const cls = await seedClass(page, {
    course: newHierarchy(course, semester, year, "2027-01-10"),
    title: "Lecture", startDate: "2026-09-28", startTime: "14:00", endTime: "15:00", location: "Room 1", color: "teal",
    recurrence: { freq: "weekly", byWeekday: ["MO", "TH"], end: { kind: "semester_end" } },
  });
  const course_ = await (await page.request.get(`/api/v1/courses/${cls.courseId}`)).json();
  return { course, semester, year, courseId: cls.courseId as string, semesterId: course_.semesterId as string };
}

async function seedEvent(page: Page, body: Record<string, unknown>) {
  const csrf = (await page.context().cookies()).find((c) => c.name === "uh_csrf")?.value ?? "";
  const r = await page.request.post("/api/v1/events", { data: body, headers: { "X-CSRF-Token": csrf } });
  expect(r.status(), await r.text()).toBe(201);
  return r.json();
}

test("US1: New event with a course open preselects its semester; weekly event every Thursday", async ({ page }, testInfo) => {
  const t = tag(testInfo.project.name);
  await signIn(page);
  const s = await seedSemester(page, t, "EVA");

  // a course is open → its year and semester are preselected (FR-004)
  await page.goto(`/courses/${s.courseId}`);
  await page.getByRole("button", { name: "New event" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New event" });
  await expect(dialog.getByRole("combobox", { name: "Year" })).toContainText(s.year);
  await expect(dialog.getByRole("combobox", { name: "Semester" })).toContainText(s.semester);
  await expect(dialog.getByRole("radio", { name: "Blue" })).toBeChecked(); // FR-006
  const scan = await new AxeBuilder({ page }).include("[role=dialog]").withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(scan.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);

  // required fields are shown next to the field
  await dialog.getByRole("button", { name: "Save event" }).click();
  await expect(dialog.getByText("Enter a title.")).toBeVisible();

  await dialog.getByLabel("Title").fill(`Office hour ${t}`);
  await dialog.getByLabel("Date").fill("2026-10-01");
  await dialog.getByLabel("Start time").fill("14:00");
  await dialog.getByLabel("End time").fill("14:30");
  await dialog.getByLabel("Location (optional)").fill("FENS 2019");
  await dialog.getByRole("radio", { name: "Weekly" }).click();
  await dialog.getByRole("button", { name: "Thursday" }).click();
  await dialog.getByRole("button", { name: "Save event" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Event created")).toBeVisible();

  // every Thursday in day, week and month views, with the Event marker; next to the class
  await page.goto("/calendar/week/2026-10-15");
  const events = page.locator("[data-kind=event]").filter({ hasText: `Office hour ${t}` });
  await expect(events).toHaveCount(1);
  await expect(events.first()).toHaveAccessibleName(new RegExp(`^Event: Office hour ${t}, Thursday 15 October, 14:00 to 14:30, FENS 2019`));
  await expect(events.first().getByTestId("event-marker")).toBeVisible();
  await page.goto("/calendar/month/2026-10-15");
  // both projects share one backend: a crowded day may hold the event behind "+N more"
  const cell = page.getByRole("gridcell", { name: "Thursday 15 October" });
  await expect(cell.locator("[data-session-key]").first()).toBeVisible();
  const chip = cell.locator("[data-kind=event]").filter({ hasText: `Office hour ${t}` });
  if ((await chip.count()) === 0) {
    await cell.getByRole("button", { name: /^Show \d+ more/ }).click();
    const more = page.getByRole("dialog", { name: "Thursday 15 October" });
    await expect(more.locator("[data-kind=event]").filter({ hasText: `Office hour ${t}` })).toHaveCount(1);
    await page.keyboard.press("Escape");
  }
  await page.goto("/calendar/day/2026-12-31");
  await expect(page.locator("[data-kind=event]").filter({ hasText: `Office hour ${t}` })).toHaveCount(1);

  // never on the course timeline (FR-009)
  await page.goto(`/courses/${s.courseId}`);
  await expect(page.getByRole("heading", { level: 1, name: s.course })).toBeVisible();
  await expect(page.getByText(`Office hour ${t}`)).toHaveCount(0);

  // no course open → the last used semester (FR-004)
  await page.goto("/calendar/week/2026-10-15");
  await expect(page.locator("[data-kind=event]").first()).toBeVisible(); // calendar ready
  await page.keyboard.press("e");
  const again = page.getByRole("dialog", { name: "New event" });
  await expect(again.getByRole("combobox", { name: "Semester" })).toContainText(s.semester);
  await again.getByRole("button", { name: "Cancel" }).click();
});

test("US1: overlapping class and two events are all visible and clickable; full title on focus", async ({ page }, testInfo) => {
  const t = tag(testInfo.project.name);
  await signIn(page);
  const s = await seedSemester(page, t, "EVB");
  const long = `A long seminar title that will not fit ${t}`;
  for (const [title, start, end] of [[long, "14:00", "15:30"], [`Exam ${t}`, "14:30", "16:00"]])
    await seedEvent(page, { title, semester: { id: s.semesterId }, startDate: "2026-10-15", startTime: start, endTime: end, recurrence: { freq: "none" } });

  await page.goto("/calendar/day/2026-10-15");
  const blocks = page.locator("[data-session-key]").filter({ hasText: new RegExp(`${s.course}|${t}$|fit ${t}`) });
  await expect(blocks).toHaveCount(3);
  const boxes = await Promise.all((await blocks.all()).map((b) => b.boundingBox()));
  const lefts = new Set(boxes.map((b) => Math.round(b!.x)));
  expect(lefts.size).toBe(3); // side by side, none hidden

  const seminar = page.getByRole("button", { name: new RegExp(`^Event: ${long}`) });
  await seminar.focus();
  await expect(page.getByRole("tooltip")).toContainText(long);
  await page.getByRole("button", { name: new RegExp(`^Event: Exam ${t}`) }).click();
  await expect(page.getByRole("dialog", { name: `Event: Exam ${t}` })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: new RegExp(`^${s.course} Lecture, Thursday 15 October`) }).click();
  await expect(page.getByRole("dialog", { name: `${s.course} · Lecture` })).toBeVisible();
});

test("US2: event workspace, files under _Events, Events page and side card; _Events course refused", async ({ page }, testInfo) => {
  const t = tag(testInfo.project.name);
  await signIn(page);
  const s = await seedSemester(page, t, "EVC");
  const title = `AI Seminar ${t}`;
  const ev = await seedEvent(page, {
    title, semester: { id: s.semesterId }, startDate: "2026-09-24", startTime: "09:00", endTime: "10:00",
    location: "FENS L045", recurrence: { freq: "none" },
  });
  await seedEvent(page, { title: `Later ${t}`, semester: { id: s.semesterId }, startDate: "2027-01-07", startTime: "09:00", endTime: "10:00" });

  // the semester's Events entry in the left card → Events page (past normal, upcoming muted)
  const nav = page.getByRole("navigation", { name: "Courses" });
  await page.goto("/calendar");
  const eventsLink = nav.locator(`[data-events-of="${s.semesterId}"]`);
  await expect(eventsLink).toHaveAccessibleName("Events, 2 events");
  await eventsLink.click();
  await expect(page).toHaveURL(new RegExp(`/semesters/${s.semesterId}/events$`));
  await expect(page.getByRole("heading", { level: 1, name: "Events" })).toBeVisible();
  const later = page.getByRole("link", { name: new RegExp(`Later ${t}`) });
  await expect(later).toContainText("Upcoming");
  const seminar = page.getByRole("link", { name: new RegExp(title) });
  await expect(seminar).not.toContainText("Upcoming");
  const pageScan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(pageScan.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);

  // the same workspace as a session: note autosaves, record 3 s, upload a PDF
  await seminar.click();
  await expect(page).toHaveURL(new RegExp(encodeURIComponent(`${ev.lineageId}:2026-09-24`)));
  await expect(page.getByRole("button", { name: /^Event details: Thursday 24 September 2026/ })).toBeVisible();
  await newNote(page, "Talk notes");
  await editor(page).pressSequentially("# Seminar\n");
  await waitSaved(page, "Talk notes");
  const audio = page.getByRole("complementary", { name: "Audio" });
  await audio.getByRole("button", { name: "Record", exact: true }).click();
  await page.waitForTimeout(3000);
  await page.getByRole("region", { name: "Recording", exact: true }).getByRole("button", { name: "Stop" }).click();
  await expect(page.getByRole("button", { name: /^Recording \d{2}:\d{2}/ }).first()).toBeVisible({ timeout: 15000 });
  await uploadPdf(page, "slides.pdf", textPdf());

  // side card: "Events · <semester>" lists the semester's events
  const side = page.getByRole("region", { name: `Events · ${s.semester}` });
  await expect(side.getByRole("navigation", { name: "Events of this semester" }).getByRole("link")).toHaveCount(2);

  // the files sit under <year>/<semester>/_Events/<date title>/{notes,audios,documents} (FR-013)
  const folder = path.join(DATA, s.year, s.semester, "_Events", `2026-09-24 ${title}`);
  expect(readFileSync(path.join(folder, "notes", "Talk notes.md"), "utf8")).toContain("# Seminar");
  expect(readdirSync(path.join(folder, "audios")).length).toBeGreaterThan(0);
  expect(readdirSync(path.join(folder, "documents"))).toContain("slides.pdf");
  const timeline = await (await page.request.get(`/api/v1/semesters/${s.semesterId}/events/timeline`)).json();
  expect(timeline[0]).toMatchObject({ title, noteCount: 1, audioCount: 1, documentCount: 1 });

  // a course can't take the reserved folder name
  await page.goto(`/courses/${s.courseId}`);
  await nav.getByRole("button", { name: `Actions for ${s.course}` }).click();
  await page.getByRole("menuitem", { name: /^Rename/ }).click();
  const rename = page.getByRole("dialog", { name: "Rename course" });
  await rename.getByLabel("Name").fill("_Events");
  await rename.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(rename.getByText("“_Events” is reserved for events.")).toBeVisible();
});

async function api(page: Page, method: "post" | "delete", url: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === "uh_csrf")?.value ?? "";
  const r = await page.request[method](url, { data, headers: { "X-CSRF-Token": csrf } });
  expect(r.ok(), await r.text()).toBe(true);
  return r;
}

test("US3: edit this event / all events, locked semester, delete names content and moves to the Trash", async ({ page }, testInfo) => {
  const t = tag(testInfo.project.name);
  await signIn(page);
  const s = await seedSemester(page, t, "EVD");
  const title = `Reading group ${t}`;
  const ev = await seedEvent(page, {
    title, semester: { id: s.semesterId }, startDate: "2026-10-01", startTime: "17:00", endTime: "18:00",
    recurrence: { freq: "weekly", byWeekday: ["TH"], end: { kind: "count", count: 4 } },
  });
  await api(page, "post", `/api/v1/sessions/${ev.lineageId}:2026-10-08/notes`, { name: "Minutes", content: "kept" });

  // "This event": every field, here title and location (FR-016)
  await page.goto("/calendar/week/2026-10-15");
  await page.getByRole("button", { name: new RegExp(`^Event: ${title}, Thursday 15 October`) }).click();
  await page.getByRole("dialog", { name: `Event: ${title}` }).getByRole("button", { name: "Edit" }).click();
  const scope = page.getByRole("dialog", { name: "Edit recurring event" });
  await scope.getByRole("radio", { name: "This event" }).check();
  await scope.getByRole("button", { name: "Continue" }).click();
  const one = page.getByRole("dialog", { name: "Edit Thursday 15 October" });
  await expect(one.getByText("Repeat", { exact: true })).toHaveCount(0); // repetition: series only
  await one.getByLabel("Title").fill(`Moved group ${t}`);
  await one.getByLabel("Location (optional)").fill("Room 9");
  await one.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(`^Event: Moved group ${t}, Thursday 15 October, 17:00 to 18:00, Room 9`) })).toBeVisible();

  // "All events": the semester is locked (a note exists) and the result names what stayed
  await page.goto("/calendar/week/2026-10-22");
  await page.getByRole("button", { name: new RegExp(`^Event: ${title}, Thursday 22 October`) }).click();
  await page.getByRole("dialog", { name: `Event: ${title}` }).getByRole("button", { name: "Edit" }).click();
  await scope.getByRole("radio", { name: "All events" }).check();
  await scope.getByRole("button", { name: "Continue" }).click();
  const all = page.getByRole("dialog", { name: "Edit event" });
  await expect(all.getByText("The semester can't be changed because this event has notes, recordings or documents.")).toBeVisible();
  await expect(all.getByRole("combobox", { name: "Semester" })).toBeDisabled();
  await all.getByLabel("Title").fill(`Book club ${t}`);
  await all.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved. 2 events with notes, recordings or documents, or edited individually, were left unchanged.")).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(`^Event: Book club ${t}, Thursday 22 October`) })).toBeVisible();
  await page.goto("/calendar/week/2026-10-08");
  const withNote = page.getByRole("button", { name: new RegExp(`^Event: ${title}, Thursday 8 October`) });
  await expect(withNote).toBeVisible(); // has a note: left unchanged (FR-020)

  // delete the one with a note: the dialog names it and the Trash; nothing goes before "Move to Trash"
  await withNote.click();
  await page.getByRole("dialog", { name: `Event: ${title}` }).getByRole("button", { name: "Delete" }).click();
  const delScope = page.getByRole("dialog", { name: "Delete recurring event" });
  await delScope.getByRole("radio", { name: "This event" }).check();
  await delScope.getByRole("button", { name: "Continue" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Delete this event?" });
  await expect(confirm).toContainText("This will move 1 event with 1 note to the Trash. You can restore it from Settings → Trash.");
  await confirm.getByRole("button", { name: "Move to Trash" }).click();
  await expect(page.getByText(/^Moved to the Trash/)).toBeVisible();
  await expect(page.locator("[data-kind=event]").filter({ hasText: title })).toHaveCount(0);
  const folder = path.join(DATA, s.year, s.semester, "_Events", `2026-10-08 ${title}`);
  expect(readFileSync(path.join(folder, "notes", "Minutes.md"), "utf8")).toBe("kept"); // files stay
});
