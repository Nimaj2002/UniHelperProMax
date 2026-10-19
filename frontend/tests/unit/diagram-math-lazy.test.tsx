import { act } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { katexIfLoaded } from "@/features/sessions/editor/diagram-math/katexLoader";
import { mountNoteEditor } from "./helpers/noteEditor";

// Order matters: the plain note is checked before anything has loaded KaTeX in this file.
describe("libraries load only when needed (FR-027)", () => {
  it("a note without diagrams or math loads neither KaTeX nor the diagram frame", async () => {
    const { unmount } = await mountNoteEditor("# Plain\n\nWords and a price of $5 and $10.\n\n```js\nconst mermaid = 1;\n```");
    await act(async () => new Promise((r) => setTimeout(r, 50)));
    expect(katexIfLoaded()).toBeNull();
    expect(document.querySelector("iframe")).toBeNull();
    unmount();
  });

  it("a note with a formula loads KaTeX but not the diagram frame", async () => {
    const { container, unmount } = await mountNoteEditor("Energy $E = mc^2$.");
    await act(async () => new Promise((r) => setTimeout(r, 200)));
    expect(katexIfLoaded()).not.toBeNull();
    expect(container.querySelector('[data-uh="math-inline"]')).toHaveAttribute("data-state", "drawn");
    expect(document.querySelector("iframe")).toBeNull();
    unmount();
  });
});
