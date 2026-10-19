/**
 * Pure hit-testing and slot math for the board (research R1, R2). Indexes are "insertion indexes
 * among the items that stay in place", i.e. measured after removing the dragged item — the same
 * meaning as `POST /tasks/{id}/move`'s `index` and `applyMove`.
 */

export interface RectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface DropTarget {
  columnId: string;
  index: number;
}

export interface Placed {
  id: string;
  rect: RectLike;
}

/** Columns in board order, each with its rendered (visible) task ids in order. */
export type BoardLayout = readonly { id: string; taskIds: readonly string[] }[];

const inside = (px: number, py: number, r: RectLike) => px >= r.left && px <= r.right && py >= r.top && py <= r.bottom;

/**
 * Where a dragged card would land: the column under the pointer and the index of the first
 * remaining card whose vertical midpoint is below the pointer (end of the column otherwise);
 * null when the pointer is outside every column.
 */
export function computeTarget(
  px: number,
  py: number,
  columnRects: readonly Placed[],
  cardRects: Readonly<Record<string, readonly Placed[]>>,
  draggedId: string,
): DropTarget | null {
  const column = columnRects.find((c) => inside(px, py, c.rect));
  if (!column) return null;
  const cards = (cardRects[column.id] ?? []).filter((c) => c.id !== draggedId);
  const index = cards.findIndex((c) => py < c.rect.top + (c.rect.bottom - c.rect.top) / 2);
  return { columnId: column.id, index: index === -1 ? cards.length : index };
}

/**
 * Where a dragged column would land: the index (among the other columns) of the first column
 * whose horizontal midpoint is right of the pointer; the end otherwise.
 */
export function computeColumnIndex(px: number, columnRects: readonly Placed[], draggedId: string): number {
  const rest = columnRects.filter((c) => c.id !== draggedId);
  const index = rest.findIndex((c) => px < c.rect.left + (c.rect.right - c.rect.left) / 2);
  return index === -1 ? rest.length : index;
}

/** The column and index an item occupies now (index among the other items = its own index). */
export function originOf(layout: BoardLayout, taskId: string): DropTarget | null {
  for (const col of layout) {
    const index = col.taskIds.indexOf(taskId);
    if (index !== -1) return { columnId: col.id, index };
  }
  return null;
}

export const sameTarget = (a: DropTarget | null, b: DropTarget | null) =>
  !!a && !!b && a.columnId === b.columnId && a.index === b.index;

/**
 * Maps an insertion index among the *visible* items of a column to one among *all* its items
 * (filters hide some; the server resolves the index against the full column — research R11).
 * The moved item lands just before the visible item that follows the slot, or just after the
 * last visible item when the slot is at the end.
 */
export function fullIndex(fullIds: readonly string[], visibleIds: readonly string[], index: number, movedId: string): number {
  const full = fullIds.filter((id) => id !== movedId);
  const visible = visibleIds.filter((id) => id !== movedId);
  if (index < visible.length) {
    const at = full.indexOf(visible[index]);
    return at === -1 ? full.length : at;
  }
  if (visible.length === 0) return full.length;
  const last = full.indexOf(visible[visible.length - 1]);
  return last === -1 ? full.length : last + 1;
}

export type Slot = { kind: "item"; id: string } | { kind: "ghost" };

/**
 * The render order of a list while something is picked up. `target` is an insertion index among
 * the items without the picked one. A pointer drag (`keepPicked` false) removes the picked item
 * and shows the ghost at the target; a keyboard move keeps the item in place and shows the ghost
 * only where it would move to.
 */
export function slots(ids: readonly string[], pickedId: string | null, keepPicked: boolean, target: number | null): Slot[] {
  const rest = ids.filter((id) => id !== pickedId);
  const out: Slot[] = rest.map((id) => ({ kind: "item", id }));
  const origin = pickedId ? ids.indexOf(pickedId) : -1;
  const ghostAt = target === null ? -1 : Math.max(0, Math.min(target, rest.length));
  if (keepPicked && origin !== -1) {
    // insert from the back so the earlier index stays valid
    const marks: [number, Slot, number][] = [[origin, { kind: "item", id: pickedId! }, 0]];
    if (ghostAt !== -1 && ghostAt !== origin) marks.push([ghostAt, { kind: "ghost" }, ghostAt < origin ? -1 : 1]);
    marks.sort((a, b) => b[0] - a[0] || b[2] - a[2]);
    for (const [at, slot] of marks) out.splice(at, 0, slot);
    return out;
  }
  if (ghostAt !== -1) out.splice(ghostAt, 0, { kind: "ghost" });
  return out;
}
