import { act } from "@testing-library/react";
import {
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  type ElementNode,
  KEY_ARROW_LEFT_COMMAND,
  KEY_ARROW_RIGHT_COMMAND,
  type LexicalEditor,
} from "lexical";
import { describe, expect, it } from "vitest";
import { $isInlineMathNode, $isInlineMathSourceNode, $isMathBlockNode } from "@/features/sessions/editor/diagram-math/nodes/MathNodes";
import { mountNoteEditor } from "./helpers/noteEditor";

Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();

const lexicalOf = (container: HTMLElement) =>
  (container.querySelector(".mdx-note-content") as unknown as { __lexicalEditor: LexicalEditor }).__lexicalEditor;

async function setup(md: string) {
  const mounted = await mountNoteEditor(md);
  return { ...mounted, lexical: lexicalOf(mounted.container) };
}

const run = (editor: LexicalEditor, fn: () => void) =>
  act(async () => {
    editor.update(fn, { discrete: true });
    await new Promise((r) => setTimeout(r, 0));
  });

const types = (editor: LexicalEditor) =>
  editor.getEditorState().read(() =>
    ($getRoot().getFirstChild() as ElementNode)
      .getChildren()
      .map((n) => ($isInlineMathNode(n) ? `math:${n.getRaw()}` : $isInlineMathSourceNode(n) ? `source:${n.getTextContent()}` : `text:${n.getTextContent()}`)),
  );

describe("typing formulas (research R5)", () => {
  it("turns a typed $…$ into a formula once the caret moves on", async () => {
    const { lexical, unmount } = await setup("start");
    await run(lexical, () => {
      const p = $getRoot().getFirstChild() as ElementNode;
      p.getFirstChild()!.remove();
      const t = $createTextNode("energy $E=mc^2$");
      p.append(t);
      t.select(t.getTextContentSize(), t.getTextContentSize());
    });
    expect(types(lexical)).toEqual(["text:energy $E=mc^2$"]); // still at the closing $
    await run(lexical, () => {
      (($getSelection() as never) as { insertText(t: string): void }).insertText(" is");
    });
    expect(types(lexical)).toEqual(["text:energy ", "math:$E=mc^2$", "text: is"]);
    unmount();
  });

  it("does not turn $x$5 into a formula", async () => {
    const { lexical, unmount } = await setup("start");
    await run(lexical, () => {
      const p = $getRoot().getFirstChild() as ElementNode;
      p.getFirstChild()!.remove();
      const t = $createTextNode("$x$");
      p.append(t);
      t.select(3, 3);
    });
    await run(lexical, () => (($getSelection() as never) as { insertText(t: string): void }).insertText("5"));
    expect(types(lexical)).toEqual(["text:$x$5"]);
    unmount();
  });

  it("never converts text that came from opening the note", async () => {
    const { lexical, editor, unmount } = await setup("A literal \\$x\\$ here");
    expect(types(lexical)).toEqual(["text:A literal $x$ here"]);
    expect(editor.getMarkdown()).toBe("A literal \\$x\\$ here");
    unmount();
  });
});

describe("moving through an inline formula (FR-012)", () => {
  it("enters the source with → and draws it again after leaving", async () => {
    const { lexical, unmount } = await setup("a $x^2$ b");
    expect(types(lexical)).toEqual(["text:a ", "math:$x^2$", "text: b"]);
    await run(lexical, () => {
      const first = ($getRoot().getFirstChild() as ElementNode).getFirstChild()!;
      first.selectEnd();
    });
    await act(async () => {
      lexical.dispatchCommand(KEY_ARROW_RIGHT_COMMAND, new KeyboardEvent("keydown", { key: "ArrowRight" }));
    });
    expect(types(lexical)).toEqual(["text:a ", "source:$x^2$", "text: b"]);
    const offset = lexical.getEditorState().read(() => {
      const s = $getSelection();
      return $isRangeSelection(s) ? s.anchor.offset : -1;
    });
    expect(offset).toBe(1); // just inside the opening $
    // caret leaves to the text after it
    await run(lexical, () => {
      const last = ($getRoot().getFirstChild() as ElementNode).getLastChild()!;
      last.selectEnd();
    });
    expect(types(lexical)).toEqual(["text:a ", "math:$x^2$", "text: b"]);
    unmount();
  });

  it("enters from the right with ← just before the closing $", async () => {
    const { lexical, unmount } = await setup("a $x^2$ b");
    await run(lexical, () => {
      const last = ($getRoot().getFirstChild() as ElementNode).getLastChild()!;
      last.selectStart();
    });
    await act(async () => {
      lexical.dispatchCommand(KEY_ARROW_LEFT_COMMAND, new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    });
    const offset = lexical.getEditorState().read(() => {
      const s = $getSelection();
      return $isRangeSelection(s) && $isInlineMathSourceNode(s.anchor.getNode()) ? s.anchor.offset : -1;
    });
    expect(offset).toBe(4); // "$x^2|$"
    unmount();
  });

  it("turns edited source that is no longer math into plain text, and keeps the save exact", async () => {
    const { lexical, editor, unmount } = await setup("a $x^2$ b");
    await run(lexical, () => ($getRoot().getFirstChild() as ElementNode).getFirstChild()!.selectEnd());
    await act(async () => {
      lexical.dispatchCommand(KEY_ARROW_RIGHT_COMMAND, new KeyboardEvent("keydown", { key: "ArrowRight" }));
    });
    expect(editor.getMarkdown()).toBe("a $x^2$ b"); // saving mid-edit is exact
    await run(lexical, () => {
      const s = $getSelection();
      if ($isRangeSelection(s)) s.insertText(" ");
    });
    await run(lexical, () => ($getRoot().getFirstChild() as ElementNode).getLastChild()!.selectEnd());
    expect(types(lexical)).toEqual(["text:a $ x^2$ b"]);
    unmount();
  });
});

describe("display formulas", () => {
  it("reads one-line and several-line $$ as blocks", async () => {
    const { lexical, unmount } = await setup("$$x^2$$\n\n$$\na\n$$");
    const blocks = lexical.getEditorState().read(() => $getRoot().getChildren().filter($isMathBlockNode).length);
    expect(blocks).toBe(2);
    unmount();
  });
});
