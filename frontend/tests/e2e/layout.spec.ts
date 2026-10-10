/**
 * 008 floating card layout (contracts/ui-layout.md): cards, side panel and rail, the workspace
 * tab row, focus mode, activity pills, themes and narrow windows.
 */
import { expect, test } from "@playwright/test";
import { tag } from "./helpers";
import { audioCard, box, mainCard, openSession, radius, sidePanel, VIEWPORT, windowScrolls } from "./layout-helpers";
import { editor, newNote } from "./notes-helpers";

test.use({ viewport: VIEWPORT });

// the audio card's open state is an account preference shared by every spec: leave it open
test.afterEach(async ({ page }) => {
  const csrf = (await page.context().cookies()).find((c) => c.name === "uh_csrf")?.value;
  if (csrf) await page.request.patch("/api/v1/preferences", { data: { workspaceRightCollapsed: false }, headers: { "X-CSRF-Token": csrf } }).catch(() => undefined);
});

test("US1: the session workspace is three floating cards with one 40 px tab row", async ({ page }, testInfo) => {
  const t = tag(testInfo.project.name);
  await openSession(page, `LAY${t} 101`, { note: "Week notes" });

  const left = sidePanel(page);
  const main = mainCard(page);
  const audio = audioCard(page);
  for (const card of [left, main, audio]) {
    await expect(card).toBeVisible();
    expect(await radius(card)).toBeGreaterThanOrEqual(13);
    expect(await radius(card)).toBeLessThanOrEqual(15);
    expect(await card.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe("1px");
  }
  const [l, m, a] = [await box(left), await box(main), await box(audio)];
  // 8 px to the window edge and between cards
  expect(Math.round(l.x)).toBe(8);
  expect(Math.round(l.y)).toBe(8);
  expect(Math.round(m.x - (l.x + l.width))).toBe(8);
  expect(Math.round(a.x - (m.x + m.width))).toBe(8);
  expect(Math.round(VIEWPORT.width - (a.x + a.width))).toBe(8);
  expect(Math.round(VIEWPORT.height - (m.y + m.height))).toBe(8);
  expect(await windowScrolls(page)).toBe(false);
  await expect(page.getByRole("banner")).toHaveCount(0);
  await expect(page.getByRole("contentinfo")).toHaveCount(0);

  // left card: app name, search, Courses with New class, sections, Account + Settings at the bottom
  await expect(left.getByRole("link", { name: "UniHelperProMax" })).toBeVisible();
  await expect(left.getByRole("button", { name: "Hide side panel" })).toBeVisible();
  await expect(left.getByRole("searchbox", { name: "Search courses" })).toBeVisible();
  await expect(left.getByRole("button", { name: "Courses" })).toBeVisible();
  await expect(left.getByRole("button", { name: "New class" })).toBeVisible();
  await expect(left.getByRole("button", { name: "New note" }).first()).toBeVisible();
  await expect(left.getByRole("navigation", { name: "Sessions of this course" })).toBeVisible();
  const account = await box(left.getByRole("button", { name: "Account menu" }));
  const settings = await box(left.getByRole("button", { name: "Settings" }));
  expect(account.y + account.height).toBeGreaterThan(l.y + l.height - 60);
  expect(settings.y + settings.height).toBeGreaterThan(l.y + l.height - 60);

  // the tab row is the only fixed bar above the note: ≤ 10 % of 768 px
  const tablist = main.getByRole("tablist", { name: "Open notes and documents" });
  const row = tablist.locator("xpath=..");
  const r = await box(row);
  expect(r.height).toBeLessThanOrEqual(VIEWPORT.height * 0.1);
  expect(Math.round(r.height)).toBe(40);
  const content = await box(editor(page));
  expect(content.y).toBeLessThan(r.y + r.height + 40);

  // session chip and details
  const chip = main.getByRole("button", { name: /^Session details: Monday 7 December 2026, 10:00–11:30/ });
  await expect(chip).toBeVisible();
  await chip.click();
  const details = page.getByRole("dialog");
  await expect(details.getByRole("link", { name: `LAY${t} 101` })).toBeVisible();
  await expect(details).toContainText("FENS G032");
  await expect(details).toContainText(/Upcoming|In progress|Past/);
  await page.keyboard.press("Escape");

  // floating save state: typing doesn't move the text
  const firstLine = await box(editor(page));
  await editor(page).click();
  await page.keyboard.type("Operation count");
  const state = page.getByTestId("note-save-state");
  await expect(state).toHaveText(/Saved/, { timeout: 5000 });
  expect(await state.evaluate((el) => getComputedStyle(el).position)).toBe("absolute");
  expect((await box(editor(page))).y).toBe(firstLine.y);

  // audio card: header with title, Record and close; recordings below
  await expect(audio.getByRole("heading", { name: "Audio" })).toBeVisible();
  await expect(audio.getByRole("button", { name: "Record", exact: true })).toBeVisible();
  await expect(audio.getByRole("button", { name: "Hide audio panel" })).toBeVisible();
});

test("US2: side cards close to a rail / tab-row button and come back after a reload", async ({ page }, testInfo) => {
  const t = tag(testInfo.project.name);
  const { url } = await openSession(page, `RAIL${t} 101`);

  await sidePanel(page).getByRole("button", { name: "Hide side panel" }).click();
  const rail = sidePanel(page);
  expect(Math.round((await box(rail)).width)).toBe(44);
  await expect(rail.getByRole("button", { name: "Show side panel" })).toBeFocused();
  await expect(rail.getByRole("link", { name: "Go to home" })).toBeVisible();
  await rail.getByRole("button", { name: "Account menu" }).click();
  await expect(page.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(rail.getByRole("button", { name: "Settings" })).toBeVisible();

  const mainBefore = (await box(mainCard(page))).width;
  await audioCard(page).getByRole("button", { name: "Hide audio panel" }).click();
  await expect(audioCard(page)).toHaveCount(0);
  const reopen = mainCard(page).getByRole("button", { name: "Show audio panel" });
  await expect(reopen).toBeFocused();
  await expect.poll(async () => (await box(mainCard(page))).width).toBeGreaterThan(mainBefore);

  await page.goto(url);
  await expect(sidePanel(page).getByRole("button", { name: "Show side panel" })).toBeVisible();
  await expect(mainCard(page).getByRole("button", { name: "Show audio panel" })).toBeVisible();

  // keyboard: [ and Alt+] bring them back
  await mainCard(page).getByRole("button", { name: "Show audio panel" }).focus();
  await page.keyboard.press("[");
  await expect(sidePanel(page).getByRole("searchbox", { name: "Search courses" })).toBeVisible();
  await page.keyboard.press("Alt+BracketRight");
  await expect(audioCard(page)).toBeVisible();

  // reduced motion: no transition
  await page.emulateMedia({ reducedMotion: "reduce" });
  const grid = page.locator("[data-resizing]");
  expect(await grid.evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration))).toBeLessThanOrEqual(0.01);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  expect(await grid.evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration))).toBeLessThanOrEqual(0.2);
});

test("US2: the closed audio card's button shows a recording in progress", async ({ page }, testInfo) => {
  const t = tag(testInfo.project.name);
  await openSession(page, `IND${t} 101`);
  await audioCard(page).getByRole("button", { name: "Record", exact: true }).click();
  await expect(page.getByRole("region", { name: "Recording", exact: true })).toBeVisible();
  await audioCard(page).getByRole("button", { name: "Hide audio panel" }).click();
  const reopen = mainCard(page).getByRole("button", { name: "Show audio panel, recording in progress" });
  await expect(reopen).toBeVisible();
  await expect(reopen.locator("[data-indicator=recording]")).toBeVisible();

  // pill on another page (in-app navigation: a reload would interrupt the recording), then stop
  await sidePanel(page).getByRole("link", { name: "UniHelperProMax" }).click();
  await expect(page).toHaveURL(/\/calendar/);
  const pill = page.getByRole("region", { name: "Recording", exact: true });
  await expect(pill).toBeVisible();
  const [p, m] = [await box(pill), await box(mainCard(page))];
  expect(Math.abs(p.x + p.width / 2 - (m.x + m.width / 2))).toBeLessThanOrEqual(2);
  expect(m.y + m.height - (p.y + p.height)).toBeLessThan(40);
  await expect(pill.getByRole("link", { name: "Go to session" })).toBeVisible();
  // focus mode keeps the pill
  await page.keyboard.press("\\");
  await expect(sidePanel(page)).toHaveCount(0);
  await expect(pill).toBeVisible();
  await page.keyboard.press("\\");
  await pill.getByRole("button", { name: "Stop" }).click();
  await expect(pill).toBeHidden();
});

test("US3: the calendar and a course page live in the main card", async ({ page }, testInfo) => {
  const t = tag(testInfo.project.name);
  const { courseId } = await openSession(page, `CAL${t} 101`);
  await page.goto("/calendar");
  const main = mainCard(page);
  for (const name of ["Today", /^Previous/, /^Next/, "New class"]) await expect(main.getByRole("button", { name, exact: typeof name === "string" })).toBeVisible();
  for (const name of ["Day view", "Week view", "Month view"]) await expect(main.getByRole("radio", { name, exact: true }).or(main.getByRole("button", { name, exact: true }))).toBeVisible();
  await expect(main.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(audioCard(page)).toHaveCount(0);
  await main.getByRole("button", { name: "New class", exact: true }).click();
  await expect(page.getByRole("dialog", { name: /New class/ })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.goto(`/courses/${courseId}`);
  await expect(main.getByRole("heading", { name: `CAL${t} 101` })).toBeVisible();
  await expect(audioCard(page)).toHaveCount(0);
  expect(await windowScrolls(page)).toBe(false);
});

test("US4: focus mode hides both side cards and restores them exactly", async ({ page }, testInfo) => {
  const t = tag(testInfo.project.name);
  await openSession(page, `FOC${t} 101`, { note: "Focus" });
  const focusButton = () => mainCard(page).getByRole("button", { name: /focus mode$/ });

  for (const [closeLeft, closeRight] of [[false, false], [true, false], [false, true], [true, true]] as const) {
    if (closeLeft) await sidePanel(page).getByRole("button", { name: "Hide side panel" }).click();
    if (closeRight) await audioCard(page).getByRole("button", { name: "Hide audio panel" }).click();
    const leftWidth = Math.round((await box(sidePanel(page))).width);

    await mainCard(page).getByRole("tablist").getByRole("tab").first().focus();
    await page.keyboard.press("\\");
    await expect(sidePanel(page)).toHaveCount(0);
    await expect(audioCard(page)).toHaveCount(0);
    await expect(focusButton()).toHaveAttribute("aria-pressed", "true");
    await focusButton().click();
    await expect(focusButton()).toHaveAttribute("aria-pressed", "false");
    await expect.poll(async () => Math.round((await box(sidePanel(page))).width)).toBe(leftWidth);
    await expect(audioCard(page)).toHaveCount(closeRight ? 0 : 1);

    // back to both open
    if (closeLeft) await sidePanel(page).getByRole("button", { name: "Show side panel" }).click();
    if (closeRight) await mainCard(page).getByRole("button", { name: "Show audio panel" }).click();
  }

  // typing "\" in a note inserts it
  await editor(page).click();
  await page.keyboard.type("a\\b");
  await expect(editor(page)).toContainText("a\\b");
  await expect(sidePanel(page)).toBeVisible();
});

test("US6: cards use the theme's Background, Surface / card and Border colours", async ({ page }, testInfo) => {
  const t = tag(testInfo.project.name);
  await openSession(page, `THM${t} 101`);
  const colors = await page.evaluate(() => {
    const css = getComputedStyle(document.documentElement);
    const probe = (v: string) => {
      const d = document.createElement("div");
      d.style.color = `var(${v})`;
      document.body.append(d);
      const c = getComputedStyle(d).color;
      d.remove();
      return c;
    };
    const main = document.getElementById("main")!;
    const grid = main.parentElement!;
    void css;
    return {
      bg: getComputedStyle(grid).backgroundColor,
      card: getComputedStyle(main).backgroundColor,
      border: getComputedStyle(main).borderTopColor,
      surface: probe("--surface"),
      elevated: probe("--surface-elevated"),
      borderToken: probe("--border"),
    };
  });
  expect(colors.bg).toBe(colors.surface);
  expect(colors.card).toBe(colors.elevated);
  expect(colors.border).toBe(colors.borderToken);
});

test("US7: narrow windows open the side cards over the main card", async ({ page }, testInfo) => {
  const t = tag(testInfo.project.name);
  const { url } = await openSession(page, `NAR${t} 101`);
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.goto(url);
  await expect(sidePanel(page)).toHaveCount(0);
  await expect(audioCard(page)).toHaveCount(0);
  // an open overlay is modal (the page behind it is hidden from assistive tech): measure by id
  const main = page.locator("#main");
  const before = await box(main);
  expect(Math.round(before.x)).toBe(8);

  const show = mainCard(page).getByRole("button", { name: "Show side panel" });
  await show.click();
  await expect(sidePanel(page)).toBeVisible();
  await expect(sidePanel(page).getByRole("button", { name: "Settings" })).toBeVisible();
  await expect(sidePanel(page).getByRole("button", { name: "Account menu" })).toBeVisible();
  expect(await box(main)).toEqual(before);
  await page.keyboard.press("Escape");
  await expect(sidePanel(page)).toHaveCount(0);
  await expect(show).toBeFocused();

  await page.keyboard.press("Alt+BracketRight");
  await expect(audioCard(page)).toBeVisible();
  expect(await box(main)).toEqual(before);
  await page.keyboard.press("Escape");
  await expect(audioCard(page)).toHaveCount(0);

  // back to a wide window: the remembered docked layout returns
  await page.setViewportSize(VIEWPORT);
  await expect(sidePanel(page)).toBeVisible();
  await expect(audioCard(page)).toBeVisible();

  // 1100 px with both cards at their widest: the main card keeps 480 px
  await page.setViewportSize({ width: 1100, height: 768 });
  for (const name of ["Resize course panel", "Resize audio panel"]) {
    await page.getByRole("separator", { name }).focus();
    await page.keyboard.press("End");
  }
  await expect.poll(async () => (await box(mainCard(page))).width).toBeGreaterThanOrEqual(480);
});

test("edge: many tabs keep the tab row 40 px with its controls in view", async ({ page }, testInfo) => {
  const t = tag(testInfo.project.name);
  await openSession(page, `TAB${t} 101`);
  for (let i = 1; i <= 12; i++) {
    await page.keyboard.press("Alt+n");
    const dialog = page.getByRole("dialog", { name: "New note" });
    await dialog.getByLabel("Note name").fill(`Note number ${i}`);
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
  }
  const row = mainCard(page).getByRole("tablist").locator("xpath=..");
  expect(Math.round((await box(row)).height)).toBe(40);
  for (const name of [/^Session details/, "Enter focus mode"]) await expect(mainCard(page).getByRole("button", { name })).toBeInViewport();
  await expect(page.getByRole("tab", { name: /^Note number 12/ })).toBeInViewport();
});

test("SC-002: every action from before the redesign is still reachable by keyboard and pointer", async ({ page }, testInfo) => {
  const t = tag(testInfo.project.name);
  const { url } = await openSession(page, `INV${t} 101`, { note: "Inventory" });
  const main = mainCard(page);
  const left = sidePanel(page);

  // Account menu: items and Sign out (cancelled by closing the menu), by pointer and keyboard
  await left.getByRole("button", { name: "Account menu" }).click();
  for (const item of ["Settings", "Change password", "Time zone…", "Sign out"]) await expect(page.getByRole("menuitem", { name: item })).toBeVisible();
  await page.keyboard.press("Escape");
  await left.getByRole("button", { name: "Account menu" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
  await page.keyboard.press("Escape");

  // Settings (footer button) and back home (app name)
  await left.getByRole("button", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/settings/);
  await left.getByRole("link", { name: "UniHelperProMax" }).click();
  await expect(page).toHaveURL(/\/calendar/);

  // New class: "+" beside Courses and the calendar toolbar ("n" on the calendar)
  await left.getByRole("button", { name: "New class" }).click();
  await expect(page.getByRole("dialog", { name: /New class/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.locator("body").click({ position: { x: 700, y: 400 } });
  await page.keyboard.press("n");
  await expect(page.getByRole("dialog", { name: /New class/ })).toBeVisible();
  await page.keyboard.press("Escape");

  // "/" focuses the course search, also from the rail
  await page.goto(url);
  await sidePanel(page).getByRole("button", { name: "Hide side panel" }).click();
  await page.keyboard.press("/");
  await expect(page.getByRole("searchbox", { name: "Search courses" })).toBeFocused();

  // tab row: Live/Raw, chip details with the course link, split view where there is room
  await main.getByRole("radio", { name: "Raw" }).or(main.getByRole("button", { name: "Raw" })).first().click();
  await main.getByRole("radio", { name: "Live" }).or(main.getByRole("button", { name: "Live" })).first().click();
  await main.getByRole("button", { name: /^Session details/ }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog").getByRole("link", { name: `INV${t} 101` })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1600, height: 900 });
  await audioCard(page).getByRole("button", { name: "Hide audio panel" }).click();
  await newNote(page, "Second"); // split view shows two tabs side by side
  await page.keyboard.press("Alt+Backslash");
  await expect(main.getByRole("button", { name: "Split" })).toHaveAttribute("aria-pressed", "true");
  await main.getByRole("button", { name: "Split" }).click();
  await expect(main.getByRole("button", { name: "Split" })).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Alt+BracketRight");
  await expect(audioCard(page)).toBeVisible();
});
