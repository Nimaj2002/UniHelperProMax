import { expect, test } from "@playwright/test";
import { newHierarchy, seedClass, signIn, tag } from "./helpers";

test("drag a class session to another day opens the scope dialog and moves it", async ({ page }, testInfo) => {
  const t = tag(testInfo.project.name);
  const course = `DRAG${t} 101`;
  await signIn(page);
  await seedClass(page, {
    course: newHierarchy(course, `Drag ${t}`, `Drags ${t}`, "2026-12-31"), startDate: "2026-09-28",
    startTime: "10:00", endTime: "11:30", color: "blue",
    recurrence: { freq: "weekly", byWeekday: ["MO", "WE"], end: { kind: "semester_end" } },
  });
  await page.goto("/calendar/week/2026-09-28");
  const monday = page.getByRole("button", { name: new RegExp(`^${course}, Monday 28 September`) });
  // grab near the top, move over Friday: the entry is previewed there, snapped to 15 minutes
  const from = (await monday.boundingBox())!;
  const friday = (await page.locator('[data-day="2026-10-02"]').boundingBox())!;
  await page.mouse.move(from.x + 10, from.y + 2);
  await page.mouse.down();
  await page.mouse.move(friday.x + 20, friday.y + 11 * 48 + 30, { steps: 5 }); // 11:37 → 11:30
  const ghost = page.locator('[data-day="2026-10-02"] [data-drop-preview]');
  await expect(ghost).toContainText("11:30 – 13:00");
  await expect(page.locator("[data-drop-grid]").first()).toBeAttached();
  await page.mouse.move(friday.x + 20, friday.y + 12 * 48 + 2, { steps: 5 });
  await expect(ghost).toContainText("12:00 – 13:30");
  await page.mouse.up();
  await expect(page.locator("[data-drop-preview]")).toHaveCount(0);
  const scope = page.getByRole("dialog", { name: "Edit recurring class" });
  await scope.getByRole("radio", { name: "This session" }).check();
  await scope.getByRole("button", { name: "Continue" }).click();
  const form = page.getByRole("dialog", { name: /Edit Monday 28 September/ });
  await expect(form.getByLabel("Date")).toHaveValue("2026-10-02");
  await expect(form.getByLabel("Start time")).toHaveValue("12:00");
  await form.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("This session was updated.")).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(`^${course}, Friday 2 October, 12:00 to 13:30`) })).toBeVisible();
});
