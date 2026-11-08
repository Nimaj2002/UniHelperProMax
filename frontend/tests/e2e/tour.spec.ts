import { expect, test, type Page } from "@playwright/test";
import { seedEndpoint } from "./chat-helpers";
import { newHierarchy, seedClass, signIn, tag } from "./helpers";
import { textPdf } from "./pdf-fixtures";

/** 023: Yuii's tour. Other specs never see it (no auto-start under automation, TourHost). */
test.beforeEach(({ page }) => page.addInitScript(() => localStorage.setItem("uh.tour.e2e", "1")));

async function setTour(page: Page, status: string) {
  const csrf = (await page.context().cookies()).find((c) => c.name === "uh_csrf")?.value ?? "";
  const r = await page.request.patch("/api/v1/preferences", { data: { tour: { status, chapter: null } }, headers: { "X-CSRF-Token": csrf } });
  expect(r.status(), await r.text()).toBe(200);
}

const bubble = (page: Page, name: string | RegExp) => page.getByRole("dialog", { name, exact: true });

test("first run: welcome, overview, first course through the real form, end, no auto-start again", async ({ page }, testInfo) => {
  const t = tag(testInfo.project.name);
  const [year, semester, course] = [`Tour ${t}`, `Tour Fall ${t}`, `Tour 101 ${t}`];
  await signIn(page);
  await setTour(page, "not_seen"); // the owner is shared between specs and projects
  await page.goto("/");

  // the tour's code and art load on demand: allow for a cold dev server
  await expect(bubble(page, "Hi there, I'm Yuii!")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Start the tour" })).toBeFocused();
  await page.getByRole("button", { name: "Start the tour" }).click();

  const overview = ["Your side panel", "Home, sweet home", "Your calendar", "Your right panel", "Tasks", "General notes", "Study time", "Knowledge graph"];
  for (const title of overview) {
    await expect(bubble(page, title)).toBeVisible();
    // Yuii found and highlights what she talks about
    await expect(page.locator("[data-tour-layer] .ring-2")).toBeVisible();
    // the home right panel shows the tab Yuii talks about
    if (title === "General notes") await expect(page.locator("#home-switch-notes")).toHaveAttribute("data-state", "on");
    await page.keyboard.press("ArrowRight");
  }

  // hands-on: the highlighted New class button is clickable through the backdrop
  await expect(bubble(page, "Let's add your first class!")).toBeVisible();
  await page.locator('[data-tour="new-class"]:visible').first().click();
  const dialog = page.getByRole("dialog", { name: "New class" });
  await expect(dialog).toBeVisible();
  // Yuii is passive beside the form: her text is announced, she never blocks a click
  // the year is explained even if the form preselected one
  await expect(page.locator("[data-tour-layer] [aria-live]")).toContainText("A year holds your semesters");

  for (const [label, name] of [["Year", year], ["Semester", semester]] as const) {
    await dialog.getByRole("combobox", { name: label }).click();
    await page.keyboard.type(name);
    await page.getByRole("option", { name: `Create “${name}”` }).click();
  }
  // a brand-new semester: Yuii asks for its start and end dates
  // (Yuii pauses a few seconds on fields that were already filled when she got there)
  await expect(page.locator("[data-tour-layer] [aria-live]")).toContainText("When does the semester run?", { timeout: 15_000 });
  await dialog.getByLabel(/Semester starts/).fill("2026-09-21");
  await dialog.getByLabel(/Semester ends/).fill("2027-01-10");
  await expect(page.locator("[data-tour-layer] [aria-live]")).toContainText("And your course", { timeout: 15_000 });
  await dialog.getByRole("combobox", { name: "Course" }).click();
  await page.keyboard.type(course);
  await page.getByRole("option", { name: `Create “${course}”` }).click();
  await expect(page.locator("[data-tour-layer] [aria-live]")).toContainText("When is it?");
  await dialog.getByLabel("First session").fill("2026-09-28");
  await dialog.getByLabel("Start time").fill("10:00");
  await dialog.getByLabel("End time").fill("11:30");
  // a form error: the form shows it, Yuii gives a hint and stays on the step (FR-017)
  await dialog.getByRole("button", { name: "Save class" }).click();
  await expect(dialog.getByText("Choose at least one weekday.")).toBeVisible();
  await expect(page.locator("[data-tour-layer] [aria-live]")).toContainText("Oopsie");
  await dialog.getByRole("button", { name: "Monday" }).click();
  await dialog.getByRole("button", { name: "Save class" }).click();

  await expect(dialog).toBeHidden();
  await expect(bubble(page, "Yaaay, your first course!")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Courses" }).getByRole("link", { name: course })).toBeVisible();

  // end the tour (with confirmation); it never comes back by itself
  await page.getByRole("button", { name: "End tour" }).click();
  await page.getByRole("button", { name: "Yes, end the tour" }).click();
  await expect(page.locator("[data-tour-layer]")).toHaveCount(0);
  await page.reload();
  await expect(page.locator("#calendar-panel")).toBeVisible();
  await expect(page.locator("[data-tour-layer]")).toHaveCount(0);
  const prefs = await (await page.request.get("/api/v1/preferences")).json();
  expect(prefs.tour.status).toBe("skipped");
});

test("replay from the Yuii button: jump to Settings and finish", async ({ page }) => {
  await signIn(page);
  await setTour(page, "completed");
  await page.goto("/");
  await expect(page.locator("#calendar-panel")).toBeVisible();

  await page.getByRole("button", { name: "Tour with Yuii" }).first().click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  // Yuii shows the gear and lets the user open Settings
  await expect(bubble(page, "Settings")).toBeVisible();
  await page.locator('button[aria-label="Settings"]:visible').first().click();
  await expect(bubble(page, "AI providers")).toBeVisible();
  await expect(page).toHaveURL(/\/settings\/ai$/);
  for (let i = 0; i < 11; i++) await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(bubble(page, "That's the tour!")).toBeVisible();
  await page.getByRole("button", { name: "Finish" }).click();
  await expect(page.locator("[data-tour-layer]")).toHaveCount(0);
  const prefs = await (await page.request.get("/api/v1/preferences")).json();
  expect(prefs.tour.status).toBe("completed");
});

async function openSession(page: Page, name: string) {
  const made = await seedClass(page, {
    course: newHierarchy(name, `${name} sem`, `${name} year`), startDate: "2026-09-28", startTime: "06:00", endTime: "06:30", color: "pink",
    recurrence: { freq: "weekly", byWeekday: ["MO"], end: { kind: "semester_end" } },
  });
  await page.goto(`/courses/${made.courseId}`);
  await page.locator('a[href*="/sessions/"]').first().click();
  await expect(page).toHaveURL(/\/sessions\//);
}

async function jumpTo(page: Page, chapter: string) {
  await page.locator('[data-tour="tour-button"]:visible').first().click();
  await page.getByRole("menuitem", { name: chapter }).click();
}

test("skipping New class skips the whole form part, then any class can be opened", async ({ page }, testInfo) => {
  await signIn(page);
  await setTour(page, "completed");
  const t = tag(testInfo.project.name);
  await seedClass(page, {
    course: newHierarchy(`TourSkip ${t}`, `TourSkip sem ${t}`, `TourSkip year ${t}`), startDate: "2026-12-14", startTime: "08:00", endTime: "08:30",
    color: "pink", recurrence: { freq: "weekly", byWeekday: ["MO"], end: { kind: "semester_end" } },
  });
  await page.goto("/");
  await jumpTo(page, "Your first course");
  await expect(bubble(page, "Let's add your first class!")).toBeVisible();
  await page.getByRole("button", { name: "Skip this step" }).click();
  await expect(bubble(page, "Open a class session")).toBeVisible();
  await page.waitForTimeout(1000); // no bounce back to the New class step
  await expect(bubble(page, "Open a class session")).toBeVisible();
  // any class in the calendar can be picked (nothing is blocked on this step)
  await page.goto("/calendar/week/2026-12-14");
  // a reload offers to continue the interrupted tour
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(bubble(page, "Open a class session")).toBeVisible();
  await page.locator("[data-session-key]:visible").filter({ hasText: `TourSkip ${t}` }).first().click();
  await page.getByRole("button", { name: /Open notes/ }).click();
  await expect(bubble(page, "Make a note")).toBeVisible();
});

test("recording: record, stop, then transcribe", async ({ page }, testInfo) => {
  await signIn(page);
  await setTour(page, "completed");
  await openSession(page, `TourRec ${tag(testInfo.project.name)}`);
  await jumpTo(page, "PDFs & recording");
  await expect(bubble(page, "Got lecture slides?")).toBeVisible();
  await expect(page.locator('[data-tour="upload-document"]')).toBeVisible(); // documents section opened for Yuii
  await page.getByRole("button", { name: "Skip this step" }).click();
  await expect(bubble(page, "The right panel")).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(bubble(page, "Record the lecture")).toBeVisible();
  await page.locator('[data-tour="record"]:visible').click();
  await expect(bubble(page, "Now stop it")).toBeVisible();
  await page.waitForTimeout(1500);
  await page.locator('[data-tour="record-stop"]:visible').click();
  await expect(bubble(page, "Turn it into text")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('button[aria-label^="Transcribe "]').first()).toBeVisible();
});

test("AI teacher: open it, start a lesson, see its columns", async ({ page }, testInfo) => {
  await signIn(page);
  await setTour(page, "completed");
  await seedEndpoint(page, { name: `Tour AI ${tag(testInfo.project.name)}`, style: "openai", models: { "gpt-test": "GPT Test" } });
  await openSession(page, `TourAI ${tag(testInfo.project.name)}`);
  await jumpTo(page, "AI chat & AI teacher");
  await expect(bubble(page, "AI chat")).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(bubble(page, "Want to try?")).toBeVisible();
  await page.getByRole("button", { name: "Skip this step" }).click();
  await expect(bubble(page, "Meet your AI teacher")).toBeVisible();
  await page.locator("#session-switch-teacher").click();
  await expect(bubble(page, "Start a lesson")).toBeVisible();
  await page.getByRole("button", { name: "New teacher chat" }).click();
  await page.getByRole("menuitem", { name: "New lesson" }).click();
  await expect(bubble(page, "The lesson")).toBeVisible();
});

test("a closed panel: Yuii first shows how to open it, then its sections", async ({ page }, testInfo) => {
  await signIn(page);
  await setTour(page, "completed");
  await openSession(page, `TourPanel ${tag(testInfo.project.name)}`);
  await page.locator("#show-session-panel, #workspace-session-panel").first().waitFor();
  if (await page.locator("#workspace-session-panel").isVisible()) {
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Alt+BracketRight"); // close the right panel
  }
  await expect(page.locator("#show-session-panel")).toBeVisible();
  await jumpTo(page, "PDFs & recording");
  await page.getByRole("button", { name: "Skip this step" }).click(); // upload
  await expect(bubble(page, "Open the right panel")).toBeVisible();
  await page.locator("#show-session-panel").click();
  await expect(bubble(page, "The right panel")).toBeVisible();
});

test("PDF upload: Yuii notices the uploaded file and moves on", async ({ page }, testInfo) => {
  await signIn(page);
  await setTour(page, "completed");
  await openSession(page, `TourPdf ${tag(testInfo.project.name)}`);
  await jumpTo(page, "PDFs & recording");
  await expect(bubble(page, "Got lecture slides?")).toBeVisible();
  await page.getByTestId("upload-pdf-input").setInputFiles({ name: "slides.pdf", mimeType: "application/pdf", buffer: textPdf(2) });
  await expect(page.locator("[data-tour-layer]")).toContainText("Got it!", { timeout: 20_000 });
  await expect(bubble(page, "The right panel")).toBeVisible({ timeout: 10_000 });
});

test("home page with the side panel closed: Yuii first shows how to open it", async ({ page }) => {
  await signIn(page);
  await setTour(page, "completed");
  await page.goto("/");
  await expect(page.locator("#calendar-panel")).toBeVisible();
  if (await page.getByRole("button", { name: "Hide side panel" }).isVisible()) await page.getByRole("button", { name: "Hide side panel" }).click();
  await jumpTo(page, "Hello & overview");
  await page.getByRole("button", { name: "Let's go!" }).click();
  await expect(bubble(page, "Open the side panel")).toBeVisible();
  await page.locator('#show-side-panel:visible, button[aria-label="Show side panel"]:visible').first().click();
  await expect(bubble(page, "Your side panel")).toBeVisible();
});
