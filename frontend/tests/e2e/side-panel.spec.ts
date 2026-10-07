import { expect, test } from "@playwright/test";
import { signIn, tag } from "./helpers";
import { seedCourse, workspaceUrl } from "./notes-helpers";

test("Workspace notes and sessions sit under the courses: collapsible, resizable section; resizable side panel", async ({ page }, testInfo) => {
  const t = tag(testInfo.project.name);
  const shot = async (name: string) => {
    if (testInfo.project.name.endsWith("light")) await page.screenshot({ path: testInfo.outputPath(`${name}.png`) });
  };
  await signIn(page);
  const { courseId, lineageId } = await seedCourse(page, `SIDE${t} 101`);
  await page.goto(workspaceUrl(courseId, lineageId, "2026-10-05"));

  const side = page.getByRole("complementary", { name: "Side panel" });
  const section = side.getByRole("region", { name: "Sessions and notes" });
  await expect(side.getByRole("navigation", { name: "Courses" })).toBeVisible();
  await expect(section.getByRole("navigation", { name: "Sessions of this course" })).toBeVisible();
  await expect(section.getByRole("button", { name: "New note" })).toBeVisible();

  // long section content scrolls inside the panel, never the page
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true);

  // starts in the middle of the panel
  const splitter = page.getByRole("separator", { name: "Resize sessions and notes" });
  await expect(splitter).toHaveAttribute("aria-valuenow", "50");
  const ratio = async () => (await section.boundingBox())!.height / (await side.boundingBox())!.height;
  expect(await ratio()).toBeCloseTo(0.5, 1);
  await splitter.hover();
  await shot("section-splitter-hover");

  // move the section up and down: keyboard and pointer
  await splitter.focus();
  await page.keyboard.press("ArrowUp");
  await expect(splitter).toHaveAttribute("aria-valuenow", "55");
  const box = (await splitter.boundingBox())!;
  const sideBox = (await side.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + sideBox.height * 0.2, { steps: 5 });
  await page.mouse.up();
  await expect(splitter).toHaveAttribute("aria-valuenow", "35");
  expect(await ratio()).toBeCloseTo(0.35, 1);

  // the header collapses and expands the section; Alt+[ does the same
  const header = section.getByRole("button", { name: "Sessions and notes" });
  await header.click();
  await expect(header).toHaveAttribute("aria-expanded", "false");
  await expect(section.getByRole("navigation", { name: "Sessions of this course" })).toBeHidden();
  await expect(splitter).toHaveCount(0);
  await shot("section-collapsed");
  await page.keyboard.press("Alt+BracketLeft");
  await expect(header).toHaveAttribute("aria-expanded", "true");
  await expect(splitter).toHaveAttribute("aria-valuenow", "35"); // size remembered

  // the side panel resizes like the audio panel
  const panelEdge = page.getByRole("separator", { name: "Resize course panel" });
  await panelEdge.hover();
  await shot("side-panel-edge-hover");
  const width = Number(await panelEdge.getAttribute("aria-valuenow"));
  const edge = (await panelEdge.boundingBox())!;
  await page.mouse.move(edge.x + edge.width / 2, edge.y + 200);
  await page.mouse.down();
  await page.mouse.move(edge.x + edge.width / 2 + 80, edge.y + 200, { steps: 5 });
  await page.mouse.up();
  await expect(panelEdge).toHaveAttribute("aria-valuenow", String(width + 80));
  expect(Math.round((await side.boundingBox())!.width)).toBe(width + 80);
  await panelEdge.dblclick();
  await expect(panelEdge).toHaveAttribute("aria-valuenow", "280");

  // no header toggle on desktop (the section collapses from its own header); Alt+[ still works
  await expect(page.getByRole("button", { name: /^(Hide|Show) sessions and notes$/ })).toHaveCount(0);
  await page.keyboard.press("Alt+[");
  await expect(header).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("[");
  await expect(side).toBeHidden();
  await page.keyboard.press("Alt+[");
  await expect(side).toBeVisible();
  await expect(header).toHaveAttribute("aria-expanded", "true");
  await shot("restored");
});
