/**
 * Undo / redo for annotations (007 FR-027, research R8): each user action records, per
 * annotation, its state before and after; undo restores the "before" states (a deleted annotation
 * comes back, a created one goes), redo the "after" states. Applying a target goes through the
 * same saving path as any edit. Per document tab; at most 200 steps.
 */
import type { Annotation } from "./types";

export const MAX_UNDO = 200;

export interface Change {
  id: string;
  before: Annotation | null;
  after: Annotation | null;
}

/** Make annotation `id` look like `target` (null: deleted). */
export interface Target {
  id: string;
  target: Annotation | null;
}

export class UndoStack {
  private done: Change[][] = [];
  private undone: Change[][] = [];

  get canUndo() {
    return this.done.length > 0;
  }
  get canRedo() {
    return this.undone.length > 0;
  }

  push(changes: Change[]) {
    if (!changes.length) return;
    this.done.push(changes);
    if (this.done.length > MAX_UNDO) this.done.shift();
    this.undone = [];
  }

  undo(): Target[] | null {
    const step = this.done.pop();
    if (!step) return null;
    this.undone.push(step);
    return [...step].reverse().map((c) => ({ id: c.id, target: c.before }));
  }

  redo(): Target[] | null {
    const step = this.undone.pop();
    if (!step) return null;
    this.done.push(step);
    return step.map((c) => ({ id: c.id, target: c.after }));
  }
}
