/**
 * 020 (quickstart 1, 8, 10): Time mode in the home page's right panel — a Track timer that survives
 * a reload, the floating pill on other pages (hidden while the timer card shows), back to Time mode
 * from the pill, the saved entry in Today, and the calendar's time lane, which never starts a draft.
 * Leaves no timer running, so other specs never see the pill.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";
import { VIEWPORT } from "./layout-helpers";

test.use({ viewport: VIEWPORT });
test.describe.configure({ mode: "serial" });

const timeSwitch = (page: Page) => page.locator("#home-switch-time");
const card = (page: Page) => page.locator("#time-timer-card");
const pill = (page: Page) => page.getByRole("region", { name: "Activity" }).getByRole("region", { name: "Timer" });

async function stopAny(page: Page) {
  const csrf = (await page.context().cookies()).find((c) => c.name === "uh_csrf")?.value ?? "";
  const res = await page.request.get("/api/v1/time/timer");
  const timer = (await res.json()).timer;
  if (timer) {
    await page.request.post("/api/v1/time/timer/stop", {
      data: {},
      headers: { "If-Match": `"${timer.version}"`, "X-CSRF-Token": decodeURIComponent(csrf) },
    });
  }
}

test.afterEach(async ({ page }) => stopAny(page));

test("track time: start, reload, pill elsewhere, back, stop", async ({ page }) => {
  await signIn(page);
  await page.goto("/");
  await stopAny(page);
  await timeSwitch(page).click();
  await expect(page.getByRole("region", { name: "Tasks and time" })).toBeVisible();

  await card(page).getByRole("textbox", { name: "Description" }).fill("E2E problem set");
  await card(page).getByRole("button", { name: /start timer/i }).click();
  await expect(card(page).getByRole("button", { name: /^stop$/i })).toBeVisible();
  // the card is on screen: the same timer is never shown twice
  await expect(pill(page)).toHaveCount(0);

  // the timer lives on the server: a reload keeps it running, from the same start
  await page.waitForTimeout(1500);
  await page.reload();
  await expect(card(page).getByRole("button", { name: /^stop$/i })).toBeVisible();

  // another page: the pill shows the timer, and its label leads back to Time mode
  await page.goto("/settings/time");
  await expect(page.getByRole("heading", { name: "Time", level: 2 })).toBeVisible();
  await expect(pill(page)).toBeVisible();
  await expect(pill(page)).toContainText("E2E problem set");
  await pill(page).getByRole("button", { name: /open time/i }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(card(page)).toBeVisible();
  await expect(pill(page)).toHaveCount(0);

  // more than 5 seconds have passed: Stop saves an entry listed in Today
  await page.waitForTimeout(Math.max(0, 5200 - 1500));
  await card(page).getByRole("button", { name: /^stop$/i }).click();
  await expect(page.getByRole("list", { name: "Today's entries" }).getByText("E2E problem set").first()).toBeVisible();
});

test("the calendar shows tracked time in its lane; pressing the lane creates nothing", async ({ page }) => {
  await signIn(page);
  await page.goto("/");
  await stopAny(page);
  const csrf = (await page.context().cookies()).find((c) => c.name === "uh_csrf")?.value ?? "";
  const now = Date.now();
  const res = await page.request.post("/api/v1/time/entries", {
    data: { startedAt: new Date(now - 2 * 3_600_000).toISOString(), endedAt: new Date(now - 3_600_000).toISOString(), description: "E2E lane" },
    headers: { "X-CSRF-Token": decodeURIComponent(csrf) },
  });
  expect(res.status()).toBe(201);
  const entryId = (await res.json()).entry.id;

  await page.goto("/calendar/day");
  const block = page.locator(`[data-time-entry="${entryId}"]`);
  await expect(block).toBeVisible();
  await expect(block).toHaveAccessibleName(/E2E lane, No tag/);
  await block.dispatchEvent("pointerdown");
  await expect(page.locator("[data-draft]")).toHaveCount(0);

  // "Tasks only" hides the lane and changes nothing else
  await page.locator("#show-on-calendar-tasks").click();
  await expect(block).toHaveCount(0);
  await page.locator("#show-on-calendar-both").click();
  await expect(block).toBeVisible();

  await page.request.delete(`/api/v1/time/entries/${entryId}`, { headers: { "X-CSRF-Token": decodeURIComponent(csrf) } });
});

async function axe(page: Page, label: string) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(r.violations.map((v) => `${label}: ${v.id} → ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
}

test("Time mode, the pill, reports and Settings → Time pass axe (SC-006)", async ({ page }) => {
  await signIn(page);
  await page.goto("/");
  await stopAny(page);
  await timeSwitch(page).click();
  await card(page).getByRole("button", { name: /start timer/i }).click();
  await expect(card(page).getByRole("button", { name: /^stop$/i })).toBeVisible();
  await axe(page, "time mode");
  await page.getByRole("radio", { name: "Reports" }).click();
  await expect(page.getByText("Total", { exact: true })).toBeVisible();
  await axe(page, "reports");
  await page.goto("/settings/time");
  await expect(pill(page)).toBeVisible();
  await axe(page, "settings + pill");
});
