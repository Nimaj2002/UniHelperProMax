import { readFileSync } from "node:fs";
import path from "node:path";
import { act, render } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { MarkdownEditor, type MarkdownEditorHandle } from "@/features/sessions/editor/MarkdownEditor";
import { mathSlices } from "./helpers/mathSlices";
import { mountNoteEditor } from "./helpers/noteEditor";

// jsdom has no layout; CodeMirror and Lexical ask for rects
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();

const fixture = (name: string) => readFileSync(path.resolve(import.meta.dirname, "../fixtures/notes", name), "utf8");
const NOTES = ["github-08-mixed.md", "obsidian-01-mixed.md", "obsidian-03-lists.md", "edge-03-unclosed-fence.md", "vscode-05-escapes.md"];

async function mount(content: string) {
  const onChange = vi.fn();
  const ref = createRef<MarkdownEditorHandle>();
  render(<MarkdownEditor ref={ref} noteId="n1" initialContent={content} label="Note" mode="live" onChange={onChange} />);
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
  return { ref, onChange };
}

describe("saving notes with formulas and diagrams (US3)", () => {
  it.each(NOTES)("opening %s never asks to save (FR-014)", async (name) => {
    const { onChange } = await mount(fixture(name));
    expect(onChange).not.toHaveBeenCalled();
  });

  // MarkdownEditor.appendContent / replaceContent run exactly these MDXEditor calls; MDXEditor
  // mutes onChange for setMarkdown (the saver already holds the text), so read the export back.
  it.each(NOTES)("appending a transcript to %s keeps them exactly (FR-036)", async (name) => {
    const original = fixture(name);
    const { editor, unmount } = await mountNoteEditor(original);
    await act(async () => editor.setMarkdown(editor.getMarkdown() + "\n\nTranscript: we covered $x$ today, it costs $5."));
    const saved = editor.getMarkdown();
    unmount();
    expect(saved).toContain("Transcript: we covered");
    expect(mathSlices(saved)).toEqual([...mathSlices(original), "$x$"]);
  });

  it.each(NOTES)("replacing the text (import, use the file's version) with %s keeps them exactly", async (name) => {
    const original = fixture(name);
    const { editor, unmount } = await mountNoteEditor("old text");
    await act(async () => editor.setMarkdown(original));
    const saved = editor.getMarkdown();
    unmount();
    expect(mathSlices(saved)).toEqual(mathSlices(original));
  });
});
