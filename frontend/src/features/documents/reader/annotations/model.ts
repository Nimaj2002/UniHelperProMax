/**
 * The open document's annotations on this device (007 FR-025–FR-036): what the layer draws,
 * every change turned into a queued operation with the rev it was made against, undo/redo, and
 * the server's merge results (both versions kept on a conflict).
 */
import type { OpQueue, PendingOp } from "./opQueue";
import type { Annotation, AnnotationOp, OpResult } from "./types";
import { UndoStack, type Change } from "./undo";

const newId = () => crypto.randomUUID();
const strip = ({ rev: _rev, createdAt: _c, updatedAt: _u, ...rest }: Annotation): Annotation => rest;

export type ConflictKind = "kept_both" | "kept_changed";

interface Options {
  queue: Pick<OpQueue, "enqueue">;
  onConflict?: (kind: ConflictKind, a: Annotation) => void;
}

export class AnnotationModel {
  private items = new Map<string, Annotation>();
  private undoStack = new UndoStack();
  private listeners = new Set<() => void>();
  version = 0;

  constructor(private readonly o: Options) {}

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getVersion = () => this.version;
  private changed() {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  get canUndo() {
    return this.undoStack.canUndo;
  }
  get canRedo() {
    return this.undoStack.canRedo;
  }

  /** The server's annotations with this device's unsent operations applied on top. */
  load(server: Annotation[], pending: PendingOp[]) {
    this.items = new Map(server.map((a) => [a.id, a]));
    for (const { op } of pending) {
      if (op.kind === "upsert" && op.annotation) this.items.set(op.annotation.id, { ...op.annotation, rev: (op.baseRev ?? 0) + 1 });
      else if (op.id) this.items.delete(op.id);
    }
    this.changed();
  }

  all(): Annotation[] {
    return [...this.items.values()];
  }
  get(id: string) {
    return this.items.get(id);
  }
  onPage(page: number): Annotation[] {
    return this.all().filter((a) => a.page === page);
  }

  /** Make `id` look like `target` (null deletes) and queue the operation. */
  private apply(id: string, target: Annotation | null): Change {
    const before = this.items.get(id) ?? null;
    let op: AnnotationOp;
    if (target === null) {
      if (!before) return { id, before, after: null };
      this.items.delete(id);
      op = { opId: newId(), kind: "delete", id, baseRev: before.rev ?? null };
    } else {
      const next = { ...strip(target), id, rev: (before?.rev ?? 0) + 1 };
      this.items.set(id, next);
      op = { opId: newId(), kind: "upsert", annotation: strip(next), baseRev: before?.rev ?? null };
    }
    void this.o.queue.enqueue(op);
    return { id, before: before && strip(before), after: target && strip({ ...target, id }) };
  }

  create(a: Omit<Annotation, "id">): string {
    return this.createAll([a])[0];
  }

  /** Several annotations as one step (a highlight across pages). */
  createAll(list: Omit<Annotation, "id">[]): string[] {
    const ids = list.map(() => newId());
    this.undoStack.push(list.map((a, i) => this.apply(ids[i], { ...a, id: ids[i] })));
    this.changed();
    return ids;
  }

  update(id: string, patch: Partial<Annotation>) {
    const current = this.items.get(id);
    if (!current) return;
    this.undoStack.push([this.apply(id, { ...current, ...patch, id })]);
    this.changed();
  }

  remove(id: string) {
    if (!this.items.has(id)) return;
    this.undoStack.push([this.apply(id, null)]);
    this.changed();
  }

  undo() {
    const targets = this.undoStack.undo();
    if (!targets) return false;
    targets.forEach((t) => this.apply(t.id, t.target));
    this.changed();
    return true;
  }

  redo() {
    const targets = this.undoStack.redo();
    if (!targets) return false;
    targets.forEach((t) => this.apply(t.id, t.target));
    this.changed();
    return true;
  }

  /** Server results: on a conflict both versions are kept (FR-036) and the user is told. */
  applyResults(results: OpResult[]) {
    let touched = false;
    for (const r of results) {
      if (r.status === "kept_both" && r.annotation && r.copy) {
        this.items.set(r.annotation.id, r.annotation);
        this.items.set(r.copy.id, r.copy);
        this.o.onConflict?.("kept_both", r.annotation);
        touched = true;
      } else if (r.status === "kept_changed" && r.annotation) {
        this.items.set(r.annotation.id, r.annotation);
        this.o.onConflict?.("kept_changed", r.annotation);
        touched = true;
      }
    }
    if (touched) this.changed();
  }
}
