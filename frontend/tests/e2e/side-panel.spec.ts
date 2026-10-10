import { expect, test } from "@playwright/test";
import { signIn, tag } from "./helpers";
import { seedCourse, workspaceUrl } from "./notes-helpers";

test("Side panel: courses, notes, documents and sessions are collapsible, resizable sections; resizable side panel", async ({ page }, testInfo) => {
  const t = tag(testInfo.project.name);
  const shot = async (name: string) => {
    if (testInfo.project.name.endsWith("light")) await page.screenshot({ path: testInfo.outputPath(`${name}.png`) });
  };
  await signIn(page);
  const { courseId, lineageId } = await seedCourse(page, `SIDE${t} 101`);
  await page.goto(workspaceUrl(courseId, lineageId, "2026-10-05"));

  const side = page.getByRole("complementary", { name: "Side panel" });
  const years = side.getByRole("region", { name: "Courses" });
  const notes = side.getByRole("region", { name: "Notes" });
  const docs = side.getByRole("region", { name: "Documents" });
  const sessions = side.getByRole("region", { name: "Sessions" });
  await expect(years.getByRole("navigation", { name: "Courses" })).toBeVisible();
  await expect(notes.getByRole("button", { name: "New note" })).toBeVisible();
  await expect(docs.getByRole("button", { name: "Upload PDF" })).toBeVisible();
  await expect(sessions.getByRole("navigation", { name: "Sessions of this course" })).toBeVisible();

  // long section content scrolls inside the panel, never the page
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true);

  // the edge between two open sections resizes them; it starts in the middle
  const splitter = page.getByRole("separator", { name: "Resize notes" });
  await expect(splitter).toHaveAttribute("aria-valuenow", "50");
  await splitter.hover();
  await shot("section-splitter-hover");
  await splitter.focus();
  await page.keyboard.press("ArrowUp");
  await expect(splitter).toHaveAttribute("aria-valuenow", "55");

  // each header collapses and expands its section
  for (const [region, name] of [[years, "Courses"], [notes, "Notes"], [docs, "Documents"], [sessions, "Sessions"]] as const) {
    const header = region.getByRole("button", { name, exact: true });
    await header.click();
    await expect(header).toHaveAttribute("aria-expanded", "false");
    await header.click();
    await expect(header).toHaveAttribute("aria-expanded", "true");
  }
  const notesHeader = notes.getByRole("button", { name: "Notes", exact: true });
  await notesHeader.click();
  await expect(notes.getByRole("button", { name: "New note" })).toBeHidden();
  await expect(splitter).toHaveCount(0);
  await shot("section-collapsed");
  await notesHeader.click();
  await expect(splitter).toHaveAttribute("aria-valuenow", "55"); // size remembered

  // the side panel resizes like the audio panel
  const panelEdge = page.getByRole("separator", { name: "Resize course panel" });
  const width = Number(await panelEdge.getAttribute("aria-valuenow"));
  const edge = (await panelEdge.boundingBox())!;
  await page.mouse.move(edge.x + edge.width / 2, edge.y + 200);
  await page.mouse.down();
  await page.mouse.move(edge.x + edge.width / 2 + 80, edge.y + 200, { steps: 5 });
  await page.mouse.up();
  await expect(panelEdge).toHaveAttribute("aria-valuenow", String(width + 80));
  await panelEdge.dblclick();
  await expect(panelEdge).toHaveAttribute("aria-valuenow", "280");

  // Alt+[ collapses and expands the workspace's sections together; [ hides the panel
  const headers = [notesHeader, docs.getByRole("button", { name: "Documents", exact: true }), sessions.getByRole("button", { name: "Sessions", exact: true })];
  await page.keyboard.press("Alt+[");
  for (const h of headers) await expect(h).toHaveAttribute("aria-expanded", "false");
  await expect(years.getByRole("button", { name: "Courses" })).toHaveAttribute("aria-expanded", "true");
  // "[" closes the panel to its rail (008 FR-011); Alt+[ brings it back with the sections open
  await page.keyboard.press("[");
  await expect(side.getByRole("button", { name: "Show side panel" })).toBeVisible();
  await expect(years).toBeHidden();
  await page.keyboard.press("Alt+[");
  await expect(years).toBeVisible();
  for (const h of headers) await expect(h).toHaveAttribute("aria-expanded", "true");
  await shot("restored");
});
