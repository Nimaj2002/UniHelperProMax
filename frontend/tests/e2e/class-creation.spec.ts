import { expect, test } from "@playwright/test";
import { calendarAction, signIn, tag } from "./helpers";

test("US1: create a recurring class with inline year/semester/course and see it in week view", async ({ page }, testInfo) => {
  const t = tag(testInfo.project.name);
  const [year, semester, course] = [`2026 ${t}`, `Fall 2026 ${t}`, `CS 201 ${t}`];
  await signIn(page);
  await page.goto("/calendar/week/2026-10-05");
  await calendarAction(page, "New class");
  const dialog = page.getByRole("dialog", { name: "New class" });

  for (const [label, name] of [["Year", year], ["Semester", semester]] as const) {
    await dialog.getByRole("combobox", { name: label }).click();
    await page.keyboard.type(name);
    await page.getByRole("option", { name: `Create “${name}”` }).click();
  }
  await dialog.getByLabel(/Semester ends/).fill("2027-01-10");
  await dialog.getByRole("combobox", { name: "Course" }).click();
  await page.keyboard.type(course);
  await page.getByRole("option", { name: `Create “${course}”` }).click();

  await dialog.getByLabel("Title (optional)").fill("Lecture");
  await dialog.getByLabel("First session").fill("2026-09-28");
  await dialog.getByLabel("Start time").fill("10:00");
  await dialog.getByLabel("End time").fill("11:30");
  await dialog.getByLabel("Location (optional)").fill("FENS G032");
  await dialog.getByRole("button", { name: "Monday" }).click();
  await dialog.getByRole("button", { name: "Wednesday" }).click();
  await dialog.getByRole("radio", { name: "Blue" }).check({ force: true });
  await dialog.getByRole("button", { name: "Save class" }).click();

  await expect(dialog).toBeHidden();
  await page.goto("/calendar/week/2026-10-05");
  const events = page.locator("[data-session-key]").filter({ hasText: course });
  await expect(events).toHaveCount(2);
  await expect(events.first()).toHaveAccessibleName(
    new RegExp(`${course} Lecture, Monday 5 October, 10:00 to 11:30, FENS G032`),
  );
  await expect(page.getByRole("navigation", { name: "Courses" }).getByRole("link", { name: course })).toBeVisible();

  await page.goto("/calendar/week/2027-01-11"); // week after the semester end
  await expect(page.locator("[data-session-key]").filter({ hasText: course })).toHaveCount(0);
});
