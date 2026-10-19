import { expect, test } from "@playwright/test";
import { noteEditor, openNote } from "./diagrams-math-helpers";

/** 20 diagrams and 200 formulas, with plain paragraphs between them (SC-005). */
function bigNote() {
  const parts: string[] = ["# Long lecture\n\nAnchor paragraph at the top."];
  for (let i = 0; i < 20; i++) {
    parts.push(`Section ${i}: ` + Array.from({ length: 10 }, (_, j) => `$x_{${i}} + ${j}^2$`).join(", ") + ".");
    parts.push("```mermaid\nflowchart LR\n" + Array.from({ length: 6 }, (_, j) => `  N${i}_${j}[Step ${j}] --> N${i}_${j + 1}`).join("\n") + "\n```");
  }
  parts.push("Typing happens here.");
  return parts.join("\n\n") + "\n";
}

async function keystrokeLatencies(page: import("@playwright/test").Page, count: number) {
  await page.evaluate(() => {
    const w = window as unknown as { __lat: number[] };
    w.__lat = [];
    document.addEventListener(
      "beforeinput",
      (e) => {
        const start = e.timeStamp;
        requestAnimationFrame(() => requestAnimationFrame((t) => w.__lat.push(t - start)));
      },
      true,
    );
  });
  for (let i = 0; i < count; i++) await page.keyboard.type("k");
  await page.waitForTimeout(200);
  return page.evaluate(() => (window as unknown as { __lat: number[] }).__lat);
}

test("typing stays fast with 20 diagrams and 200 formulas; the theme switches in under 1 s", async ({ page }, info) => {
  test.setTimeout(120_000);
  await openNote(page, info.project.name, bigNote());
  const ed = noteEditor(page);
  await expect(ed.locator('[data-uh="math-inline"]')).toHaveCount(200);
  await expect(ed.locator('[data-uh="diagram"]')).toHaveCount(20);

  // type in the middle while diagrams are still being drawn
  await ed.getByText("Section 3:").click();
  await page.keyboard.press("Home");
  const lat = await keystrokeLatencies(page, 50);
  lat.sort((a, b) => a - b);
  const p95 = lat[Math.floor(lat.length * 0.95)];
  info.annotations.push({ type: "keystroke-p95-ms", description: p95.toFixed(1) });
  // two frames are included in each measurement, so allow one 60 Hz frame on top of 50 ms
  expect(p95).toBeLessThan(50 + 17);

  // theme switch: visible diagrams take the new colours within 1 s (SC-007)
  const first = ed.locator('[data-uh="diagram"]').first();
  await first.scrollIntoViewIfNeeded();
  await expect(first).toHaveAttribute("data-state", "drawn", { timeout: 15_000 });
  const fillOf = () => first.locator("svg .node rect, svg .node polygon").first().evaluate((el) => getComputedStyle(el).fill);
  const before = await fillOf();
  const t0 = Date.now();
  await page.evaluate(() => {
    const root = document.documentElement;
    root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
  });
  await expect.poll(fillOf, { timeout: 1000, intervals: [25] }).not.toBe(before);
  info.annotations.push({ type: "theme-switch-ms", description: String(Date.now() - t0) });

  // a custom theme colour as well
  const before2 = await fillOf();
  await page.evaluate(() => document.documentElement.style.setProperty("--surface-sunken", "#3a2f5b"));
  await expect.poll(fillOf, { timeout: 1000, intervals: [25] }).not.toBe(before2);
});

test("a diagram seen before doesn't move the text when it is drawn again (SC-010)", async ({ page }, info) => {
  const md = "Top line.\n\n```mermaid\nflowchart TD\n  A --> B --> C --> D --> E\n```\n\nReading this line.\n";
  await openNote(page, info.project.name, md);
  const ed = noteEditor(page);
  await expect(ed.locator('[data-uh="diagram"]')).toHaveAttribute("data-state", "drawn", { timeout: 15_000 });
  await page.waitForTimeout(300);
  // open the same note again: the reserved height is the drawn height, so nothing jumps
  await page.reload();
  await page.getByRole("tab", { name: /^Math note/ }).click();
  const line = ed.getByText("Reading this line.");
  await expect(line).toBeVisible();
  const before = (await line.boundingBox())!.y;
  await expect(ed.locator('[data-uh="diagram"]')).toHaveAttribute("data-state", "drawn", { timeout: 15_000 });
  const after = (await line.boundingBox())!.y;
  info.annotations.push({ type: "shift-px", description: String(after - before) });
  expect(Math.abs(after - before)).toBeLessThanOrEqual(2);
});
