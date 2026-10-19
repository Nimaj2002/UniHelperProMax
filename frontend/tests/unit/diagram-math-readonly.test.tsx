import { act, fireEvent } from "@testing-library/react";
import { $getRoot, type ElementNode, type LexicalEditor } from "lexical";
import { describe, expect, it } from "vitest";
import { $isInlineMathNode } from "@/features/sessions/editor/diagram-math/nodes/MathNodes";
import { conceal, revealSource } from "@/features/sessions/editor/diagram-math/reveal";
import { mountNoteEditor } from "./helpers/noteEditor";

Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();

const lexicalOf = (container: HTMLElement) =>
  (container.querySelector(".mdx-note-content") as unknown as { __lexicalEditor: LexicalEditor }).__lexicalEditor;
const tick = () => act(async () => new Promise((r) => setTimeout(r, 30)));

describe("read-only notes (FR-035)", () => {
  it("draws formulas and diagrams but never opens their source for editing", async () => {
    const { container, unmount } = await mountNoteEditor("A $x^2$ b\n\n$$\ny\n$$", undefined, { readOnly: true });
    await tick();
    const block = container.querySelector<HTMLElement>('[data-uh="math-block"]')!;
    fireEvent.click(block);
    fireEvent.keyDown(block, { key: "Enter" });
    fireEvent.mouseDown(container.querySelector('[data-uh="math-inline"]')!);
    await tick();
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.querySelector('[data-uh="math-source"]')).toBeNull();
    expect(container.querySelector('[data-uh="math-inline"]')).toHaveAttribute("data-state", "drawn");
    unmount();
  });
});

describe("showing a match inside a formula (FR-016a, for a later find in note)", () => {
  it("reveals an inline formula's source with the range selected, and draws it again", async () => {
    const { container, unmount } = await mountNoteEditor("A $x^2 + y$ b");
    const editor = lexicalOf(container);
    const key = editor.getEditorState().read(() =>
      ($getRoot().getFirstChild() as ElementNode).getChildren().find($isInlineMathNode)!.getKey(),
    );
    let shown = "";
    await act(async () => {
      shown = revealSource(editor, key, { start: 5, end: 6 });
    });
    await tick();
    expect(container.querySelector('[data-uh="math-source"]')?.textContent).toBe("$x^2 + y$");
    expect(window.getSelection()?.toString()).toBe("+");
    await act(async () => conceal(editor, shown));
    await tick();
    expect(container.querySelector('[data-uh="math-source"]')).toBeNull();
    expect(container.querySelector('[data-uh="math-inline"]')).not.toBeNull();
    unmount();
  });

  it("reveals a display formula's source with the range selected", async () => {
    const { container, unmount } = await mountNoteEditor("$$\na + b\n$$");
    const editor = lexicalOf(container);
    const key = editor.getEditorState().read(() => $getRoot().getFirstChild()!.getKey());
    await act(async () => revealSource(editor, key, { start: 4, end: 5 }));
    await tick();
    const area = container.querySelector<HTMLTextAreaElement>('textarea[data-uh="math-source"]')!;
    expect(area.value.slice(area.selectionStart, area.selectionEnd)).toBe("b");
    await act(async () => conceal(editor, key));
    await tick();
    expect(container.querySelector("textarea")).toBeNull();
    unmount();
  });
});
