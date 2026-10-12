import { expect, test, type Locator, type Page } from "@playwright/test";
import { openSession, reader, status, uploadPdf } from "./documents-helpers";
import { signIn } from "./helpers";
import { annotatedPdf, imageOnlyPdf, textPdf } from "./pdf-fixtures";

test.use({ viewport: { width: 1600, height: 1000 } });

const saveState = (r: Locator) => r.getByTestId("annotation-save");
const item = (r: Locator, name: RegExp) => r.getByRole("button", { name });
const tool = (r: Locator, name: string) => r.getByRole("radio", { name });

async function openPdf(page: Page, docs: Locator, file: string, buffer: Buffer) {
  await uploadPdf(page, file, buffer);
  const name = file.replace(/\.pdf$/, "");
  await docs.getByRole("button", { name: new RegExp(`^${name}`) }).click();
  await expect(status(page)).toHaveText(/Page 1 of/, { timeout: 15000 });
  const r = reader(page, name);
  await expect(tool(r, "Draw")).toBeEnabled();
  return r;
}

/** The PDF's id and its bytes as the server has them now. */
async function pdfBytes(page: Page, url: string, name: string) {
  const key = decodeURIComponent(url.split("/sessions/")[1]);
  const docs = await (await page.request.get(`/api/v1/sessions/${encodeURIComponent(key)}/documents`)).json();
  const doc = docs.find((d: { name: string }) => d.name === name);
  return (await page.request.get(`/api/v1/documents/${doc.id}/file`)).body();
}

/** Select the first line of textPdf's page ("<label> - page N" at 72 pt, baseline 720 pt) by dragging over it. */
async function selectFirstLine(page: Page, pageNumber = 1) {
  const frame = page.locator(`[id^=workspace-pane-] .page[data-page-number='${pageNumber}']`);
  await expect(frame.locator(".uh-page-base")).toBeVisible();
  const box = (await frame.boundingBox())!;
  const at = (x: number, y: number) => [box.x + (x / 612) * box.width, box.y + ((792 - y) / 792) * box.height] as const;
  await page.mouse.move(...at(73, 725));
  await page.mouse.down();
  await page.mouse.move(...at(400, 725), { steps: 30 });
  await page.mouse.up();
}

test("US6: every tool by pointer; saved within 2 s; back after reload and in another browser; PDF unchanged", async ({ page, browser }, testInfo) => {
  const { docs, url } = await openSession(page, testInfo, "ANNA ");
  const original = textPdf(3);
  const r = await openPdf(page, docs, "Notes.pdf", original);
  const surface = r.locator(".page[data-page-number='1'] .uh-annot-surface");
  const box = (await surface.boundingBox())!;

  // Highlight: the selected text
  await selectFirstLine(page);
  await tool(r, "Highlight").click();
  await expect(item(r, /^Highlight, page 1: ‘Lecture notes - page 1’, Yellow$/)).toBeVisible();

  // Draw
  await tool(r, "Draw").click();
  await page.mouse.move(box.x + 100, box.y + 300);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + 100 + i * 15, box.y + 300 + (i % 2) * 20);
  await page.mouse.up();
  await expect(item(r, /^Drawing, page 1/)).toBeVisible();

  // Text box
  await tool(r, "Text").click();
  await page.mouse.click(box.x + 120, box.y + 420);
  await r.getByRole("textbox", { name: "New text box on page 1" }).fill("exam!");
  await page.keyboard.press("Escape");
  await expect(item(r, /^Text box, page 1: exam!/)).toBeVisible();

  // Comment, in another colour
  await tool(r, "Comment").click();
  await r.getByRole("button", { name: /^Colour: / }).click();
  await page.getByRole("menuitem", { name: "Purple" }).click();
  await expect(page.getByRole("menu")).toBeHidden(); // the menu blocks the pointer while it closes
  await page.mouse.click(box.x + 400, box.y + 200);
  await r.getByRole("textbox", { name: "New comment on page 1" }).fill("why O(log n)?");
  await page.keyboard.press("Escape");
  await expect(item(r, /^Comment, page 1: why O\(log n\)\?, Purple$/)).toBeVisible();

  const t0 = Date.now();
  await expect(saveState(r)).toHaveText("Saved", { timeout: 4000 });
  expect(Date.now() - t0).toBeLessThan(3000); // FR-028: within 2 s of the last change (+ request)

  // the PDF is byte-for-byte what was uploaded (Constitution II)
  expect(Buffer.compare(await pdfBytes(page, url, "Notes"), original)).toBe(0);

  await page.reload();
  const again = reader(page, "Notes");
  await expect(again.locator("[data-annotation]")).toHaveCount(4, { timeout: 15000 });

  const other = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page2 = await other.newPage();
  await signIn(page2);
  await page2.goto(url);
  await page2.getByRole("region", { name: "Documents" }).getByRole("button", { name: /^Notes/ }).click();
  await expect(reader(page2, "Notes").locator("[data-annotation]")).toHaveCount(4, { timeout: 15000 });
  await expect(item(reader(page2, "Notes"), /^Text box, page 1: exam!/)).toBeVisible();
  await other.close();
});

test("US6: by keyboard — highlight, text box, comment, select, move, recolour, delete, undo/redo", async ({ page }, testInfo) => {
  const { docs } = await openSession(page, testInfo, "ANNB ");
  const r = await openPdf(page, docs, "Keys.pdf", textPdf(2));

  // highlight: a selection, then the Highlight button by keyboard
  await selectFirstLine(page);
  await expect(tool(r, "Highlight")).toBeEnabled();
  await tool(r, "Select").focus();
  await page.keyboard.press("ArrowRight"); // roving focus moves to Highlight
  await page.keyboard.press("Space");
  await expect(item(r, /^Highlight, page 1/)).toBeVisible();

  // text box and comment: choose the tool, then Enter on the pages
  await tool(r, "Text").focus();
  await page.keyboard.press("Space");
  await r.getByLabel("Pages", { exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.type("by keyboard");
  await page.keyboard.press("Escape");
  await expect(item(r, /^Text box, page 1: by keyboard/)).toBeVisible();
  await tool(r, "Comment").focus();
  await page.keyboard.press("Space");
  await r.getByLabel("Pages", { exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.type("typed note");
  await page.keyboard.press("Escape");
  const comment = item(r, /^Comment, page 1: typed note/);
  await expect(comment).toBeVisible();

  // select, move by arrows (Shift ×10), recolour with C, delete, undo, redo
  await tool(r, "Select").click();
  await comment.focus();
  const before = (await comment.boundingBox())!;
  await page.keyboard.press("Shift+ArrowRight");
  await expect.poll(async () => Math.round((await comment.boundingBox())!.x - before.x)).toBeGreaterThan(5);
  await page.keyboard.press("c");
  await page.getByRole("menuitem", { name: "Green" }).press("Enter");
  await expect(item(r, /^Comment, page 1: typed note, Green$/)).toBeVisible();
  await item(r, /^Comment, page 1: typed note/).focus();
  await page.keyboard.press("Delete");
  await expect(item(r, /^Comment, page 1/)).toHaveCount(0);
  await r.getByLabel("Pages", { exact: true }).focus();
  await page.keyboard.press("Control+z");
  await expect(item(r, /^Comment, page 1: typed note, Green$/)).toBeVisible();
  await page.keyboard.press("Control+Shift+z");
  await expect(item(r, /^Comment, page 1/)).toHaveCount(0);
  await r.getByRole("button", { name: "Undo" }).click();
  await expect(item(r, /^Comment, page 1/)).toHaveCount(1);
  await expect(saveState(r)).toHaveText("Saved", { timeout: 4000 });
});

test("US6: offline changes wait on the device; leaving warns; back online they are saved", async ({ page, context }, testInfo) => {
  const { docs } = await openSession(page, testInfo, "ANNC ");
  const r = await openPdf(page, docs, "Offline.pdf", textPdf(2));
  const box = (await r.locator(".page[data-page-number='1'] .uh-annot-surface").boundingBox())!;
  await context.setOffline(true);
  await tool(r, "Comment").click();
  await page.mouse.click(box.x + 200, box.y + 200);
  await r.getByRole("textbox", { name: "New comment on page 1" }).fill("written offline");
  await page.keyboard.press("Escape");
  await expect(saveState(r)).toHaveText("Not saved — retrying", { timeout: 5000 });
  const warned = await page.evaluate(() => {
    const e = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  });
  expect(warned).toBe(true);
  await context.setOffline(false);
  await expect(saveState(r)).toHaveText("Saved", { timeout: 20000 });
  await page.reload();
  await expect(item(reader(page, "Offline"), /^Comment, page 1: written offline/)).toBeVisible({ timeout: 15000 });
});

test("US6: two windows editing the same comment keep both versions", async ({ page, context }, testInfo) => {
  const { docs, url } = await openSession(page, testInfo, "ANND ");
  const r = await openPdf(page, docs, "Shared.pdf", textPdf(1));
  const box = (await r.locator(".page[data-page-number='1'] .uh-annot-surface").boundingBox())!;
  await tool(r, "Comment").click();
  await page.mouse.click(box.x + 200, box.y + 200);
  await r.getByRole("textbox", { name: "New comment on page 1" }).fill("start");
  await page.keyboard.press("Escape");
  await expect(saveState(r)).toHaveText("Saved", { timeout: 4000 });

  const page2 = await context.newPage();
  await page2.setViewportSize({ width: 1600, height: 1000 });
  await page2.goto(url);
  await page2.getByRole("region", { name: "Documents" }).getByRole("button", { name: /^Shared/ }).click();
  const r2 = reader(page2, "Shared");
  await expect(item(r2, /^Comment, page 1: start/)).toBeVisible({ timeout: 15000 });

  // window A changes it
  await tool(r, "Select").click();
  await item(r, /^Comment, page 1: start/).click();
  await r.page().getByRole("textbox", { name: "Comment on page 1" }).fill("from A");
  await page.keyboard.press("Escape");
  await expect(saveState(r)).toHaveText("Saved", { timeout: 4000 });

  // window B, still on the old version, changes it too
  await item(r2, /^Comment, page 1: start/).click();
  await page2.getByRole("textbox", { name: "Comment on page 1" }).fill("from B");
  await page2.keyboard.press("Escape");
  await expect(page2.getByText("This comment was changed in another window. Both versions are kept.")).toBeVisible({ timeout: 5000 });
  await expect(item(r2, /^Comment, page 1: from A/)).toBeVisible();
  await expect(item(r2, /^Comment, page 1: from B.*version kept from another window/)).toBeVisible();
  await page2.close();
});

test("US6: scanned PDFs can't be highlighted; a PDF's own annotations show but aren't ours", async ({ page }, testInfo) => {
  const { docs } = await openSession(page, testInfo, "ANNE ");
  const scan = await openPdf(page, docs, "Scan.pdf", imageOnlyPdf(2));
  await expect(tool(scan, "Highlight")).toBeDisabled();
  await expect(scan.getByText("This document has no selectable text, so text can't be highlighted.")).toBeVisible();
  await expect(tool(scan, "Draw")).toBeEnabled();

  const own = await openPdf(page, docs, "Marked.pdf", annotatedPdf());
  await expect(own.locator(".page[data-page-number='1'] .uh-page-base")).toBeVisible(); // drawn with the page
  await expect(own.locator("[data-annotation]")).toHaveCount(0);
});
