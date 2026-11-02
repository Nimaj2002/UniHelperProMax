import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { calendarAction, newHierarchy, seedClass, signIn, tag } from "./helpers";
import { textPdf } from "./pdf-fixtures";

async function axe(page: Page, label: string) {
  // fade/zoom-in animations (views, tooltips) must finish: half-transparent text fails contrast
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
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
  // 012: the home page shows Tasks beside the calendar; this calendar test uses the calendar's
  // full width as before (Tasks closed to its rail), where overlapping entries have room
  await page.addInitScript(() => localStorage.setItem("uh.home.panels", JSON.stringify({ calendar: true, tasks: false })));
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

  await calendarAction(page, "New class");
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

/** Dialogs fade in; contrast measured mid-animation is meaningless (006 scans wait for it). */
async function settledAxe(page: Page, label: string) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
  await axe(page, label);
}

test("Accessibility (006): import UI in a user-created theme", async ({ page }, testInfo) => {
  const t = tag(testInfo.project.name);
  await signIn(page);
  const cls = await seedClass(page, {
    // evening slot: the shared e2e calendar must not gain overlaps in other specs' weeks
    course: newHierarchy(`A11YIMP${t} 101`, `A11y imp ${t}`, `A11y imp year ${t}`), startDate: "2026-09-28", startTime: "19:00",
    endTime: "20:00", location: "Room 1", color: "teal",
    recurrence: { freq: "weekly", byWeekday: ["MO", "WE"], end: { kind: "semester_end" } },
  });

  // a user-created theme (copied from the current one, AA-passing), selected for the account
  await page.goto("/settings/appearance");
  await page.getByRole("button", { name: "New theme…" }).click();
  await page.getByRole("dialog").getByRole("textbox", { name: "Name" }).fill(`Import a11y ${t}`);
  await page.getByRole("button", { name: "Create and edit" }).click();
  await page.getByRole("button", { name: "Save theme" }).click();
  await expect(page).toHaveURL(/\/settings\/appearance$/);
  const theme = page.getByRole("radio", { name: new RegExp(`Import a11y ${t}`) });
  await theme.click();
  await expect(theme).toBeChecked();

  await page.goto(`/courses/${cls.courseId}/sessions/${encodeURIComponent(`${cls.lineageId}:2026-10-05`)}`);
  const panel = page.getByRole("complementary", { name: "Session panel" });
  const wav = Buffer.concat([
    Buffer.from("52494646", "hex"), Buffer.from([36 + 3200, 12, 0, 0]), Buffer.from("WAVEfmt ", "ascii"),
    Buffer.from([16, 0, 0, 0, 1, 0, 1, 0, 0x80, 0x3e, 0, 0, 0, 0x7d, 0, 0, 2, 0, 16, 0]),
    Buffer.from("data", "ascii"), Buffer.from([0x80, 0x0c, 0, 0]), Buffer.alloc(3200),
  ]);
  await panel.getByTestId("upload-audio-input").setInputFiles({ name: "imported.wav", mimeType: "audio/wav", buffer: wav });
  await expect(panel.getByRole("button", { name: /^imported/ })).toContainText("Imported", { timeout: 15000 });
  await page.route(/\/recordings\/import\?/, async (route) => {
    await new Promise((r) => setTimeout(r, 10_000));
    await route.continue().catch(() => undefined);
  });
  await panel.getByTestId("upload-audio-input").setInputFiles([
    { name: "held.wav", mimeType: "audio/wav", buffer: wav },
    { name: "notes.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF") },
  ]);
  await expect(panel.getByRole("button", { name: "Cancel upload of held.wav" })).toBeVisible();
  await settledAxe(page, "audio panel with uploads (custom theme)");
  await panel.getByRole("button", { name: "Cancel upload of held.wav" }).click();

  const pick = (text: string) =>
    page.getByTestId("import-note-input").setInputFiles({ name: "Lecture.md", mimeType: "text/markdown", buffer: Buffer.from(text) });
  await pick("first");
  await expect(page.getByText("Imported “Lecture”")).toBeVisible();
  await pick("second");
  const prompt = page.getByRole("alertdialog", { name: /already exists/ });
  await expect(prompt).toBeVisible();
  await settledAxe(page, "note conflict dialog (custom theme)");
  await prompt.getByRole("button", { name: "Replace…" }).click();
  await expect(page.getByRole("alertdialog", { name: /Replace the content/ })).toBeVisible();
  await settledAxe(page, "replace confirmation (custom theme)");
  await page.keyboard.press("Escape"); // back to the prompt
  await expect(page.getByRole("alertdialog", { name: /already exists/ })).toBeVisible();
  await page.keyboard.press("Escape"); // skip
  await expect(page.getByRole("alertdialog")).toBeHidden();
});

test("Accessibility: every built-in preset theme passes WCAG AA on the main screens", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("dark"), "presets set their own colours; one colour-scheme run is enough");
  test.setTimeout(480_000);
  await signIn(page);
  const cls = await seedClass(page, {
    // evening slot: keeps other specs' 10:00 calendar layouts unchanged
    course: newHierarchy("PRESETS 101", "Presets", "Presets year"), startDate: "2026-09-28", startTime: "19:00",
    endTime: "20:00", location: "Room 3", color: "violet",
    recurrence: { freq: "weekly", byWeekday: ["MO", "WE"], end: { kind: "semester_end" } },
  });
  const csrf = (await page.context().cookies()).find((c) => c.name === "uh_csrf")?.value ?? "";
  const setTheme = (theme: string) => page.request.patch("/api/v1/preferences", { data: { theme }, headers: { "X-CSRF-Token": csrf } });

  await page.goto("/settings/appearance");
  await expect(page.locator("[role=radio][value^='preset:']")).toHaveCount(18);
  const ids = await page.locator("[role=radio][value^='preset:']").evaluateAll((els) => els.map((e) => e.getAttribute("value")!));
  expect(ids).toHaveLength(18);
  try {
    for (const id of ids) {
      expect((await setTheme(id)).ok()).toBe(true);
      // a fresh page per preset: many full dev-server page loads in one tab exhaust Chromium
      // (net::ERR_INSUFFICIENT_RESOURCES)
      const p = await page.context().newPage();
      try {
        await p.goto("/calendar/week/2026-10-05");
        await expect(p.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 15000 });
        await expect.poll(() => p.evaluate(() => document.documentElement.style.getPropertyValue("--surface"))).not.toBe("");
        await settledAxe(p, `${id} calendar`);
        await p.goto(`/courses/${cls.courseId}/sessions/${encodeURIComponent(`${cls.lineageId}:2026-10-05`)}`);
        await expect(p.getByRole("button", { name: "Upload audio" })).toBeVisible({ timeout: 15000 });
        await settledAxe(p, `${id} workspace`);
      } finally {
        await p.close();
      }
    }
  } finally {
    await setTheme("system");
  }
});

/**
 * A member account of its own, so the theme and "dark pages" this test sets don't change the
 * owner account other specs use in parallel.
 */
async function memberPage(browser: Browser, owner: Page, username: string) {
  const csrf = async (ctx: BrowserContext) => (await ctx.cookies()).find((c) => c.name === "uh_csrf")?.value ?? "";
  const first = "member-password-1";
  const password = "member-password-2";
  await owner.request.post("/api/v1/admin/users", { data: { username, password: first }, headers: { "X-CSRF-Token": await csrf(owner.context()) } });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const p = await ctx.newPage();
  const login = await p.request.post("/api/v1/auth/login", { data: { username, password: first } });
  if (login.ok()) {
    await p.request.post("/api/v1/auth/password", { data: { currentPassword: first, newPassword: password }, headers: { "X-CSRF-Token": await csrf(ctx) } });
  } else {
    expect((await p.request.post("/api/v1/auth/login", { data: { username, password } })).ok()).toBe(true);
  }
  return { p, ctx, csrf: () => csrf(ctx) };
}

test("Accessibility (007): documents, reader, search, annotations and split view; keyboard only", async ({ page, browser }, testInfo) => {
  test.setTimeout(240_000);
  const t = tag(testInfo.project.name);
  await signIn(page);
  const { p, ctx, csrf } = await memberPage(browser, page, `reader-${t.toLowerCase()}`);
  const cls = await seedClass(p, {
    course: newHierarchy(`A11YDOC${t} 101`, `A11y doc ${t}`, `A11y doc year ${t}`), startDate: "2026-09-28", startTime: "19:00",
    endTime: "20:00", location: "Room 1", color: "teal",
    recurrence: { freq: "weekly", byWeekday: ["MO", "WE"], end: { kind: "semester_end" } },
  });
  const url = `/courses/${cls.courseId}/sessions/${encodeURIComponent(`${cls.lineageId}:2026-10-05`)}`;
  await p.goto(url);
  const docs = p.getByRole("region", { name: "Documents" });

  // keyboard only: upload, open, read, search, annotate, split (freehand excluded, SC-008)
  await docs.getByRole("button", { name: "Upload PDF" }).focus();
  const chooser = p.waitForEvent("filechooser");
  await p.keyboard.press("Enter");
  await (await chooser).setFiles({ name: "Readable.pdf", mimeType: "application/pdf", buffer: textPdf(5) });
  await expect(docs.getByRole("button", { name: /^Readable/ })).toBeVisible({ timeout: 15000 });
  await settledAxe(p, "documents section");
  await docs.getByRole("button", { name: /^Readable/ }).focus();
  await p.keyboard.press("Enter");
  const r = p.getByRole("region", { name: "Readable — PDF" });
  await expect(r.getByTestId("reader-status")).toHaveText(/Page 1 of 5/, { timeout: 15000 });
  await expect(r.getByRole("radio", { name: "Draw" })).toBeEnabled();
  await r.getByLabel("Pages", { exact: true }).focus();
  await p.keyboard.press("PageDown");
  await expect(r.getByTestId("reader-status")).toHaveText(/Page 2 of 5/);
  await settledAxe(p, "reader");

  await p.keyboard.press("Control+f");
  await p.keyboard.type("tree");
  await expect(r.getByTestId("search-status")).toHaveText(/of 5/);
  await settledAxe(p, "reader search");
  await p.keyboard.press("Escape");

  await r.getByRole("radio", { name: "Comment" }).focus();
  await p.keyboard.press("Space");
  await r.getByLabel("Pages", { exact: true }).focus();
  await p.keyboard.press("Enter");
  await p.keyboard.type("for the exam");
  await p.keyboard.press("Escape");
  const comment = r.getByRole("button", { name: /^Comment, page \d: for the exam/ });
  await comment.focus();
  await expect(comment).toHaveClass(/outline-ring/);
  await settledAxe(p, "selected annotation");

  // split view: a note next to the PDF
  await p.keyboard.press("Alt+n");
  await p.getByRole("dialog", { name: "New note" }).getByLabel("Note name").fill("Questions");
  await p.keyboard.press("Enter");
  await p.getByRole("tab", { name: /^Readable/ }).focus();
  await p.keyboard.press("Enter");
  await p.keyboard.press("Alt+Backslash");
  await expect(p.getByRole("button", { name: "Split" })).toHaveAttribute("aria-pressed", "true");
  await settledAxe(p, "split view");

  await r.getByRole("button", { name: "Dark pages" }).focus();
  await p.keyboard.press("Enter");
  await expect(r.getByRole("button", { name: "Dark pages" })).toHaveAttribute("aria-pressed", "true");
  await settledAxe(p, "dark pages");

  if (!testInfo.project.name.includes("dark")) {
    // one built-in preset and one user-created theme (both colour schemes are the two projects)
    const setTheme = async (theme: string) =>
      expect((await p.request.patch("/api/v1/preferences", { data: { theme }, headers: { "X-CSRF-Token": await csrf() } })).ok()).toBe(true);
    await p.goto("/settings/appearance");
    const preset = await p.locator("[role=radio][value^='preset:']").first().getAttribute("value");
    await setTheme(preset!);
    await p.goto(url);
    await expect(r.getByTestId("reader-status")).toHaveText(/Page \d of 5/, { timeout: 15000 });
    await settledAxe(p, `reader in ${preset}`);

    await p.goto("/settings/appearance");
    await p.getByRole("button", { name: "New theme…" }).click();
    await p.getByRole("dialog").getByRole("textbox", { name: "Name" }).fill("Reader a11y");
    await p.getByRole("button", { name: "Create and edit" }).click();
    await p.getByRole("button", { name: "Save theme" }).click();
    await p.getByRole("radio", { name: /Reader a11y/ }).click();
    await p.goto(url);
    await expect(r.getByTestId("reader-status")).toHaveText(/Page \d of 5/, { timeout: 15000 });
    await settledAxe(p, "reader in a user theme");
  }
  await ctx.close();
});

test("Accessibility (008): card layout landmarks, names and unclipped focus, open and with the rail", async ({ page }, testInfo) => {
  const t = tag(testInfo.project.name);
  await page.setViewportSize({ width: 1366, height: 768 });
  await signIn(page);
  const cls = await seedClass(page, {
    course: newHierarchy(`A11YLAY${t} 101`, `A11y lay ${t}`, `A11y lay year ${t}`), startDate: "2026-09-28", startTime: "21:00",
    endTime: "21:30", location: "Room 2", color: "blue",
    recurrence: { freq: "weekly", byWeekday: ["MO"], end: { kind: "semester_end" } },
  });
  const pages = [
    ["calendar", "/calendar/week/2026-10-05"],
    ["course page", `/courses/${cls.courseId}`],
    ["session workspace", `/courses/${cls.courseId}/sessions/${encodeURIComponent(`${cls.lineageId}:2026-10-05`)}`],
  ] as const;

  /** Every Tab stop's focus ring (2 px outline + 2 px offset) fits inside its card. */
  async function focusInsideCards(steps = 30) {
    for (let i = 0; i < steps; i++) {
      await page.keyboard.press("Tab");
      const clipped = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        const card = el?.closest<HTMLElement>("#course-panel, #main, #workspace-session-panel");
        if (!el || !card || el === card) return null;
        const r = el.getBoundingClientRect();
        const c = card.getBoundingClientRect();
        const ring = 4;
        // only elements scrolled into view count (scroll containers clip the rest by design)
        if (r.bottom < c.top || r.top > c.bottom) return null;
        return r.left - ring < c.left - 0.5 || r.right + ring > c.right + 0.5 ? el.outerHTML.slice(0, 120) : null;
      });
      expect(clipped, `focus ring clipped at tab stop ${i + 1}`).toBeNull();
    }
  }

  for (const [label, url] of pages) {
    await page.goto(url);
    await expect(page.getByRole("main", { name: "Workspace" })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Side panel" })).toBeVisible();
    if (label === "session workspace") await expect(page.getByRole("complementary", { name: "Session panel" })).toBeVisible();
    await axe(page, `${label} (cards)`);
    const unnamed = await page.evaluate(() =>
      [...document.querySelectorAll("button")].filter((b) => !b.closest("[aria-hidden=true]") && !(b.getAttribute("aria-label") || b.textContent?.trim() || b.getAttribute("aria-labelledby") || b.title)).map((b) => b.outerHTML.slice(0, 100)),
    );
    expect(unnamed).toEqual([]);
    await page.locator("body").click({ position: { x: 2, y: 2 } });
    await focusInsideCards();
  }

  // with the rail
  await page.getByRole("button", { name: "Hide side panel" }).click();
  await expect(page.getByRole("complementary", { name: "Side panel" }).getByRole("button", { name: "Show side panel" })).toBeVisible();
  await axe(page, "session workspace (rail)");
  await page.getByRole("button", { name: "Show side panel" }).click();
});

test("Accessibility (009): events, draft + quick form, Events page and Trash; themes and reduced motion", async ({ page, browser }, testInfo) => {
  test.setTimeout(240_000);
  const t = tag(testInfo.project.name);
  await signIn(page);
  const { p, ctx, csrf } = await memberPage(browser, page, `events-${t.toLowerCase()}`);
  const post = async (url: string, data: unknown) => {
    const r = await p.request.post(url, { data, headers: { "X-CSRF-Token": await csrf() } });
    expect(r.ok(), await r.text()).toBe(true);
    return r.json();
  };
  // a weekly class overlapped by two events, and one deleted event in the Trash
  const cls = await seedClass(p, {
    course: newHierarchy(`A11YEV${t} 101`, `A11y ev ${t}`, `A11y ev year ${t}`), startDate: "2026-10-05", startTime: "10:00",
    endTime: "12:00", location: "Room 1", color: "teal", recurrence: { freq: "weekly", byWeekday: ["MO", "WE"], end: { kind: "semester_end" } },
  });
  const semesterId = (await (await p.request.get(`/api/v1/courses/${cls.courseId}`)).json()).semesterId as string;
  await post("/api/v1/events", { title: "Career fair with a rather long title", semester: { id: semesterId }, startDate: "2026-10-07", startTime: "10:30", endTime: "11:30", location: "Hall" });
  await post("/api/v1/events", { title: "Office hour", semester: { id: semesterId }, startDate: "2026-10-07", startTime: "11:00", endTime: "12:30", color: "pink" });
  const gone = await post("/api/v1/events", { title: "Cancelled talk", semester: { id: semesterId }, startDate: "2026-10-08", startTime: "15:00", endTime: "16:00" });
  const del = await p.request.delete(`/api/v1/sessions/${encodeURIComponent(`${gone.lineageId}:2026-10-08`)}?scope=all`, {
    headers: { "X-CSRF-Token": await csrf(), "If-Match": `"${gone.version}"` },
  });
  expect(del.ok(), await del.text()).toBe(true);

  const quickForm = p.getByRole("dialog", { name: "New entry" });
  async function calendarWithForm(label: string) {
    await p.goto("/calendar/week/2026-10-05");
    await expect(p.locator("[data-kind=event]")).toHaveCount(2);
    // keyboard: a slot, a range, the quick form (US7)
    await p.locator("[data-calendar-grid] [data-slot-at][tabindex='0']").focus();
    await p.keyboard.press("Shift+ArrowDown");
    await p.keyboard.press("Enter");
    await expect(quickForm).toBeVisible();
    await settledAxe(p, label);
    await p.keyboard.press("Escape");
    await expect(quickForm).toBeHidden();
  }

  await calendarWithForm("calendar with events, draft and quick form");
  await p.getByRole("button", { name: /^Event: Office hour/ }).focus();
  await expect(p.getByRole("tooltip")).toContainText("Office hour");
  await settledAxe(p, "event tooltip on focus");

  await p.goto(`/semesters/${semesterId}/events`);
  await expect(p.getByText("Career fair with a rather long title").first()).toBeVisible();
  await settledAxe(p, "Events page");

  await p.goto("/settings/trash");
  const card = p.getByRole("region", { name: "Deleted events" }).getByRole("listitem").filter({ hasText: "Cancelled talk" });
  await card.getByRole("button", { name: "Delete Cancelled talk permanently" }).click();
  const sure = p.getByRole("alertdialog");
  await expect(sure).toContainText("Are you sure?");
  await expect(sure.getByRole("button", { name: "No" })).toBeFocused();
  await settledAxe(p, "Trash page with the Are you sure? dialog");
  await p.keyboard.press("Escape");
  await settledAxe(p, "Trash page");

  // reduced motion (FR-045): nothing animates when the form opens
  await p.emulateMedia({ reducedMotion: "reduce" });
  await p.goto("/calendar/week/2026-10-05");
  await p.locator("[data-calendar-grid] [data-slot-at][tabindex='0']").focus();
  await p.keyboard.press("Enter");
  await expect(quickForm).toBeVisible();
  const running = await p.evaluate(
    () => new Promise<number>((done) => requestAnimationFrame(() => requestAnimationFrame(() =>
      done(document.getAnimations().filter((a) => a.playState === "running" && Number(a.effect?.getComputedTiming().duration) > 1).length)))),
  );
  expect(running).toBe(0);
  await p.keyboard.press("Escape");
  await p.emulateMedia({ reducedMotion: "no-preference" });

  if (!testInfo.project.name.includes("dark")) {
    // one built-in preset and one user-created theme (both colour schemes are the two projects)
    const setTheme = async (theme: string) =>
      expect((await p.request.patch("/api/v1/preferences", { data: { theme }, headers: { "X-CSRF-Token": await csrf() } })).ok()).toBe(true);
    await p.goto("/settings/appearance");
    const preset = await p.locator("[role=radio][value^='preset:']").first().getAttribute("value");
    await setTheme(preset!);
    await calendarWithForm(`calendar and quick form in ${preset}`);

    await p.goto("/settings/appearance");
    await p.getByRole("button", { name: "New theme…" }).click();
    await p.getByRole("dialog").getByRole("textbox", { name: "Name" }).fill("Events a11y");
    await p.getByRole("button", { name: "Create and edit" }).click();
    await p.getByRole("button", { name: "Save theme" }).click();
    await p.getByRole("radio", { name: /Events a11y/ }).click();
    await calendarWithForm("calendar and quick form in a user theme");
    await p.goto("/settings/trash");
    await settledAxe(p, "Trash page in a user theme");
  }
  await ctx.close();
});

test("Accessibility (010): calendar import and export in a user-created theme, keyboard focus visible", async ({ page }, testInfo) => {
  const t = tag(testInfo.project.name);
  await signIn(page);
  await page.goto("/settings/appearance");
  await page.getByRole("button", { name: "New theme…" }).click();
  await page.getByRole("dialog").getByRole("textbox", { name: "Name" }).fill(`Calendar io ${t}`);
  await page.getByRole("button", { name: "Create and edit" }).click();
  await page.getByRole("button", { name: "Save theme" }).click();
  await expect(page).toHaveURL(/\/settings\/appearance$/);
  const theme = page.getByRole("radio", { name: new RegExp(`Calendar io ${t}`) });
  await theme.click();
  await expect(theme).toBeChecked();

  await page.goto("/settings/import-export");
  await settledAxe(page, "import and export page (custom theme)");
  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//T//T//EN",
    "BEGIN:VEVENT", `UID:a11y-io-${t}`, "DTSTART;TZID=Europe/Istanbul:20271206T230000",
    "DTEND;TZID=Europe/Istanbul:20271206T233000", "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=2", `SUMMARY:A11y io ${t}`, "END:VEVENT",
    "BEGIN:VEVENT", `UID:a11y-monthly-${t}`, "DTSTART;TZID=Europe/Istanbul:20271207T230000",
    "DTEND;TZID=Europe/Istanbul:20271207T233000", "RRULE:FREQ=MONTHLY;BYDAY=1TU", `SUMMARY:A11y monthly ${t}`, "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  await page.getByTestId("ics-input").setInputFiles({ name: "a11y.ics", mimeType: "text/calendar", buffer: Buffer.from(ics) });
  await expect(page.getByRole("heading", { name: "Preview of a11y.ics" })).toBeFocused();
  await expect(page.getByText("Not supported").first()).toBeVisible();
  await settledAxe(page, "import preview with an unsupported group (custom theme)");
  await focusVisibleOnTab(page, 15);

  await page.getByRole("radio", { name: "New semester" }).click();
  await page.getByLabel("New year name").fill(`A11y io year ${t}`);
  await page.getByLabel("Semester name").fill(`A11y io term ${t}`);
  await page.getByRole("button", { name: /^Import \d+ entr/ }).click();
  await expect(page.getByText(/choose what to do with this repetition/i).first()).toBeVisible();
  await page.getByRole("radio", { name: "Skip" }).click();
  await page.getByRole("button", { name: /^Import \d+ entr/ }).click();
  await expect(page.getByRole("heading", { name: "Import finished" })).toBeFocused();
  await settledAxe(page, "import result (custom theme)");
  await page.getByRole("button", { name: "Undo import" }).click();
  await settledAxe(page, "undo confirmation (custom theme)");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Undo import" })).toBeFocused();
});

test("Accessibility (012): home panels, rails, task details, quick notes, filters and column deletion; themes", async ({ page, browser }, testInfo) => {
  test.setTimeout(240_000);
  const t = tag(testInfo.project.name);
  await signIn(page);
  const { p, ctx, csrf } = await memberPage(browser, page, `tasks-${t.toLowerCase()}`);
  const call = async <T,>(method: string, url: string, data?: unknown): Promise<T> => {
    const r = await p.request.fetch(url, { method, data, headers: { "X-CSRF-Token": await csrf() } });
    expect(r.ok(), await r.text()).toBe(true);
    return (r.status() === 204 ? undefined : await r.json()) as T;
  };
  // a course task with a checklist and a quick note, an overdue task, a dated task on the calendar
  const cls = await seedClass(p, {
    course: newHierarchy(`A11YTK${t} 101`, `A11y tk ${t}`, `A11y tk year ${t}`), startDate: "2026-10-05", startTime: "10:00",
    endTime: "11:00", color: "teal", recurrence: { freq: "none" },
  });
  const columns = (await call<{ id: string; name: string; position: number }[]>("GET", "/api/v1/task-columns")).sort((a, b) => a.position - b.position);
  if (!(await call<unknown[]>("GET", "/api/v1/tasks")).length) {
    const essay = await call<{ id: string; version: number }>("POST", "/api/v1/tasks", { title: "Essay draft", columnId: columns[0].id, courseId: cls.courseId, dueDate: "2026-10-06" });
    await p.request.put(`/api/v1/tasks/${essay.id}/checklist`, {
      data: { items: [{ text: "Outline", done: true }, { text: "Sources", done: false }] },
      headers: { "X-CSRF-Token": await csrf(), "If-Match": `"${essay.version}"` },
    });
    await call("POST", `/api/v1/tasks/${essay.id}/quick-notes`, { title: "Idea", body: "Start with the conclusion" });
    await call("POST", "/api/v1/tasks", { title: "Late lab report", columnId: columns[0].id, dueDate: "2020-01-06" });
    await call("POST", "/api/v1/tasks", { title: "Office hour prep", columnId: columns[1].id, dueDate: "2026-10-07", dueTime: "09:00" });
  }
  await p.addInitScript(() => localStorage.setItem("uh.calendar.showTasks", "true"));

  const tasksPanel = p.locator("#tasks-panel");
  const essayCard = tasksPanel.locator("[data-task-id]").filter({ hasText: "Essay draft" });
  async function homeScreens(theme: string) {
    await p.goto("/calendar/week/2026-10-05");
    await expect(tasksPanel.locator("[data-task-id]")).toHaveCount(3);
    await expect(p.locator("[data-task-marker]")).not.toHaveCount(0);
    // two named panel landmarks; no button without a name
    await expect(p.getByRole("region", { name: "Calendar" })).toHaveCount(1);
    await expect(p.getByRole("region", { name: "Tasks and time" })).toHaveCount(1);
    const unnamed = await p.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("#calendar-panel button, #tasks-panel button")]
        .filter((b) => b.offsetParent !== null && !(b.getAttribute("aria-label") || b.getAttribute("aria-labelledby") || b.textContent?.trim()))
        .map((b) => b.outerHTML.slice(0, 80)),
    );
    expect(unnamed).toEqual([]);
    await settledAxe(p, `home with both panels (${theme})`);

    await essayCard.getByRole("button", { name: "Essay draft", exact: true }).click();
    await expect(p.getByTestId("task-details")).toBeVisible();
    await settledAxe(p, `task details (${theme})`);
    await p.getByTestId("task-details").getByRole("button", { name: "Back to tasks" }).click();

    await essayCard.getByRole("button", { name: /^Quick notes/ }).click();
    await expect(p.getByRole("dialog", { name: /Quick notes/ })).toBeVisible();
    await settledAxe(p, `quick notes (${theme})`);
    await p.keyboard.press("Escape");

    await tasksPanel.getByRole("button", { name: /^Filter/ }).click();
    await expect(p.getByRole("dialog", { name: "Task filters" })).toBeVisible();
    await settledAxe(p, `filter popover (${theme})`);
    await p.keyboard.press("Escape");

    await tasksPanel.getByRole("button", { name: `Column actions for ${columns[0].name}` }).click();
    await p.getByRole("menuitem", { name: /^Delete/ }).click();
    const dialog = p.getByRole("alertdialog", { name: `Delete “${columns[0].name}”?` });
    await expect(dialog).toBeVisible();
    await settledAxe(p, `delete column dialog (${theme})`);
    await p.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    // both rails
    await p.locator("#close-tasks").click();
    await expect(p.locator("[data-rail=tasks]")).toBeVisible();
    await settledAxe(p, `Tasks rail (${theme})`);
    await p.locator("#show-tasks").click();
    await p.locator("#close-calendar").click();
    await expect(p.locator("[data-rail=calendar]")).toBeVisible();
    await settledAxe(p, `Calendar rail (${theme})`);
    await p.locator("#show-calendar").click();
    await expect(p.locator("#calendar-panel")).toBeVisible();
  }

  await homeScreens(testInfo.project.name.includes("dark") ? "dark" : "light");
  if (!testInfo.project.name.includes("dark")) {
    await p.goto("/settings/appearance");
    await p.getByRole("button", { name: "New theme…" }).click();
    await p.getByRole("dialog").getByRole("textbox", { name: "Name" }).fill("Tasks a11y");
    await p.getByRole("button", { name: "Create and edit" }).click();
    await p.getByRole("button", { name: "Save theme" }).click();
    await p.getByRole("radio", { name: /Tasks a11y/ }).click();
    await homeScreens("user theme");
    await call("PATCH", "/api/v1/preferences", { theme: "system" });
  }
  await ctx.close();
});
