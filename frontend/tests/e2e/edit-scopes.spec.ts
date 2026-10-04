import { expect, test, type Page } from "@playwright/test";
import { newHierarchy, seedClass, signIn, tag } from "./helpers";

async function openSession(page: Page, name: RegExp) {
  const ev = page.getByRole("button", { name });
  await ev.focus();
  await page.keyboard.press("Enter");
}

async function chooseScope(page: Page, label: string) {
  const dialog = page.getByRole("dialog", { name: /recurring class/ });
  await dialog.getByRole("radio", { name: label }).check();
  await dialog.getByRole("button", { name: "Continue" }).click();
}

test("US4: edit scopes (this, following, all) and cancelling one session", async ({ page }, testInfo) => {
  const t = tag(testInfo.project.name);
  const course = `SCOPE${t} 101`;
  await signIn(page);
  await seedClass(page, {
    course: newHierarchy(course, `Scope ${t}`, `Scopes ${t}`, "2026-12-31"), startDate: "2026-09-28",
    startTime: "10:00", endTime: "11:30", location: "FENS G032", color: "blue",
    recurrence: { freq: "weekly", byWeekday: ["MO", "WE"], end: { kind: "semester_end" } },
  });
  const events = () => page.locator("[data-session-key]").filter({ hasText: course });

  // 8a: one Wednesday → Room B ("This session")
  await page.goto("/calendar/week/2026-09-28");
  await openSession(page, new RegExp(`^${course}, Wednesday 30 September`));
  await page.getByRole("dialog").getByRole("button", { name: "Edit" }).click();
  await chooseScope(page, "This session");
  const form = page.getByRole("dialog", { name: /Edit Wednesday 30 September/ });
  await expect(form.getByLabel("Title (optional)")).toHaveCount(0); // only time + location
  await form.getByLabel("Location (optional)").fill("Room B");
  await form.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("This session was updated.")).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(`^${course}, Wednesday 30 September, 10:00 to 11:30, Room B`) })).toBeVisible();

  // 8b: from 12 Oct, 11:00–12:30 ("This and following")
  await page.goto("/calendar/week/2026-10-12");
  await openSession(page, new RegExp(`^${course}, Monday 12 October`));
  await page.getByRole("dialog").getByRole("button", { name: "Edit" }).click();
  await chooseScope(page, "This and following sessions");
  const f2 = page.getByRole("dialog", { name: "Edit this and following sessions" });
  await f2.getByLabel("Start time").fill("11:00");
  await f2.getByLabel("End time").fill("12:30");
  await f2.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("This and following sessions were updated.")).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(`^${course}, Monday 12 October, 11:00 to 12:30`) })).toBeVisible();
  await page.goto("/calendar/week/2026-10-05");
  await expect(page.getByRole("button", { name: new RegExp(`^${course}, Monday 5 October, 10:00 to 11:30`) })).toBeVisible();

  // 8c: colour green for all — the Room B change is kept and reported
  await openSession(page, new RegExp(`^${course}, Monday 5 October`));
  await page.getByRole("dialog").getByRole("button", { name: "Edit" }).click();
  await chooseScope(page, "All sessions");
  const f3 = page.getByRole("dialog", { name: "Edit class" });
  await f3.getByRole("radio", { name: "Green" }).check({ force: true });
  await f3.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("All sessions were updated. 1 individually changed session was kept.")).toBeVisible();
  await page.goto("/calendar/week/2026-09-28");
  await expect(page.getByRole("button", { name: new RegExp(`^${course}, Wednesday 30 September, 10:00 to 11:30, Room B`) })).toBeVisible();

  // 9: cancel one Monday
  await page.goto("/calendar/week/2026-10-19");
  await expect(events()).toHaveCount(2);
  await openSession(page, new RegExp(`^${course}, Monday 19 October`));
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await chooseScope(page, "This session");
  const confirm = page.getByRole("alertdialog", { name: "Cancel this session?" });
  await expect(confirm).toContainText("Notes and recordings are never deleted");
  await confirm.getByRole("button", { name: "Cancel session" }).click();
  await expect(events()).toHaveCount(1);
  await expect(page.getByRole("button", { name: new RegExp(`^${course}, Wednesday 21 October`) })).toBeVisible();
});
