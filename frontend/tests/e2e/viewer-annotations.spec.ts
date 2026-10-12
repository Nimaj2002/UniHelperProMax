import { expect, test, type Page } from "@playwright/test";
import { openSession, uploadPdf } from "./documents-helpers";
import { textPdf } from "./pdf-fixtures";

test.use({ viewport: { width: 1600, height: 1000 } });

/** The EmbedPDF viewer shown in the workspace pane: its annotation capability, via the element's registry. */
async function annotationCount(page: Page): Promise<number | null> {
  return page.evaluate(async () => {
    const el = document.querySelector("[id^=workspace-pane-] uh-pdf-viewer") as (HTMLElement & { registry?: Promise<unknown> }) | null;
    if (!el?.registry) return null;
    type Cap = { getAnnotations(): unknown[] };
    const registry = (await el.registry) as { getPlugin(id: string): { provides(): Cap } | null };
    const cap = registry.getPlugin("annotation")?.provides();
    return cap ? cap.getAnnotations().length : null;
  });
}

async function addSquare(page: Page) {
  await page.evaluate(async () => {
    const el = document.querySelector("[id^=workspace-pane-] uh-pdf-viewer") as HTMLElement & { registry: Promise<unknown> };
    type Cap = { createAnnotation(pageIndex: number, a: unknown): void };
    const registry = (await el.registry) as { getPlugin(id: string): { provides(): Cap } };
    registry.getPlugin("annotation").provides().createAnnotation(0, {
      type: 5, // square
      id: crypto.randomUUID(),
      pageIndex: 0,
      rect: { origin: { x: 100, y: 100 }, size: { width: 120, height: 60 } },
      flags: ["print"],
      color: "transparent",
      opacity: 1,
      strokeWidth: 2,
      strokeColor: "#e44234",
      strokeStyle: 1,
      created: new Date(),
    });
  });
}

async function savedItems(page: Page, name: string): Promise<number> {
  const docs = await (await page.request.get(`/api/v1/sessions/${encodeURIComponent(decodeURIComponent(page.url().split("/sessions/")[1]))}/documents`)).json();
  const doc = docs.find((d: { name: string }) => d.name === name);
  const body = await (await page.request.get(`/api/v1/documents/${doc.id}/viewer-annotations`)).json();
  return body.items.length;
}

test("viewer annotations are saved, kept across tab switches and back after reload", async ({ page }, testInfo) => {
  const { docs } = await openSession(page, testInfo, "VWA ");
  await uploadPdf(page, "First.pdf", textPdf(2));
  await uploadPdf(page, "Second.pdf", textPdf(2));

  await docs.getByRole("button", { name: /^First/ }).click();
  await expect.poll(() => annotationCount(page), { timeout: 20_000 }).toBe(0);
  await addSquare(page);
  await expect.poll(() => annotationCount(page)).toBe(1);
  await expect.poll(() => savedItems(page, "First"), { timeout: 10_000 }).toBe(1);

  // another tab, then back: the same viewer (not rebuilt from the file), annotation still there
  const viewerRoot = () =>
    page.evaluate(() => {
      const root = document.querySelector("[id^=workspace-pane-] uh-pdf-viewer")?.shadowRoot;
      const first = [...(root?.children ?? [])].find((c) => c.tagName !== "STYLE" && c.tagName !== "LINK") as (Element & { __uhMark?: number }) | undefined;
      if (first && !first.__uhMark) first.__uhMark = Math.random();
      return first?.__uhMark ?? null;
    });
  const mark = await viewerRoot();
  expect(mark).not.toBeNull();
  await docs.getByRole("button", { name: /^Second/ }).click();
  await expect.poll(() => annotationCount(page), { timeout: 20_000 }).toBe(0);
  await page.getByRole("tab", { name: /^First/ }).click();
  await expect.poll(() => annotationCount(page), { timeout: 20_000 }).toBe(1);
  expect(await viewerRoot()).toBe(mark);

  // reload: restored from the server, nothing duplicated
  await page.reload();
  await page.getByRole("tab", { name: /^First/ }).click();
  await expect.poll(() => annotationCount(page), { timeout: 20_000 }).toBe(1);
  await page.waitForTimeout(1500); // a restore must not save a second copy
  expect(await savedItems(page, "First")).toBe(1);
});
