import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { newHierarchy, seedClass, signIn, tag } from "./helpers";
import { textPdf } from "./pdf-fixtures";

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
  const panel = page.getByRole("complementary", { name: "Audio" });
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
