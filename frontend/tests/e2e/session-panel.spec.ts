/**
 * 014 US2: the session panel (Recordings above Chat) and the rail it closes to
 * (contracts/ui-contract.md "Session panel", "Rail").
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { tag } from "./helpers";
import { box, mainCard, openSession, sessionPanel, sessionRail, VIEWPORT } from "./layout-helpers";

test.use({ viewport: VIEWPORT });

const section = (page: Page, id: "recordings" | "chat") => page.locator(`section:has(> div > #panel-section-session-${id}-title)`);
const boundary = (page: Page) => page.getByRole("separator", { name: "Resize Recordings and Chat" });
const widthHandle = (page: Page) => page.getByRole("separator", { name: "Resize session panel" });

async function axeClean(page: Page) {
  const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(scan.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
}

test("US2: sections, boundary, width, close and reopen by the rail; the layout survives a reload", async ({ page }, testInfo) => {
  const t = tag(testInfo.project.name);
  const { url } = await openSession(page, `SP${t} 101`);
  const panel = sessionPanel(page);

  // Recordings above Chat, the close button in the Recordings header
  const collapseRec = panel.getByRole("button", { name: "Collapse Recordings" });
  const collapseChat = panel.getByRole("button", { name: "Collapse Chat" });
  await expect(collapseRec).toHaveAttribute("aria-expanded", "true");
  await expect(collapseChat).toHaveAttribute("aria-expanded", "true");
  expect((await box(collapseRec)).y).toBeLessThan((await box(collapseChat)).y);
  const close = section(page, "recordings").getByRole("button", { name: "Close session panel" });
  await expect(close).toHaveAttribute("aria-keyshortcuts", "Alt+BracketRight");
  await expect(section(page, "recordings").getByRole("button", { name: "Record", exact: true })).toBeVisible();
  expect(Math.round((await box(panel)).width)).toBe(360);
  await axeClean(page);

  // collapsing one section lets the other fill the panel
  const panelHeight = (await box(panel)).height;
  await collapseChat.click();
  await expect(panel.getByRole("button", { name: "Expand Chat", exact: true })).toHaveAttribute("aria-expanded", "false");
  await expect(boundary(page)).toHaveCount(0);
  await expect.poll(async () => (await box(section(page, "recordings"))).height).toBeGreaterThan(panelHeight - 60);
  await panel.getByRole("button", { name: "Expand Chat", exact: true }).click();
  await collapseRec.click();
  await expect.poll(async () => (await box(section(page, "chat"))).height).toBeGreaterThan(panelHeight - 60);
  await panel.getByRole("button", { name: "Expand Recordings" }).click();

  // the boundary: keys, drag, each section keeps its header + 120 px
  const edge = boundary(page);
  await expect(edge).toHaveAttribute("aria-orientation", "horizontal");
  await expect(edge).toHaveAttribute("aria-valuenow", "50");
  await edge.focus();
  await page.keyboard.press("ArrowDown");
  await expect(edge).toHaveAttribute("aria-valuenow", "55");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(edge).toHaveAttribute("aria-valuenow", "45");
  await page.keyboard.press("Home");
  await expect.poll(async () => (await box(section(page, "recordings"))).height).toBeGreaterThanOrEqual(159);
  await page.keyboard.press("End");
  await expect.poll(async () => (await box(section(page, "chat"))).height).toBeGreaterThanOrEqual(159);
  await page.keyboard.press("Enter");
  await expect(edge).toHaveAttribute("aria-valuenow", "50");
  const e = await box(edge);
  await page.mouse.move(e.x + e.width / 2, e.y + e.height / 2);
  await page.mouse.down();
  await page.mouse.move(e.x + e.width / 2, e.y + e.height / 2 + 70, { steps: 5 });
  await page.mouse.up();
  const dragged = Number(await edge.getAttribute("aria-valuenow"));
  expect(dragged).toBeGreaterThan(55);

  // width: 300 px at least, never more than 640 px, half the window or past the main card's 480 px
  const handle = widthHandle(page);
  await handle.focus();
  await page.keyboard.press("Home");
  await expect(handle).toHaveAttribute("aria-valuenow", "300");
  await page.keyboard.press("End");
  const widest = Number(await handle.getAttribute("aria-valuenow"));
  expect(widest).toBeLessThanOrEqual(Math.min(640, VIEWPORT.width / 2));
  await expect.poll(async () => (await box(mainCard(page))).width).toBeGreaterThanOrEqual(480);
  await page.keyboard.press("Enter");
  await expect(handle).toHaveAttribute("aria-valuenow", "360");
  await page.keyboard.press("ArrowLeft");
  await expect(handle).toHaveAttribute("aria-valuenow", "376");

  // Alt+] closes to a 44 px rail on the right edge; focus moves to its reopen button
  await panel.getByRole("button", { name: "Collapse Chat" }).focus();
  await page.keyboard.press("Alt+BracketRight");
  await expect(panel).toHaveCount(0);
  const rail = sessionRail(page);
  const show = rail.getByRole("button", { name: "Show session panel" });
  await expect(show).toBeFocused();
  await expect(show).toHaveAttribute("aria-keyshortcuts", "Alt+BracketRight");
  await expect.poll(async () => Math.round((await box(rail)).width)).toBe(44);
  const r = await box(rail);
  expect(Math.round(VIEWPORT.width - (r.x + r.width))).toBe(8);
  await expect(rail.getByRole("button", { name: "Recordings" })).toBeVisible();
  await expect(rail.getByRole("button", { name: "Chat" })).toBeVisible();
  await axeClean(page);

  // Alt+] reopens; closed again, the rail's Chat icon reopens it with Chat expanded and focused
  await page.keyboard.press("Alt+BracketRight");
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "Collapse Chat" }).click();
  await panel.getByRole("button", { name: "Close session panel" }).click();
  await rail.getByRole("button", { name: "Chat" }).click();
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("button", { name: "Collapse Chat" })).toBeFocused();

  // reload: the same layout (open, width, boundary, collapsed sections)
  await panel.getByRole("button", { name: "Collapse Recordings" }).click();
  await page.goto(url);
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("button", { name: "Expand Recordings" })).toBeVisible();
  await expect(widthHandle(page)).toHaveAttribute("aria-valuenow", "376");
  await panel.getByRole("button", { name: "Expand Recordings" }).click();
  await expect(boundary(page)).toHaveAttribute("aria-valuenow", String(dragged));
  await panel.getByRole("button", { name: "Close session panel" }).click();
  await page.goto(url);
  await expect(sessionRail(page)).toBeVisible();
  await expect(panel).toHaveCount(0);
  // the Recordings icon reopens it on Recordings
  await sessionRail(page).getByRole("button", { name: "Recordings" }).click();
  await expect(panel.getByRole("button", { name: "Collapse Recordings" })).toBeFocused();
});

test("US2: recording continues while the panel is closed; the rail and focus mode show it", async ({ page }, testInfo) => {
  const t = tag(testInfo.project.name);
  await openSession(page, `SPREC${t} 101`);
  const panel = sessionPanel(page);
  await panel.getByRole("button", { name: "Record", exact: true }).click();
  const pill = page.getByRole("region", { name: "Recording", exact: true });
  await expect(pill).toBeVisible();

  await panel.getByRole("button", { name: "Close session panel" }).click();
  await expect(panel).toHaveCount(0);
  const recordings = sessionRail(page).getByRole("button", { name: "Recordings, recording in progress" });
  await expect(recordings).toBeVisible();
  await expect(recordings.locator("[data-indicator=recording]")).toBeVisible();

  // chunks keep reaching the server while the panel is closed (5 s chunks)
  let uploaded = 0;
  page.on("response", (res) => {
    if (/\/api\/v1\/recordings\/[^/]+\/chunks\/\d+/.test(res.url()) && res.ok()) uploaded++;
  });
  await expect.poll(() => uploaded, { timeout: 15_000 }).toBeGreaterThan(0);

  // reduced motion: the dot stops pulsing but stays
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(recordings.locator("[data-indicator=recording]")).toBeVisible();
  expect(await recordings.locator("[data-indicator=recording]").evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
  await page.emulateMedia({ reducedMotion: "no-preference" });

  // focus mode hides the panel and the rail, the pill stays
  await page.locator("body").press("\\");
  await expect(sessionRail(page)).toHaveCount(0);
  await expect(panel).toHaveCount(0);
  await expect(pill).toBeVisible();
  await page.locator("body").press("\\");
  await expect(sessionRail(page)).toBeVisible();

  await pill.getByRole("button", { name: "Stop" }).click();
  await expect(pill).toBeHidden();
  await expect(sessionRail(page).getByRole("button", { name: "Recordings" })).toBeVisible();
});

test("FR-010: a 1000 px window starts with the panel closed to its rail and opens it over the main card", async ({ page }, testInfo) => {
  const t = tag(testInfo.project.name);
  const { url } = await openSession(page, `SPNAR${t} 101`);
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.goto(url);
  const rail = sessionRail(page);
  await expect(rail).toBeVisible();
  await expect(sessionPanel(page)).toHaveCount(0);
  const main = page.locator("#main");
  const before = await box(main);

  await rail.getByRole("button", { name: "Chat" }).click();
  const overlay = page.getByRole("dialog", { name: "Session panel" });
  await expect(overlay).toBeVisible();
  await expect(overlay.getByRole("button", { name: "Collapse Chat" })).toBeVisible();
  expect(await box(main)).toEqual(before);
  await axeClean(page);
  await page.keyboard.press("Escape");
  await expect(overlay).toBeHidden();
  await expect(rail.getByRole("button", { name: "Show session panel" }).or(rail.getByRole("button", { name: "Chat" })).first()).toBeVisible();
});
