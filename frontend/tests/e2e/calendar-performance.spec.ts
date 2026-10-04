import { expect, test } from "@playwright/test";
import { newHierarchy, seedClass, signIn, tag } from "./helpers";

// SC-003: view switches and period steps render in < 1 s with a full semester (6 courses × 3/week).
test("US2: calendar switches views and periods in under a second", async ({ page }, testInfo) => {
  const t = tag(testInfo.project.name);
  await signIn(page);
  const days = [["MO", "WE", "FR"], ["TU", "TH", "FR"], ["MO", "TU", "TH"], ["WE", "TH", "FR"], ["MO", "WE", "TH"], ["TU", "WE", "FR"]];
  for (let i = 0; i < 6; i++) {
    await seedClass(page, {
      course: newHierarchy(`PERF${t} ${i + 1}`, "Spring 2027", "2027", "2027-06-01"), startDate: "2027-02-15", startTime: `${String(8 + i).padStart(2, "0")}:00`,
      endTime: `${String(8 + i).padStart(2, "0")}:50`, color: "blue",
      recurrence: { freq: "weekly", byWeekday: days[i], end: { kind: "semester_end" } },
    });
  }
  const events = page.locator("[data-session-key]").filter({ hasText: `PERF${t}` });

  async function timed(action: () => Promise<void>, expectedCount: number, label: string) {
    const t0 = Date.now();
    await action();
    await expect(events).toHaveCount(expectedCount);
    const ms = Date.now() - t0;
    expect(ms, `${label} took ${ms} ms`).toBeLessThan(1000);
  }

  await page.goto("/calendar/week/2027-03-01");
  await expect(events).toHaveCount(18);
  for (const pass of ["cold", "warm"]) {
    await timed(() => page.keyboard.press("j"), 18, `${pass} next week`);
    await timed(() => page.keyboard.press("k"), 18, `${pass} previous week`);
    await timed(() => page.keyboard.press("d"), 3, `${pass} day view`); // Monday 1 Mar: PERF 1, 3, 5
    await timed(() => page.keyboard.press("w"), 18, `${pass} week view`);
  }
  const t0 = Date.now();
  await page.keyboard.press("m");
  await expect(page.getByRole("heading", { level: 1 })).toHaveAccessibleName("March 2027");
  await expect(page.getByRole("gridcell").first()).toBeVisible();
  expect(Date.now() - t0).toBeLessThan(1000);
});
