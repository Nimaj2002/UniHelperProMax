import { describe, expect, it } from "vitest";
import { MAX_UNDO, UndoStack } from "@/features/documents/reader/annotations/undo";
import type { Annotation } from "@/features/documents/reader/annotations/types";

const a = (over: Partial<Annotation> = {}): Annotation => ({ id: "c1", type: "comment", page: 1, color: "yellow", anchor: [10, 10], text: "t", ...over });

describe("annotation undo / redo", () => {
  it("undo returns the inverse change of each kind; redo the change again", () => {
    const u = new UndoStack();
    u.push([{ id: "c1", before: null, after: a() }]); // create
    u.push([{ id: "c1", before: a(), after: a({ text: "edited" }) }]); // edit
    u.push([{ id: "c1", before: a({ text: "edited" }), after: a({ text: "edited", anchor: [20, 10] }) }]); // move
    u.push([{ id: "c1", before: a({ text: "edited", anchor: [20, 10] }), after: a({ text: "edited", anchor: [20, 10], color: "blue" }) }]); // recolour
    u.push([{ id: "c1", before: a({ color: "blue" }), after: null }]); // delete

    expect(u.undo()).toEqual([{ id: "c1", target: a({ color: "blue" }) }]); // restore the deleted one
    expect(u.undo()).toEqual([{ id: "c1", target: a({ text: "edited", anchor: [20, 10] }) }]);
    expect(u.undo()).toEqual([{ id: "c1", target: a({ text: "edited" }) }]);
    expect(u.undo()).toEqual([{ id: "c1", target: a() }]);
    expect(u.undo()).toEqual([{ id: "c1", target: null }]); // undo create = delete
    expect(u.undo()).toBeNull();
    expect(u.canUndo).toBe(false);

    expect(u.redo()).toEqual([{ id: "c1", target: a() }]);
    expect(u.canRedo).toBe(true);
    u.push([{ id: "c2", before: null, after: a({ id: "c2" }) }]); // a new action clears redo
    expect(u.canRedo).toBe(false);
  });

  it("multi-annotation changes undo in reverse order", () => {
    const u = new UndoStack();
    u.push([
      { id: "x", before: null, after: a({ id: "x" }) },
      { id: "y", before: null, after: a({ id: "y" }) },
    ]);
    expect(u.undo()?.map((c) => c.id)).toEqual(["y", "x"]);
  });

  it("keeps at most 200 steps", () => {
    const u = new UndoStack();
    for (let i = 0; i < MAX_UNDO + 50; i++) u.push([{ id: `a${i}`, before: null, after: a({ id: `a${i}` }) }]);
    let n = 0;
    while (u.undo()) n++;
    expect(n).toBe(MAX_UNDO);
  });
});
