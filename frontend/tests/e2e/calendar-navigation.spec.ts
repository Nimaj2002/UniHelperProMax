import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { newHierarchy, seedClass, signIn, tag } from "./helpers";

async function seed(page: Page, t: string) {
  await seedClass(page, {
    course: newHierarchy(`NAV${t} 101`), title: "Lecture", startDate: "2026-09-28", startTime: "10:00", endTime: "11:30",
    location: "FENS G032", color: "blue", links: [{ label: "Course site", url: "https://cs201.example.edu" }],
    recurrence: { freq: "weekly", byWeekday: ["MO", "WE"], end: { kind: "semester_end" } },
  });
  await seedClass(page, {
    course: newHierarchy(`NAV${t} 202`), startDate: "2026-09-28", startTime: "10:30", endTime: "12:00", color: "green",
    recurrence: { freq: "weekly", byWeekday: ["MO"], end: { kind: "semester_end" } },
  });
}

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
}

test("US2: keyboard-only calendar navigation", async ({ page }, testInfo) => {
  const t = tag(testInfo.project.name);
  await signIn(page);
  await seed(page, t);
  await page.goto("/calendar/week/2026-10-05");
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toHaveAccessibleName("5 – 11 October 2026");
  await axe(page);

  await page.keyboard.press("d");
  await expect(page).toHaveURL(/\/calendar\/day\/2026-10-05$/);
  await expect(heading).toHaveAccessibleName("Monday, 5 October 2026");
  await axe(page);

  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/\/calendar\/day\/2026-10-06$/);
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("m");
  await expect(heading).toHaveAccessibleName("October 2026");
  await axe(page);
  await page.keyboard.press("j");
  await expect(heading).toHaveAccessibleName("November 2026");
  await page.keyboard.press("w");
  await page.keyboard.press("t");
  await expect(page).toHaveURL(/\/calendar\/week\/\d{4}-\d{2}-\d{2}$/);

  // overlapping sessions are both visible side by side
  await page.goto("/calendar/week/2026-10-05");
  const cs = page.getByRole("button", { name: new RegExp(`^NAV${t} 101 Lecture, Monday 5 October`) });
  const math = page.getByRole("button", { name: new RegExp(`^NAV${t} 202, Monday 5 October`) });
  await expect(cs).toBeVisible();
  await expect(math).toBeVisible();
  const [a, b] = [await cs.boundingBox(), await math.boundingBox()];
  expect(a!.x + a!.width).toBeLessThanOrEqual(b!.x + 1);

  // Enter on an event opens details; Esc returns focus to it
  await cs.focus();
  await page.keyboard.press("Enter");
  const details = page.getByRole("dialog", { name: `NAV${t} 101 · Lecture` });
  await expect(details).toBeVisible();
  await expect(details.getByRole("link", { name: /Course site/ })).toHaveAttribute("target", "_blank");
  await axe(page);
  await page.keyboard.press("Escape");
  await expect(details).toBeHidden();
  await expect(cs).toBeFocused();

  // roving focus across slots, Enter opens a pre-filled class form
  const slot = page.getByRole("button", { name: "New class on Monday 5 October at 09:00" });
  await slot.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("button", { name: "New class on Monday 5 October at 09:30" })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("button", { name: "New class on Tuesday 6 October at 09:30" })).toBeFocused();
  await page.keyboard.press("Enter");
  const form = page.getByRole("dialog", { name: "New class" });
  await expect(form.getByLabel("First session")).toHaveValue("2026-10-06");
  await expect(form.getByLabel("Start time")).toHaveValue("09:30");
  await expect(form.getByLabel("End time")).toHaveValue("10:30");
  await page.keyboard.press("Escape");
  await expect(form).toBeHidden();

  // shortcut help
  await page.locator("body").press("?");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
});
