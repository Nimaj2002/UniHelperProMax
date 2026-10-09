import { describe, expect, it, vi } from "vitest";
import { AnnotationModel } from "@/features/documents/reader/annotations/model";
import type { Annotation, AnnotationOp } from "@/features/documents/reader/annotations/types";

function setup() {
  const sent: AnnotationOp[] = [];
  const onConflict = vi.fn();
  const model = new AnnotationModel({ queue: { enqueue: async (op) => void sent.push(op) }, onConflict });
  return { model, sent, onConflict };
}
const comment: Omit<Annotation, "id"> = { type: "comment", page: 2, color: "yellow", anchor: [10, 20], text: "why?" };

describe("annotation model", () => {
  it("each change is queued with the rev it was made against", () => {
    const { model, sent } = setup();
    const id = model.create(comment);
    model.update(id, { color: "blue" });
    model.update(id, { anchor: [11, 20] });
    model.remove(id);
    expect(sent.map((o) => [o.kind, o.baseRev])).toEqual([["upsert", null], ["upsert", 1], ["upsert", 2], ["delete", 3]]);
    expect(sent[1].annotation).toMatchObject({ id, color: "blue" });
    expect(sent[1].annotation).not.toHaveProperty("rev");
    expect(new Set(sent.map((o) => o.opId)).size).toBe(4);
  });

  it("undo and redo enqueue the inverse operations", () => {
    const { model, sent } = setup();
    const id = model.create(comment);
    model.update(id, { text: "edited" });
    model.remove(id);
    sent.length = 0;
    model.undo(); // delete undone → comes back as new
    expect(sent.at(-1)).toMatchObject({ kind: "upsert", baseRev: null, annotation: { id, text: "edited" } });
    model.undo(); // edit undone
    expect(sent.at(-1)).toMatchObject({ kind: "upsert", baseRev: 1, annotation: { id, text: "why?" } });
    model.undo(); // create undone → delete
    expect(sent.at(-1)).toMatchObject({ kind: "delete", id, baseRev: 2 });
    expect(model.get(id)).toBeUndefined();
    expect(model.undo()).toBe(false);
    model.redo();
    expect(model.get(id)).toMatchObject({ text: "why?" });
    expect(sent.at(-1)).toMatchObject({ kind: "upsert", baseRev: null });
  });

  it("loads the server's annotations with this device's unsent operations on top", () => {
    const { model } = setup();
    const server: Annotation[] = [{ id: "a", type: "comment", page: 1, color: "green", anchor: [1, 1], text: "server", rev: 4 }, { id: "b", type: "comment", page: 1, color: "green", anchor: [1, 1], rev: 1 }];
    model.load(server, [
      { documentId: "d", seq: 1, op: { opId: "op-1", kind: "upsert", baseRev: 4, annotation: { ...server[0], text: "mine" } } },
      { documentId: "d", seq: 2, op: { opId: "op-2", kind: "delete", id: "b", baseRev: 1 } },
    ]);
    expect(model.all()).toEqual([{ ...server[0], text: "mine", rev: 5 }]);
  });

  it("conflicts keep both versions and tell the user", () => {
    const { model, onConflict } = setup();
    const id = model.create(comment);
    const theirs = { ...comment, id, text: "from the other window", rev: 2 };
    const mine = { ...comment, id: "copy-1", text: "why?", conflictOf: id, rev: 1 };
    model.applyResults([{ opId: "x", status: "kept_both", annotation: theirs, copy: mine }]);
    expect(model.onPage(2).map((a) => a.text).sort()).toEqual(["from the other window", "why?"]);
    expect(onConflict).toHaveBeenCalledWith("kept_both", theirs);
  });
});
