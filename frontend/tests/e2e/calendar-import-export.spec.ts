import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { newHierarchy, seedClass, signIn, tag } from "./helpers";

/** A Google-style calendar with a weekly class, a one-time event and an all-day day. Late
 * evening in Nov–Dec 2027 so other specs' weeks gain no overlaps; titles are unique per run. */
function googleIcs(p: string, hour = "21"): Buffer {
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Google Inc//Google Calendar 70.9054//EN", "X-WR-TIMEZONE:Europe/Istanbul",
    "BEGIN:VEVENT", `UID:alg-${p}@google.com`, `DTSTART;TZID=Europe/Istanbul:20271101T${hour}0000`,
    `DTEND;TZID=Europe/Istanbul:20271101T${hour}4500`, "RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=6",
    `SUMMARY:Algebra ${p}`, "LOCATION:FENS G032", "X-GOOGLE-CONFERENCE:https://meet.google.com/abc-defg-hij", "END:VEVENT",
    "BEGIN:VEVENT", `UID:dentist-${p}@google.com`, "DTSTART:20271104T180000Z", "DTEND:20271104T183000Z",
    `SUMMARY:Dentist ${p}`, "END:VEVENT",
    "BEGIN:VEVENT", `UID:holiday-${p}@google.com`, "DTSTART;VALUE=DATE:20271105", "DTEND;VALUE=DATE:20271106",
    `SUMMARY:Holiday ${p}`, "END:VEVENT",
    "END:VCALENDAR",
  ];
  return Buffer.from(lines.join("\r\n") + "\r\n");
}

async function openPage(page: Page) {
  await page.goto("/settings");
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: "Import and export" }).click();
  await expect(page).toHaveURL(/\/settings\/import-export$/);
  await expect(page.getByRole("heading", { name: "Import and export", level: 2 })).toBeVisible();
}

async function choose(page: Page, name: string, buffer: Buffer) {
  await page.getByTestId("ics-input").setInputFiles({ name, mimeType: "text/calendar", buffer });
  await expect(page.getByRole("heading", { name: `Preview of ${name}` })).toBeVisible();
}

async function newSemester(page: Page, year: string, semester: string) {
  await page.getByRole("radio", { name: "New semester" }).click();
  await page.getByLabel("New year name").fill(year);
  await page.getByLabel("Semester name").fill(semester);
}

/** Class blocks on the calendar grid (not the course's link in the side panel). */
function blocks(page: Page, title: string) {
  return page.locator("[data-kind=class]").filter({ hasText: title });
}

async function axe(page: Page, label: string) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
  const r = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(r.violations.map((v) => `${label}: ${v.id} → ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
}

test("US1: import a Google calendar into a new semester; preview defaults; result; on the calendar", async ({ page }, testInfo) => {
  const p = `IMP${tag(testInfo.project.name)}`;
  await signIn(page);
  await openPage(page);
  await choose(page, `google-${p}.ics`, googleIcs(p));

  const algebra = page.locator("li[data-group-id]").filter({ hasText: `Algebra ${p}` });
  const dentist = page.locator("li[data-group-id]").filter({ hasText: `Dentist ${p}` });
  await expect(algebra).toContainText("6 entries · Mon, Wed 21:00–21:45 · FENS G032");
  await expect(algebra.getByRole("checkbox", { name: `Import Algebra ${p}` })).toBeChecked();
  await expect(algebra.getByRole("radio", { name: "Class" })).toBeChecked();
  await expect(dentist.getByRole("checkbox", { name: `Import Dentist ${p}` })).not.toBeChecked();
  await expect(dentist.getByRole("radio", { name: "Event" })).toBeChecked();
  await expect(page.getByText(`Not imported (1)`)).toBeVisible();

  await newSemester(page, `Year ${p}`, `Term ${p}`);
  await axe(page, "import preview");
  await page.getByRole("button", { name: "Import 6 entries" }).click();

  await expect(page.getByRole("heading", { name: "Import finished" })).toBeFocused();
  await expect(page.getByTestId("import-announcer")).toHaveText(/Import finished: 6 classes and 0 events created, 0 updated, 1 skipped\./);
  await expect(page.getByText(`Holiday ${p} (2027-11-05): all-day events are not supported yet`)).toBeVisible();
  await expect(page.getByText(`New courses: Algebra ${p}`)).toBeVisible();
  await axe(page, "import result");

  await page.goto("/calendar/week/2027-11-01");
  await expect(blocks(page, `Algebra ${p}`)).toHaveCount(2);
});

test("US3: re-importing does not duplicate; undo removes what the import made", async ({ page }, testInfo) => {
  const p = `UND${tag(testInfo.project.name)}`;
  await signIn(page);
  await openPage(page);
  for (let i = 0; i < 2; i++) {
    await choose(page, `again-${p}.ics`, googleIcs(p, "22"));
    await newSemester(page, `Year ${p}`, `Term ${p}`);
    await page.getByRole("button", { name: "Import 6 entries" }).click();
    await expect(page.getByRole("heading", { name: "Import finished" })).toBeVisible();
    if (i === 1) await expect(page.getByText("6 entries were already up to date.")).toBeVisible();
    else await page.getByRole("button", { name: "Done" }).click();
  }
  await page.getByRole("button", { name: "Done" }).click();
  await page.goto("/calendar/week/2027-11-01");
  await expect(blocks(page, `Algebra ${p}`)).toHaveCount(2);

  await openPage(page);
  await choose(page, `undo-${p}.ics`, googleIcs(`${p}X`, "22"));
  await newSemester(page, `Year ${p}X`, `Term ${p}X`);
  await page.getByRole("button", { name: "Import 6 entries" }).click();
  await page.getByRole("button", { name: "Undo import" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Undo import" }).click();
  await expect(page.getByRole("heading", { name: "Import undone" })).toBeVisible();
  await page.goto("/calendar/week/2027-11-01");
  await expect(blocks(page, `Algebra ${p}X`)).toHaveCount(0);
});

test("US5: keyboard only — choose with Enter, cancel while reading, restart, change a type, confirm", async ({ page }, testInfo) => {
  const p = `KEY${tag(testInfo.project.name)}`;
  await signIn(page);
  await openPage(page);

  let held = true;
  let discarded = false;
  await page.route(/\/api\/v1\/calendar-imports\?/, async (route) => {
    if (held) await new Promise((r) => setTimeout(r, 4000));
    await route.continue().catch(() => undefined);
  });
  page.on("request", (r) => {
    if (r.method() === "DELETE" && r.url().includes("/calendar-imports/")) discarded = true;
  });

  const drop = page.getByRole("button", { name: "Choose .ics file" });
  await drop.focus();
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.keyboard.press("Enter")]);
  await chooser.setFiles({ name: `kb-${p}.ics`, mimeType: "text/calendar", buffer: googleIcs(p, "20") });
  const cancel = page.getByRole("button", { name: "Cancel" });
  await expect(cancel).toBeVisible();
  await cancel.focus();
  await page.keyboard.press("Enter");
  await expect(drop).toBeFocused();
  await expect(page.getByTestId("import-announcer")).toHaveText("Import cancelled");
  expect(discarded).toBe(false); // aborted before the server answered: nothing was staged

  held = false;
  const [again] = await Promise.all([page.waitForEvent("filechooser"), page.keyboard.press(" ")]);
  await again.setFiles({ name: `kb-${p}.ics`, mimeType: "text/calendar", buffer: googleIcs(p, "20") });
  await expect(page.getByRole("heading", { name: `Preview of kb-${p}.ics` })).toBeFocused();

  // Dentist: select with Space, switch to Class with an arrow key and Space
  const dentist = page.locator("li[data-group-id]").filter({ hasText: `Dentist ${p}` });
  await dentist.getByRole("checkbox").focus();
  await page.keyboard.press("Space");
  await dentist.getByRole("radio", { name: "Event" }).focus();
  await page.keyboard.press("ArrowLeft"); // roving focus to Class; Space selects it
  await expect(dentist.getByRole("radio", { name: "Class" })).toBeFocused();
  await page.keyboard.press("Space");
  await expect(dentist.getByRole("radio", { name: "Class" })).toBeChecked();

  await page.getByRole("radio", { name: "New semester" }).focus();
  await page.keyboard.press("Space");
  await page.getByLabel("New year name").focus();
  await page.keyboard.type(`Year ${p}`);
  await page.getByLabel("Semester name").focus();
  await page.keyboard.type(`Term ${p}`);
  await page.getByRole("button", { name: "Import 7 entries" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Import finished" })).toBeFocused();
  await expect(page.getByTestId("import-announcer")).toHaveText(/7 classes and 0 events created/);
});

test("US2: export a semester; empty semester says so and saves nothing", async ({ page }, testInfo) => {
  const p = `EXP${tag(testInfo.project.name)}`;
  await signIn(page);
  await seedClass(page, {
    course: newHierarchy(`Export ${p} 101`, `Term ${p}`, `Year ${p}`, "2027-01-10"), startDate: "2026-10-05", startTime: "07:00",
    endTime: "07:45", color: "teal", recurrence: { freq: "weekly", byWeekday: ["MO"], end: { kind: "count", count: 3 } },
  });
  await openPage(page);
  await page.getByLabel("What to export").click();
  await page.getByRole("option", { name: `Year ${p} · Term ${p}` }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export calendar (.ics)" }).click()]);
  expect(download.suggestedFilename()).toMatch(new RegExp(`^UniHelperProMax-Year-${p}-Term-${p}-\\d{4}-\\d{2}-\\d{2}\\.ics$`));
  const text = readFileSync((await download.path())!, "utf8");
  expect(text).toContain("RRULE:FREQ=WEEKLY");
  expect(text).toContain("X-UNIHELPER-KIND:class");
  await expect(page.getByText("Exported 1 class and 0 events")).toBeVisible();

  // a semester with nothing in it
  const csrf = (await page.context().cookies()).find((c) => c.name === "uh_csrf")?.value ?? "";
  const year = await (await page.request.post("/api/v1/years", { data: { name: `Empty ${p}` }, headers: { "X-CSRF-Token": csrf } })).json();
  await page.request.post("/api/v1/semesters", { data: { yearId: year.id, name: `Nothing ${p}` }, headers: { "X-CSRF-Token": csrf } });
  await page.reload();
  await page.getByLabel("What to export").click();
  await page.getByRole("option", { name: `Empty ${p} · Nothing ${p}` }).click();
  let downloaded = false;
  page.once("download", () => (downloaded = true));
  await page.getByRole("button", { name: "Export calendar (.ics)" }).click();
  await expect(page.getByRole("alert")).toHaveText(`There is nothing to export in Empty ${p} · Nothing ${p}.`);
  expect(downloaded).toBe(false);
  await axe(page, "import and export page");
});
