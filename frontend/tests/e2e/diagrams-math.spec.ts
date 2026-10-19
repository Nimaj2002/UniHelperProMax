import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { fixture, lastCourse, noteEditor, noteFile, noteFilePath, openNote, waitSaved } from "./diagrams-math-helpers";

const SLICES_OBSIDIAN_01 = [
  "$A \\in \\mathbb{R}^{n \\times n}$",
  "$A\\mathbf{v} = \\lambda \\mathbf{v}$",
  "$$\\det(A - \\lambda I) = 0$$",
  "$\\operatorname{tr}(A) = \\sum_i \\lambda_i$",
  "```mermaid\nmindmap\n  root((Linear algebra))\n    Vectors\n    Matrices\n      Eigen\n```",
];

test.describe("raw mode and saving (US3)", () => {
  test("raw mode shows exact source, and editing elsewhere keeps formulas exact", async ({ page }, info) => {
    const id = await openNote(page, info.project.name, fixture("obsidian-01-mixed.md"));
    await page.getByRole("radio", { name: /source/i }).click();
    const source = page.locator(".cm-content").first();
    for (const s of SLICES_OBSIDIAN_01.slice(0, 3)) await expect(source).toContainText(s);

    await page.getByRole("radio", { name: /rich text/i }).click();
    const heading = noteEditor(page).getByRole("heading", { name: "Linear algebra" });
    await heading.click();
    await page.keyboard.press("End");
    await page.keyboard.type(" (week 4)");
    await expect(heading).toContainText("(week 4)");
    await expect.poll(() => noteFile(page, id), { timeout: 10_000 }).toContain("# Linear algebra (week 4)");
    await waitSaved(page);
    const saved = await noteFile(page, id);
    for (const s of SLICES_OBSIDIAN_01) expect(saved).toContain(s);
  });
});

test.describe("math (US2)", () => {
  test("inline and display formulas draw; ordinary dollars stay text", async ({ page }, info) => {
    await openNote(
      page,
      info.project.name,
      "The energy $E = mc^2$ is here.\n\n$$\n\\int_0^1 x^2 \\, dx\n$$\n\n$$x = \\frac{-b}{2a}$$\n\nit costs $5 and $10, a lone $ and `$x$` code.\n",
    );
    const ed = noteEditor(page);
    await expect(ed.locator('[data-uh="math-inline"][data-state="drawn"]')).toHaveCount(1);
    await expect(ed.locator('[data-uh="math-block"][data-state="drawn"]')).toHaveCount(2);
    await expect(ed.locator('[data-uh="math-inline"] math')).toHaveCount(1); // MathML for screen readers
    await expect(ed.getByText("it costs $5 and $10, a lone $ and")).toBeVisible();
    await page.screenshot({ path: info.outputPath("math.png") });
  });

  test("the arrow keys walk through an inline formula and out again", async ({ page }, info) => {
    const id = await openNote(page, info.project.name, "ab $E = mc^2$ cd\n");
    const ed = noteEditor(page);
    await expect(ed.locator('[data-uh="math-inline"]')).toHaveAttribute("data-state", "drawn");
    // click at the very start of the line (its centre could be the formula itself)
    await ed.locator("p").first().click({ position: { x: 2, y: 8 } });
    await expect(page.locator(".mdx-note-content:focus")).toHaveCount(1);
    await expect(ed.locator('[data-uh="math-source"]')).toHaveCount(0);
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight"); // after "ab "
    await page.keyboard.press("ArrowRight"); // into the formula
    await expect(ed.locator('[data-uh="math-source"]')).toHaveText("$E = mc^2$");
    await expect(page.locator('[data-uh="math-preview"]')).toBeVisible();
    await page.screenshot({ path: info.outputPath("math-editing.png") });
    for (let i = 0; i < "E = mc^2$".length + 1; i++) await page.keyboard.press("ArrowRight");
    await expect(ed.locator('[data-uh="math-source"]')).toHaveCount(0);
    await expect(ed.locator('[data-uh="math-inline"][data-state="drawn"]')).toHaveCount(1);
    // typing after it works and the formula is saved exactly
    await page.keyboard.type("X");
    await expect.poll(() => noteFile(page, id), { timeout: 10_000 }).toContain("$E = mc^2$ Xcd");
  });

  test("click opens a display formula's source; Escape returns; shared commands work", async ({ page }, info) => {
    const id = await openNote(page, info.project.name, "$\\newcommand{\\RR}{\\mathbb{R}}$ defines it.\n\n$$\nx \\in \\RR\n$$\n");
    const ed = noteEditor(page);
    const block = ed.locator('[data-uh="math-block"]');
    await expect(block).toHaveAttribute("data-state", "drawn");
    await block.click();
    const source = ed.locator('textarea[data-uh="math-source"]');
    await expect(source).toBeFocused();
    await source.press("End");
    await source.pressSequentially(" + 1");
    await source.press("Escape");
    await expect(source).toHaveCount(0);
    await expect(block).toBeFocused();
    await expect(block).toHaveAttribute("data-state", "drawn");
    await expect.poll(() => noteFile(page, id), { timeout: 10_000 }).toContain("$$\nx \\in \\RR + 1\n$$");
  });
});

const ALL_TYPES = [
  "flowchart LR\n  A[Start] --> B{Ok?}\n  B -- yes --> C[Done]",
  "sequenceDiagram\n  Alice->>Bob: Hi\n  Bob-->>Alice: Hello",
  "classDiagram\n  class Animal {\n    +name\n  }\n  Animal <|-- Duck",
  "stateDiagram-v2\n  [*] --> Idle\n  Idle --> [*]",
  "erDiagram\n  STUDENT ||--o{ ENROLLMENT : has",
  "gantt\n  title Plan\n  dateFormat YYYY-MM-DD\n  section A\n  Task :a1, 2026-11-02, 3d",
  "mindmap\n  root((Topic))\n    One\n    Two",
  "timeline\n  title History\n  1665 : Newton\n  1675 : Leibniz",
];

test.describe("diagrams (US1)", () => {
  test("every standard type draws, fits the note, and edits with a live preview", async ({ page }, info) => {
    const md = ALL_TYPES.map((d) => "```mermaid\n" + d + "\n```").join("\n\n") + "\n";
    const id = await openNote(page, info.project.name, md);
    const ed = noteEditor(page);
    const diagrams = ed.locator('[data-uh="diagram"]');
    await expect(diagrams).toHaveCount(ALL_TYPES.length);
    for (let i = 0; i < ALL_TYPES.length; i++) {
      await diagrams.nth(i).scrollIntoViewIfNeeded();
      await expect(diagrams.nth(i), ALL_TYPES[i].split("\n")[0]).toHaveAttribute("data-state", "drawn", { timeout: 15_000 });
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await diagrams.first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath("diagrams.png") });

    // edit: click → source + preview → type → preview updates → Escape → new drawing
    await diagrams.first().click();
    const source = ed.locator('textarea[data-uh="diagram-source"]');
    await expect(source).toBeFocused();
    await source.press("ControlOrMeta+End");
    await source.pressSequentially("\n  C --> D[Renamed node]");
    const preview = ed.locator('[data-uh="diagram-preview"]');
    await expect(preview).toContainText("Renamed node", { timeout: 2_000 });
    await page.screenshot({ path: info.outputPath("diagram-editing.png") });
    await source.press("Escape");
    await expect(source).toHaveCount(0);
    await expect(diagrams.first()).toBeFocused();
    await expect(diagrams.first()).toContainText("Renamed node");
    await expect.poll(() => noteFile(page, id), { timeout: 10_000 }).toContain("B -- yes --> C[Done]\n  C --> D[Renamed node]\n```");
  });

  test("a note without diagrams or math loads nothing extra (FR-027)", async ({ page }, info) => {
    const requests: string[] = [];
    page.on("request", (r) => requests.push(r.url()));
    await openNote(page, info.project.name, "# Plain\n\nJust words, and a price of $5.\n");
    await expect(noteEditor(page)).toContainText("Just words");
    await page.waitForTimeout(500);
    // the editor's own small plugin modules load with it; the libraries and the frame must not
    expect(requests.filter((u) => /node_modules\/.*(mermaid|katex)|deps\/(mermaid|katex)|diagram-sandbox|diagram-renderer|katex.*\.(css|woff2)/i.test(u))).toEqual([]);
    expect(await page.locator("iframe").count()).toBe(0);
  });
});

const HOSTILE = [
  "```mermaid",
  '%%{init: {"securityLevel": "loose", "flowchart": {"htmlLabels": true}}}%%',
  "flowchart LR",
  '  A["<img src=https://example.invalid/x.png onerror=window.__uhSentinel=2>"] --> B',
  "  click A call alert(1)",
  '  click B href "javascript:window.__uhSentinel=3"',
  "```",
  "",
  "Formula: $\\href{https://example.invalid}{x}$ and $\\includegraphics{https://example.invalid/i.png}$.",
  "",
].join("\n");

test.describe("errors, limits and safety (US4)", () => {
  test("hostile diagrams and formulas run nothing and reach no other site until allowed", async ({ page }, info) => {
    const outside: string[] = [];
    const dialogs: string[] = [];
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (!["localhost", "127.0.0.1"].includes(u.hostname) && !u.protocol.startsWith("data")) outside.push(r.url());
    });
    page.on("dialog", (d) => {
      dialogs.push(d.message());
      void d.dismiss();
    });
    await page.addInitScript(() => ((window as unknown as { __uhSentinel: number }).__uhSentinel = 1));
    await openNote(page, info.project.name, HOSTILE);
    const ed = noteEditor(page);
    const diagram = ed.locator('[data-uh="diagram"]');
    await expect(diagram).toHaveAttribute("data-state", "drawn", { timeout: 15_000 });
    await expect(ed.locator('[data-uh="math-inline"]')).toHaveCount(2);
    await expect(ed.locator('[data-uh="math-inline"] a, [data-uh="math-inline"] img')).toHaveCount(0);
    await expect(diagram.locator("a, img, foreignObject, script")).toHaveCount(0);
    await diagram.locator("svg .node").first().click({ force: true });
    await page.keyboard.press("Escape");
    expect(await page.evaluate(() => (window as unknown as { __uhSentinel: number }).__uhSentinel)).toBe(1);
    expect(dialogs).toEqual([]);
    expect(outside).toEqual([]);

    // the banner offers a review; "Allow" draws it live in its own frame
    const banner = page.locator('[data-uh="diagram-decision-banner"]');
    await expect(banner).toBeVisible();
    await page.screenshot({ path: info.outputPath("banner.png") });
    await banner.getByRole("button", { name: "Review" }).click();
    const dialog = page.locator('[data-uh="diagram-decision"]');
    await expect(dialog.getByText("This note's diagrams ask for extra permissions")).toBeVisible();
    await page.screenshot({ path: info.outputPath("decision-dialog.png") });
    await dialog.getByRole("radio", { name: "Allow" }).click();
    await dialog.getByRole("button", { name: "Apply" }).click();
    await expect(diagram).toHaveAttribute("data-state", "allowed");
    await expect(banner).toHaveCount(0);
    // even allowed, it can't touch the app
    expect(await page.evaluate(() => (window as unknown as { __uhSentinel: number }).__uhSentinel)).toBe(1);

    // editing the source asks again (clicks on an allowed diagram go to the diagram itself)
    await diagram.focus();
    await page.keyboard.press("Enter");
    const source = ed.locator('textarea[data-uh="diagram-source"]');
    await source.press("ControlOrMeta+End");
    await source.pressSequentially("\n  B --> C");
    await source.press("Escape");
    await expect(diagram).toHaveAttribute("data-state", "drawn", { timeout: 15_000 });
    await expect(banner).toBeVisible();
  });

  test("broken, empty, oversized and slow diagrams keep the editor working", async ({ page }, info) => {
    const big = "flowchart LR\n" + Array.from({ length: 3400 }, (_, i) => `  N${i} --> N${i + 1}`).join("\n");
    expect(big.length).toBeGreaterThan(50_000);
    const md = ["```mermaid\nflowchart LR\n  A -->\n```", "```mermaid\n```", "$$\n\\frac{1}{\n$$", "$$$$", "```mermaid\n" + big + "\n```", "Last line."].join("\n\n");
    await openNote(page, info.project.name, md);
    const ed = noteEditor(page);
    const diagrams = ed.locator('[data-uh="diagram"]');
    await expect(diagrams.nth(0)).toHaveAttribute("data-state", "error", { timeout: 15_000 });
    await expect(diagrams.nth(0).locator('[data-uh="render-message"]')).toContainText("Diagram error:");
    await expect(diagrams.nth(0)).toContainText("A -->");
    await expect(diagrams.nth(1)).toHaveAttribute("data-state", "empty");
    await expect(diagrams.nth(1)).toContainText("Empty diagram. Press Enter to edit.");
    const blocks = ed.locator('[data-uh="math-block"]');
    await expect(blocks.nth(0)).toHaveAttribute("data-state", "error");
    await expect(blocks.nth(0).locator('[data-uh="render-message"]')).toContainText("Formula error:");
    await expect(blocks.nth(1)).toHaveAttribute("data-state", "empty");
    await diagrams.nth(2).scrollIntoViewIfNeeded();
    await expect(diagrams.nth(2)).toHaveAttribute("data-state", "tooLarge");
    await expect(diagrams.nth(2)).toContainText("too large to draw (over 50,000 characters)");
    // typing still works
    await ed.getByText("Last line.").click();
    await page.keyboard.press("End");
    await page.keyboard.type(" Still typing.");
    await expect(ed.getByText("Last line. Still typing.")).toBeVisible();
  });

  test("a drawing that takes too long is shown as code; typing never waits", async ({ page }, info) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __uhSetRenderTimeout?: (ms: number) => void };
      const t = setInterval(() => {
        if (w.__uhSetRenderTimeout) {
          w.__uhSetRenderTimeout(1);
          clearInterval(t);
        }
      }, 5);
    });
    await openNote(page, info.project.name, "```mermaid\nflowchart LR\n  A --> B\n```\n\nType here.");
    const diagram = noteEditor(page).locator('[data-uh="diagram"]');
    await expect(diagram).toHaveAttribute("data-state", "timedOut", { timeout: 15_000 });
    await expect(diagram).toContainText("took longer than 5 seconds to draw and is shown as code");
    await noteEditor(page).getByText("Type here.").click();
    await page.keyboard.press("End");
    await page.keyboard.type(" ok");
    await expect(noteEditor(page).getByText("Type here. ok")).toBeVisible();
  });

  test("with no internet, diagrams and formulas still draw (FR-034)", async ({ page }, info) => {
    const outside: string[] = [];
    await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => {
      outside.push(route.request().url());
      return route.abort("internetdisconnected");
    });
    await openNote(page, info.project.name, fixture("obsidian-01-mixed.md"));
    const ed = noteEditor(page);
    await expect(ed.locator('[data-uh="diagram"]')).toHaveAttribute("data-state", "drawn", { timeout: 15_000 });
    await expect(ed.locator('[data-uh="math-inline"][data-state="drawn"]')).toHaveCount(3);
    await expect(ed.locator('[data-uh="math-block"][data-state="drawn"]')).toHaveCount(1);
    // KaTeX fonts come from the app itself
    const fontsOk = await page.evaluate(async () => {
      await document.fonts.ready;
      return [...document.fonts].some((f) => f.family.includes("KaTeX") && f.status === "loaded");
    });
    expect(fontsOk).toBe(true);
    expect(outside).toEqual([]);
  });
});

test.describe("the rest of the editor is unchanged (US5)", () => {
  test("save states, the unsaved-changes warning and an outside edit keep formulas exact", async ({ page }, info) => {
    const original = "Start $a_1 * b$ here.\n\n```mermaid\nflowchart LR\n  A[x_1] --> B\n```\n";
    const id = await openNote(page, info.project.name, original);
    const ed = noteEditor(page);
    await ed.getByText("here.").click();
    await page.keyboard.press("End");
    await page.keyboard.type(" Typed.");
    await expect.poll(() => noteFile(page, id), { timeout: 10_000 }).toContain("Start $a_1 * b$ here. Typed.");
    await expect(page.getByTestId("note-save-state")).toContainText("Saved");

    // the unsaved-changes warning still guards the page
    await page.route("**/api/v1/notes/*/content", (route) => route.abort());
    await page.keyboard.type(" More.");
    const warned = await page.evaluate(() => {
      const e = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    });
    expect(warned).toBe(true);
    await page.unroute("**/api/v1/notes/*/content");
    await waitSaved(page);

    // edited outside the app while open → conflict → Keep both
    // edited outside the app while open → the save is refused as a conflict, and what the app
    // tried to save kept the formula and diagram exactly. (The conflict dialog itself doesn't
    // open in the MDXEditor-based editor even without this feature: specs/KNOWN-ISSUES.md.)
    const bodies: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes(`/notes/${id}/content`) && r.method() === "PUT") bodies.push(r.postData() ?? "");
    });
    const outside = "changed outside $c_2$\n";
    writeFileSync(noteFilePath(lastCourse), outside);
    await page.keyboard.type(" Mine.");
    await expect(page.getByTestId("note-save-state")).toContainText("Conflict", { timeout: 10_000 });
    expect(readFileSync(noteFilePath(lastCourse), "utf8")).toBe(outside);
    const sent = JSON.parse(bodies.at(-1)!).content as string;
    expect(sent).toContain("Start $a_1 * b$ here. Typed. More. Mine.");
    expect(sent).toContain("```mermaid\nflowchart LR\n  A[x_1] --> B\n```");
  });
});

test.describe("expand and export (US7)", () => {
  test("the viewer zooms, pans and returns focus; SVG and PNG are saved", async ({ page }, info) => {
    await openNote(page, info.project.name, "```mermaid\nflowchart LR\n  accTitle: Pipeline\n  A --> B --> C\n```\n\n```mermaid\nflowchart LR\n  A -->\n```\n");
    const ed = noteEditor(page);
    const diagram = ed.locator('[data-uh="diagram"]').first();
    await expect(diagram).toHaveAttribute("data-state", "drawn", { timeout: 15_000 });
    await diagram.hover();
    await diagram.getByRole("button", { name: "Diagram actions" }).click();
    await page.getByRole("menuitem", { name: "Expand" }).click();
    const viewer = page.locator('[data-uh="diagram-viewer"]');
    await expect(viewer).toBeVisible();
    await expect(viewer.getByText("100%")).toBeVisible();
    await page.keyboard.press("+");
    await page.keyboard.press("+");
    await expect(viewer.getByText("156%")).toBeVisible();
    await page.keyboard.press("ArrowLeft");
    const transform = await viewer.locator(".uh-viewer-canvas").evaluate((el) => (el as HTMLElement).style.transform);
    expect(transform).toContain("translate(40px");
    await page.screenshot({ path: info.outputPath("viewer.png") });
    await page.keyboard.press("Escape");
    await expect(viewer).toBeHidden();
    await expect(diagram).toBeFocused();

    for (const [item, ext] of [["Export SVG", ".svg"], ["Export PNG", ".png"], ["Export light on white", ".svg"]] as const) {
      await diagram.getByRole("button", { name: "Diagram actions" }).click();
      const download = page.waitForEvent("download");
      await page.getByRole("menuitem", { name: item }).click();
      const file = await download;
      expect(file.suggestedFilename()).toBe(`Pipeline${ext}`);
      const saved = info.outputPath(`export-${item.replace(/\s/g, "-")}${ext}`);
      await file.saveAs(saved);
      const { readFileSync: read } = await import("node:fs");
      const bytes = read(saved);
      expect(bytes.length).toBeGreaterThan(500);
      if (item === "Export light on white") expect(bytes.toString()).toContain('fill="#ffffff"');
    }

    // a diagram that failed to draw can't be expanded or exported
    const broken = ed.locator('[data-uh="diagram"]').nth(1);
    await expect(broken).toHaveAttribute("data-state", "error", { timeout: 15_000 });
    await broken.hover();
    await broken.getByRole("button", { name: "Diagram actions" }).click();
    for (const item of ["Expand", "Export SVG", "Export PNG"]) {
      await expect(page.getByRole("menuitem", { name: item })).toHaveAttribute("aria-disabled", "true");
    }
    await page.keyboard.press("Escape");
  });
});

test.describe("insert and math blocks (US8)", () => {
  test("the toolbar inserts an editable diagram and formula; ```math blocks are display math", async ({ page }, info) => {
    const id = await openNote(page, info.project.name, "First paragraph.\n\n```math\n\\sum_{k=1}^n k\n```\n");
    const ed = noteEditor(page);
    await expect(ed.locator('[data-uh="math-block"]')).toHaveAttribute("data-state", "drawn");

    await ed.getByText("First paragraph.").click();
    await page.keyboard.press("End");
    await page.getByRole("button", { name: "Insert formula" }).click();
    await expect(ed.locator('[data-uh="math-source"]')).toHaveText("$x^2$");
    await page.keyboard.type("y_1"); // replaces the selected example body
    await expect(ed.locator('[data-uh="math-source"]')).toHaveText("$y_1$");

    await page.getByRole("button", { name: "Insert diagram" }).click();
    const source = ed.locator('textarea[data-uh="diagram-source"]');
    await expect(source).toBeFocused();
    await expect(source).toHaveValue("flowchart LR\n  A[Start] --> B[End]");
    await source.press("ControlOrMeta+End");
    await source.pressSequentially("\n  B --> C[More]");
    await source.press("Escape");
    await expect(ed.locator('[data-uh="diagram"]')).toHaveAttribute("data-state", "drawn", { timeout: 15_000 });

    await expect
      .poll(() => noteFile(page, id), { timeout: 10_000 })
      .toContain("```mermaid\nflowchart LR\n  A[Start] --> B[End]\n  B --> C[More]\n```");
    const saved = await noteFile(page, id);
    expect(saved).toContain("$y_1$");
    expect(saved).toContain("```math\n\\sum_{k=1}^n k\n```");
  });
});
