import { act } from "@testing-library/react";
import { $getRoot, $getSelection, type LexicalEditor } from "lexical";
import { describe, expect, it } from "vitest";
import { mountNoteEditor } from "./helpers/noteEditor";

const lexicalOf = (container: HTMLElement) =>
  (container.querySelector(".mdx-note-content") as unknown as { __lexicalEditor: LexicalEditor }).__lexicalEditor;

describe("copying formulas and diagrams (FR-017)", () => {
  it("puts their exact Markdown source in the copied plain text and HTML", async () => {
    const md = "Energy $E = m_1 c^2$ here.\n\n```mermaid\nflowchart LR\n  A[x_1] --> B\n```\n\n$$\n\\frac{a}{b}\n$$";
    const { container, unmount } = await mountNoteEditor(md);
    const editor = lexicalOf(container);
    let text = "";
    let html = "";
    await act(async () => {
      editor.update(
        () => {
          $getRoot().select(0, $getRoot().getChildrenSize());
          text = $getSelection()!.getTextContent();
          html = $getRoot()
            .getChildren()
            .map((n) => {
              const out = n.exportDOM(editor).element as HTMLElement | null;
              return out?.outerHTML ?? "";
            })
            .join("");
        },
        { discrete: true },
      );
    });
    unmount();
    expect(text).toContain("$E = m_1 c^2$");
    expect(text).toContain("```mermaid\nflowchart LR\n  A[x_1] --> B\n```");
    expect(text).toContain("$$\n\\frac{a}{b}\n$$");
    expect(html).toContain("<pre><code>```mermaid");
  });
});
