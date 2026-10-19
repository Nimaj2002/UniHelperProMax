import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { noteEditor, openNote } from "./diagrams-math-helpers";

const NOTE = [
  "Inline $E = mc^2$ and more text.",
  "$$\n\\int_0^1 x^2\\,dx\n$$",
  "```mermaid\nflowchart LR\n  accTitle: Build steps\n  accDescr: From commit to deploy\n  A[Commit] --> B[Deploy]\n```",
  "```mermaid\nsequenceDiagram\n  A->>B: hi\n```",
  '```mermaid\n%%{init: {"theme": "forest"}}%%\nflowchart LR\n  X --> Y\n```',
  "End.",
].join("\n\n");

/** axe on what this feature adds: diagrams and formulas (and their messages). */
async function axe(page: import("@playwright/test").Page) {
  const scan = await new AxeBuilder({ page })
    .include('[data-uh="diagram"]')
    .include('[data-uh="math-inline"]')
    .include('[data-uh="math-block"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  return scan.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`);
}

async function setTheme(page: import("@playwright/test").Page, theme: string) {
  const csrf = (await page.context().cookies()).find((c) => c.name === "uh_csrf")?.value ?? "";
  const r = await page.request.patch("/api/v1/preferences", { data: { theme }, headers: { "X-CSRF-Token": csrf } });
  expect(r.ok(), await r.text()).toBe(true);
}

test.afterEach(async ({ page }) => {
  await setTheme(page, "system").catch(() => {});
});

for (const theme of ["built-in", "custom"] as const) {
  test(`keyboard, screen readers and contrast (${theme} theme)`, async ({ page }, info) => {
    await openNote(page, info.project.name, NOTE);
    if (theme === "custom") {
      // a real custom theme (a preset), chosen the way Settings does: through the preferences
      const preset = info.project.name.includes("dark") ? "preset:dracula" : "preset:solarized-light";
      await setTheme(page, preset);
      await page.reload();
      await page.getByRole("tab", { name: /^Math note/ }).click();
      await expect(page.locator("html")).toHaveAttribute("style", /--accent/);
    }
    const ed = noteEditor(page);
    const diagrams = ed.locator('[data-uh="diagram"]');
    await expect(diagrams.nth(0)).toHaveAttribute("data-state", "drawn", { timeout: 15_000 });
    await expect(diagrams.nth(1)).toHaveAttribute("data-state", "drawn", { timeout: 15_000 });

    // names: a diagram's title, else "Diagram"; its description is linked
    await expect(page.getByRole("group", { name: "Build steps" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Build steps" })).toHaveAccessibleDescription("From commit to deploy");
    await expect(page.getByRole("group", { name: "Diagram", exact: true }).first()).toBeVisible();
    // formulas are readable math, with their LaTeX in the MathML
    await expect(ed.locator('[data-uh="math-inline"] math annotation')).toHaveText("E = mc^2");
    await expect(ed.locator('[data-uh="math-block"] math')).toHaveCount(1);

    // Tab reaches the display formula and each diagram, with a visible focus ring
    const block = ed.locator('[data-uh="math-block"]');
    await block.focus();
    await page.keyboard.press("Tab");
    await expect(diagrams.nth(0)).toBeFocused();
    // keyboard focus shows the ring
    expect(await diagrams.nth(0).evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe("none");
    await page.keyboard.press("Enter");
    await expect(ed.locator('textarea[data-uh="diagram-source"]')).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(diagrams.nth(0)).toBeFocused();

    expect(await axe(page)).toEqual([]);

    // the banner and the open dialog are accessible too
    const banner = page.locator('[data-uh="diagram-decision-banner"]');
    await expect(banner).toBeVisible();
    await banner.getByRole("button", { name: "Review" }).click();
    const dialog = page.getByRole("alertdialog", { name: "This note's diagrams ask for extra permissions" });
    await expect(dialog).toBeVisible();
    const dialogScan = await new AxeBuilder({ page }).include('[data-uh="diagram-decision"]').withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(dialogScan.violations.map((v) => v.id)).toEqual([]);
    await page.keyboard.press("Escape");
  });
}

test("reduced motion: nothing animates", async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openNote(page, info.project.name, NOTE);
  await expect(noteEditor(page).locator('[data-uh="diagram"]').first()).toHaveAttribute("data-state", "drawn", { timeout: 15_000 });
  await page.waitForTimeout(300);
  const running = await page.evaluate(() =>
    document.getAnimations().filter((a) => {
      const t = a.effect?.getComputedTiming();
      return a.playState === "running" && (t?.duration as number) > 1;
    }).length,
  );
  expect(running).toBe(0);
});
