import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { newHierarchy, seedClass, signIn, tag } from "./helpers";

async function axe(page: Page, label: string) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(r.violations.map((v) => `${label}: ${v.id} → ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
}

/** Every interactive element reached by Tab shows a visible focus indicator. */
async function focusVisibleOnTab(page: Page, steps = 25) {
  for (let i = 0; i < steps; i++) {
    await page.keyboard.press("Tab");
    const ok = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return true;
      const s = getComputedStyle(el);
      const outline = s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0;
      const ring = s.boxShadow !== "none";
      return outline || ring;
    });
    expect(ok, `focus indicator missing at tab stop ${i + 1}`).toBe(true);
  }
}

test("Accessibility: WCAG 2.1 AA and visible focus across screens", async ({ page }, testInfo) => {
  const t = tag(testInfo.project.name);
  await page.goto("/login");
  await page.waitForURL(/\/(setup|login)/);
  await axe(page, page.url().includes("setup") ? "setup" : "login");
  await signIn(page);
  await seedClass(page, {
    course: newHierarchy(`A11Y${t} 101`, `A11y ${t}`, `A11y year ${t}`), startDate: "2026-09-28", startTime: "10:00",
    endTime: "11:30", location: "Room 1", color: "violet", links: [{ label: "Site", url: "https://example.edu" }],
    recurrence: { freq: "weekly", byWeekday: ["MO", "WE"], end: { kind: "semester_end" } },
  });

  for (const view of ["week", "day", "month"]) {
    await page.goto(`/calendar/${view}/2026-10-05`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await axe(page, `calendar ${view}`);
  }
  await page.goto("/calendar/week/2026-10-05");
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  await focusVisibleOnTab(page);

  await page.getByRole("button", { name: "New class", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "New class" })).toBeVisible();
  await axe(page, "class form");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: new RegExp(`^A11Y${t} 101, Monday 5 October`) }).click();
  await expect(page.getByRole("dialog", { name: `A11Y${t} 101` })).toBeVisible();
  await axe(page, "session details");
  await page.keyboard.press("Escape");

  await page.getByRole("searchbox", { name: "Search courses" }).fill("a11y");
  await axe(page, "course panel (filtered)");

  await page.goto("/admin/accounts");
  await expect(page.getByRole("heading", { name: "Accounts" })).toBeVisible();
  await axe(page, "admin");

  await page.goto("/account/password");
  await axe(page, "change password");
});
