import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { buildInline, tableRanges } from "@/features/sessions/editor/livePreview";

function state(doc: string, cursor = doc.length) {
  const s = EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: [markdown({ base: markdownLanguage })],
  });
  ensureSyntaxTree(s, s.doc.length, 5000);
  return s;
}

/** Text hidden by replace decorations, and classes applied, outside widgets. */
function analyse(doc: string, cursor?: number) {
  const s = state(doc, cursor);
  const decos = buildInline(s, [{ from: 0, to: s.doc.length }]);
  const hidden: string[] = [];
  const classes: string[] = [];
  const widgets: string[] = [];
  for (const d of decos) {
    const spec = d.value.spec as { class?: string; widget?: { constructor: { name: string } } };
    if (spec.widget) widgets.push(spec.widget.constructor.name);
    else if (d.from !== d.to && !spec.class) hidden.push(s.doc.sliceString(d.from, d.to));
    if (spec.class) classes.push(spec.class);
  }
  return { hidden, classes, widgets };
}

describe("live preview decorations", () => {
  it("hides heading and emphasis marks away from the cursor", () => {
    const doc = "# Title\n\nSome **bold** and *it* text\n\nlast";
    const r = analyse(doc); // cursor on the last line
    expect(r.hidden).toEqual(expect.arrayContaining(["# ", "**", "**", "*", "*"]));
    expect(r.classes).toEqual(expect.arrayContaining(["cm-lp-h1", "cm-lp-strong", "cm-lp-em"]));
  });

  it("shows raw syntax on the line with the cursor", () => {
    const doc = "# Title\n\nSome **bold**";
    const onHeading = analyse(doc, 3);
    expect(onHeading.hidden).not.toContain("# ");
    expect(onHeading.hidden).toContain("**");
    const onBold = analyse(doc, doc.length);
    expect(onBold.hidden).toContain("# ");
    expect(onBold.hidden).not.toContain("**");
  });

  it("renders links as styled text with the URL hidden", () => {
    const doc = "See [the docs](https://example.edu/x) now\n\nend";
    const r = analyse(doc);
    expect(r.classes).toContain("cm-lp-link");
    expect(r.hidden.join("")).toBe("[](https://example.edu/x)");
  });

  it("turns task markers into checkbox widgets and bullets into dots", () => {
    const doc = "- [ ] open\n- [x] done\n- plain\n\nend";
    const r = analyse(doc);
    expect(r.widgets.filter((w) => w === "CheckboxWidget")).toHaveLength(2);
    expect(r.widgets).toContain("BulletWidget");
  });

  it("keeps fenced code raw but styled", () => {
    const r = analyse("```js\nconst a = 1;\n```\n\nend");
    expect(r.classes).toContain("cm-lp-codeblock");
    expect(r.hidden).toEqual([]);
  });

  it("finds GFM tables for the block widget", () => {
    const doc = "| a | b |\n|---|---|\n| 1 | 2 |\n\nend";
    const s = state(doc);
    expect(tableRanges(s)).toEqual([{ from: 0, to: doc.indexOf("\n\nend") }]);
  });

  it("never changes the document", () => {
    const doc = "# T\n**b** [l](https://x.y) - [ ] t";
    const s = state(doc, 0);
    buildInline(s, [{ from: 0, to: s.doc.length }]);
    expect(s.doc.toString()).toBe(doc);
  });
});
