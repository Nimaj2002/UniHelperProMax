import { statSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { openSession, reader, status, uploadPdf } from "./documents-helpers";
import { signIn } from "./helpers";
import { editor, newNote } from "./notes-helpers";
import { bigTextPdf, encryptedPdf, imageOnlyPdf, linkedPdf, textPdf } from "./pdf-fixtures";

// wide enough for split view (≥ 1100 px main area next to the side and audio panels)
test.use({ viewport: { width: 1920, height: 1080 } });

test("US3: open a PDF as a workspace tab; navigate, zoom, page field, dark pages", async ({ page }, testInfo) => {
  const { docs } = await openSession(page, testInfo, "DOCA ");
  await uploadPdf(page, "Lecture 5.pdf", textPdf(42));
  await docs.getByRole("button", { name: /^Lecture 5/ }).click();

  // exactly one new tab, in the workspace's tab bar; the reader has no tabs of its own (FR-011/012)
  await expect(page.getByRole("tab")).toHaveCount(1);
  await expect(page.getByRole("tab", { name: /^Lecture 5/ })).toHaveAttribute("aria-selected", "true");
  const r = reader(page, "Lecture 5");
  await expect(status(page)).toHaveText(/Page 1 of 42/, { timeout: 15000 });
  await expect(r.getByRole("tablist")).toHaveCount(0);
  await expect(r.locator(".page[data-page-number='1'] .textLayer")).toContainText("Lecture notes - page 1");

  await r.getByRole("button", { name: "Next page" }).click();
  await expect(status(page)).toHaveText(/Page 2 of 42/);
  await r.getByRole("button", { name: "Previous page" }).click();
  await expect(status(page)).toHaveText(/Page 1 of 42/);

  const field = r.getByRole("textbox", { name: /Page number/ });
  await field.fill("999");
  await field.press("Enter");
  await expect(status(page)).toHaveText("Page 42 of 42. There are 42 pages — showing page 42.");
  await expect(field).toHaveValue("42");

  const fit = r.getByRole("button", { name: "Fit width" });
  await expect(fit).toHaveAttribute("aria-pressed", "true");
  await r.getByRole("button", { name: "Zoom in" }).click();
  await expect(fit).toHaveAttribute("aria-pressed", "false");
  await r.getByRole("button", { name: "Zoom out" }).click();
  await r.getByRole("button", { name: "Zoom out" }).click();
  const zoom = await r.getByLabel(/^Zoom \d+ %$/).textContent();
  await fit.click();
  await expect(r.getByLabel(/^Zoom \d+ %$/)).not.toHaveText(zoom ?? "");

  // keyboard inside the reader: Home/End, Ctrl+0
  await r.getByLabel("Pages", { exact: true }).focus();
  await page.keyboard.press("Home");
  await expect(status(page)).toHaveText(/Page 1 of 42/);
  await page.keyboard.press("PageDown");
  await expect(status(page)).toHaveText(/Page 2 of 42/);
  await page.keyboard.press("Control+0");
  await expect(r.getByLabel("Zoom 100 %")).toBeVisible();

  // dark pages: on, the page stays; remembered across reload. One project only: both projects
  // share the owner account, whose preference this changes.
  if (!testInfo.project.name.includes("dark")) {
    const dark = r.getByRole("button", { name: "Dark pages" });
    await dark.click();
    await expect(dark).toHaveAttribute("aria-pressed", "true");
    await expect(r.locator(".page[data-page-number='2'] canvas")).toBeVisible();
    await expect(status(page)).toHaveText(/Page 2 of 42/);
    await page.reload();
    await expect(reader(page, "Lecture 5").getByRole("button", { name: "Dark pages" })).toHaveAttribute("aria-pressed", "true", { timeout: 15000 });
    await expect(status(page)).toHaveText(/Page 2 of 42/, { timeout: 15000 }); // US4: remembered page
    await reader(page, "Lecture 5").getByRole("button", { name: "Dark pages" }).click();
    await expect(reader(page, "Lecture 5").getByRole("button", { name: "Dark pages" })).toHaveAttribute("aria-pressed", "false");
    await expect(status(page)).toHaveText(/Page 2 of 42/);
  }

  // Escape leaves the reader for the tab bar
  await reader(page, "Lecture 5").getByLabel("Pages", { exact: true }).focus();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tab", { name: /^Lecture 5/ })).toBeFocused();
});

test("US3: split view — PDF left, note right; typing keeps the reader's page; restored on reload", async ({ page }, testInfo) => {
  const { docs } = await openSession(page, testInfo, "DOCB ");
  await uploadPdf(page, "Slides.pdf", textPdf(30, "Slides"));
  await newNote(page, "Questions");
  await docs.getByRole("button", { name: /^Slides/ }).click();
  await expect(status(page)).toHaveText(/Page 1 of 30/, { timeout: 15000 });
  const field = reader(page, "Slides").getByRole("textbox", { name: /Page number/ });
  await field.fill("10");
  await field.press("Enter");
  await expect(status(page)).toHaveText(/Page 10 of 30/);

  await page.keyboard.press("Alt+Backslash");
  const split = page.getByRole("button", { name: "Split" });
  await expect(split).toHaveAttribute("aria-pressed", "true");
  const left = page.locator("#workspace-pane-left");
  const right = page.locator("#workspace-pane-right");
  await expect(left.getByRole("region", { name: "Slides — PDF" })).toBeVisible();
  await expect(right.getByRole("textbox", { name: /^Questions/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /^Slides\s+shown in left pane/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /^Questions\s+shown in right pane/ })).toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(2); // all tabs stay open

  const pages = left.getByLabel("Pages", { exact: true });
  const scrollBefore = await pages.evaluate((el) => el.scrollTop);
  await right.locator(".cm-content").click();
  for (let i = 0; i < 10; i++) await page.keyboard.type(`Question ${i}: why is the tree balanced? `, { delay: 5 });
  await expect(right.locator(".cm-content")).toContainText("Question 9");
  await expect(status(page)).toHaveText(/Page 10 of 30/);
  expect(await pages.evaluate((el) => el.scrollTop)).toBe(scrollBefore);
  await expect(page.getByRole("tab", { name: /^Questions/ })).toContainText("Saved", { timeout: 5000 });

  // reload: split, panes and the note's text come back
  await page.waitForTimeout(700); // workspace state is saved after 500 ms
  await page.reload();
  await expect(page.getByRole("button", { name: "Split" })).toHaveAttribute("aria-pressed", "true", { timeout: 15000 });
  await expect(left.getByRole("region", { name: "Slides — PDF" })).toBeVisible();
  await expect(right.locator(".cm-content")).toContainText("Question 9");

  // move the PDF to the other pane via the tab menu; split off keeps both tabs; the reader
  // keeps its page throughout (the page across reloads is US4)
  const field2 = left.getByRole("textbox", { name: /Page number/ });
  await field2.fill("7");
  await field2.press("Enter");
  await expect(status(page)).toHaveText(/Page 7 of 30/);
  await page.getByRole("tab", { name: /^Slides/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Show in other pane" }).click();
  await expect(right.getByRole("region", { name: "Slides — PDF" })).toBeVisible();
  await expect(left.getByRole("textbox", { name: /^Questions/ })).toBeVisible();
  await expect(status(page)).toHaveText(/Page 7 of 30/);
  await page.getByRole("button", { name: "Split" }).click();
  await expect(page.locator("#workspace-pane-right")).toHaveCount(0);
  await expect(page.getByRole("tab")).toHaveCount(2);
  // split off shows only the active tab (the one last focused: the PDF), at its page
  await expect(left.getByRole("region", { name: "Slides — PDF" })).toBeVisible();
  await expect(status(page)).toHaveText(/Page 7 of 30/);
  await page.getByRole("tab", { name: /^Questions/ }).click();
  await expect(editor(page)).toBeVisible();
  await expect(editor(page)).toContainText("Question 9");
});

test("US3: protected PDFs show a message; internal links jump to their page", async ({ page }, testInfo) => {
  const { docs } = await openSession(page, testInfo, "DOCC ");
  await uploadPdf(page, "Secret.pdf", encryptedPdf());
  await expect(docs.getByRole("button", { name: /^Secret/ })).toContainText("Protected");
  await docs.getByRole("button", { name: /^Secret/ }).click();
  await expect(page.getByText("This PDF is password-protected and can't be opened in the app.", { exact: false })).toBeVisible();

  await uploadPdf(page, "Links.pdf", linkedPdf());
  await docs.getByRole("button", { name: /^Links/ }).click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(status(page)).toHaveText(/Page 1 of 3/, { timeout: 15000 });
  const r = reader(page, "Links");
  const external = r.locator(".annotationLayer a[href='https://example.edu/']");
  await expect(external).toHaveAttribute("target", "_blank");
  await expect(external).toHaveAttribute("rel", /noopener/);
  await r.locator(".page[data-page-number='1'] .annotationLayer a").first().click();
  await expect(status(page)).toHaveText(/Page 3 of 3/);
});

test("US4: the reader opens where I left off — after closing the tab and in another browser", async ({ page, browser }, testInfo) => {
  const { docs, url } = await openSession(page, testInfo, "DOCD ");
  await uploadPdf(page, "Book.pdf", textPdf(40, "Book"));
  await docs.getByRole("button", { name: /^Book/ }).click();
  await expect(status(page)).toHaveText(/Page 1 of 40/, { timeout: 15000 });
  const field = reader(page, "Book").getByRole("textbox", { name: /Page number/ });
  await field.fill("27");
  await field.press("Enter");
  await expect(status(page)).toHaveText(/Page 27 of 40/);

  // close the tab right away: the pending page is sent on close
  await page.getByRole("tab", { name: /^Book/ }).press("Delete");
  await expect(page.getByRole("tab")).toHaveCount(0);
  await docs.getByRole("button", { name: /^Book/ }).click();
  await expect(status(page)).toHaveText(/Page 27 of 40/, { timeout: 15000 });

  // another browser (same account): same page
  const other = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page2 = await other.newPage();
  await signIn(page2);
  await page2.goto(url);
  await page2.getByRole("region", { name: "Documents" }).getByRole("button", { name: /^Book/ }).click();
  await expect(status(page2)).toHaveText(/Page 27 of 40/, { timeout: 15000 });
  await other.close();
});

test("US5: search finds matches across pages; scanned PDFs say there is no text", async ({ page }, testInfo) => {
  const { docs } = await openSession(page, testInfo, "DOCE ");
  // "tree" on pages 1–3 (textPdf's second line) plus the label: 3 matches in 3 pages
  await uploadPdf(page, "Trees.pdf", textPdf(3, "Chapter"));
  await docs.getByRole("button", { name: /^Trees/ }).click();
  await expect(status(page)).toHaveText(/Page 1 of 3/, { timeout: 15000 });
  const r = reader(page, "Trees");
  await r.getByLabel("Pages", { exact: true }).focus();
  await page.keyboard.press("Control+f");
  const box = r.getByRole("searchbox", { name: "Search in document" });
  await expect(box).toBeFocused();
  await box.fill("tree");
  const result = r.getByTestId("search-status");
  await expect(result).toHaveText("1 of 3");
  await page.keyboard.press("Enter");
  await expect(result).toHaveText("2 of 3");
  await expect(status(page)).toHaveText(/Page 2 of 3/);
  await r.getByRole("button", { name: "Next match" }).click();
  await expect(result).toHaveText("3 of 3");
  await expect(status(page)).toHaveText(/Page 3 of 3/);
  await box.press("Shift+Enter"); // the button kept focus after the click
  await expect(result).toHaveText("2 of 3");
  await expect(r.locator(".textLayer .highlight.selected")).toHaveCount(1);
  await box.fill("graph");
  await expect(result).toHaveText("No matches");
  await page.keyboard.press("Escape");
  await expect(box).toHaveCount(0);

  await uploadPdf(page, "Scan.pdf", imageOnlyPdf(2));
  await docs.getByRole("button", { name: /^Scan/ }).click();
  const scan = reader(page, "Scan");
  await expect(scan.getByTestId("reader-status")).toHaveText(/Page 1 of 2/, { timeout: 15000 });
  await scan.getByLabel("Pages", { exact: true }).focus();
  await page.keyboard.press("Control+f");
  await scan.getByRole("searchbox", { name: "Search in document" }).fill("tree");
  await expect(scan.getByTestId("search-status")).toHaveText("This document has no searchable text.");
});

test("US7: rename an annotated document; delete it after confirmation", async ({ page }, testInfo) => {
  const { docs } = await openSession(page, testInfo, "DOCF ");
  await uploadPdf(page, "Old name.pdf", textPdf(2));
  await docs.getByRole("button", { name: /^Old name/ }).click();
  await expect(status(page)).toHaveText(/Page 1 of 2/, { timeout: 15000 });
  const r = reader(page, "Old name");
  await r.getByRole("radio", { name: "Comment" }).click();
  const box = (await r.locator(".page[data-page-number='1'] .uh-annot-surface").boundingBox())!;
  await page.mouse.click(box.x + 200, box.y + 200);
  await r.getByRole("textbox", { name: "New comment on page 1" }).fill("still here");
  await page.keyboard.press("Escape");
  await expect(r.getByTestId("annotation-save")).toHaveText("Saved", { timeout: 4000 });

  await docs.getByRole("button", { name: "Actions for Old name" }).click();
  await page.getByRole("menuitem", { name: "Rename…" }).click();
  const dialog = page.getByRole("dialog", { name: "Rename document" });
  await dialog.getByLabel("Document name").fill("New name");
  await dialog.getByRole("button", { name: "Rename" }).click();
  await expect(dialog).toBeHidden();
  await expect(docs.getByRole("button", { name: /^New name/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /^New name/ })).toBeVisible();
  await page.reload();
  await expect(reader(page, "New name").getByRole("button", { name: /^Comment, page 1: still here/ })).toBeVisible({ timeout: 15000 });

  await page.getByRole("region", { name: "Documents" }).getByRole("button", { name: "Actions for New name" }).click();
  await page.getByRole("menuitem", { name: "Delete…" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Delete “New name”?" });
  await expect(confirm).toContainText("Its annotation is deleted too.");
  await confirm.getByRole("button", { name: "Delete document" }).click();
  await expect(page.getByText("Deleted “New name”.")).toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Documents" }).getByText("No documents yet.")).toBeVisible();
});

/** The reader's code is fetched in the background once a session lists documents. */
async function readerPrefetched(page: Page) {
  await page.waitForFunction(() => performance.getEntriesByType("resource").some((e) => e.name.includes("PdfReader")));
  await page.waitForLoadState("networkidle");
}

test.describe("performance (SC-003, SC-004)", () => {
  test.skip(({ colorScheme }) => colorScheme === "dark", "one colour scheme is enough for timings");

  test("a 100-page ~20 MB PDF shows its first page within 2 s; page changes within 1 s", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const { docs } = await openSession(page, testInfo, "PERFA ");
    const file = testInfo.outputPath("big.pdf");
    writeFileSync(file, bigTextPdf(100, 200_000));
    await page.getByTestId("upload-pdf-input").setInputFiles(file);
    await expect(page.getByText("Uploaded “big.pdf”")).toBeVisible({ timeout: 60_000 });
    await readerPrefetched(page);
    const started = Date.now();
    await docs.getByRole("button", { name: /^big/ }).click();
    const r = reader(page, "big");
    await expect(r.locator(".page[data-page-number='1'] canvas")).toBeVisible({ timeout: 10_000 });
    await expect(status(page)).toHaveText(/Page 1 of 100/);
    expect(Date.now() - started).toBeLessThanOrEqual(2000);
    await expect(r.getByRole("button", { name: "Next page" })).toBeEnabled();
    for (const target of [2, 50, 99]) {
      const t0 = Date.now();
      const field = r.getByRole("textbox", { name: /Page number/ });
      await field.fill(String(target));
      await field.press("Enter");
      await expect(r.locator(`.page[data-page-number='${target}'] canvas`)).toBeVisible();
      expect(Date.now() - t0, `page ${target}`).toBeLessThanOrEqual(1000);
    }
  });

  test("search over 300 pages finishes within 3 s", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const { docs } = await openSession(page, testInfo, "PERFB ");
    await uploadPdf(page, "paper.pdf", bigTextPdf(300));
    await docs.getByRole("button", { name: /^paper/ }).click();
    await expect(status(page)).toHaveText(/Page 1 of 300/, { timeout: 15_000 });
    const r = reader(page, "paper");
    await r.getByLabel("Pages", { exact: true }).focus();
    await page.keyboard.press("Control+f");
    const t0 = Date.now();
    await r.getByRole("searchbox", { name: "Search in document" }).fill("tree");
    await expect(r.getByTestId("search-status")).toHaveText(/of 3$/, { timeout: 10_000 });
    expect(Date.now() - t0).toBeLessThanOrEqual(3000);
  });

  test("a 150 MB PDF shows its first page from range requests before the whole file has arrived", async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    const { docs } = await openSession(page, testInfo, "PERFC ");
    const file = testInfo.outputPath("huge.pdf");
    writeFileSync(file, bigTextPdf(300, 500_000));
    expect(statSync(file).size).toBeGreaterThan(150_000_000);
    await page.getByTestId("upload-pdf-input").setInputFiles(file);
    await expect(page.getByText("Uploaded “huge.pdf”")).toBeVisible({ timeout: 240_000 });
    await readerPrefetched(page);
    let partial = 0;
    let wholeArrived = false;
    page.on("requestfinished", async (req) => {
      if (!/\/documents\/[^/]+\/file$/.test(req.url())) return;
      if (req.headers()["range"]) partial++;
      else wholeArrived = true;
    });
    await docs.getByRole("button", { name: /^huge/ }).click();
    await expect(reader(page, "huge").locator(".page[data-page-number='1'] canvas")).toBeVisible({ timeout: 15_000 });
    expect(partial).toBeGreaterThan(0);
    expect(wholeArrived).toBe(false);
  });
});
