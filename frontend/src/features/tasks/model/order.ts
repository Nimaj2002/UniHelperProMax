/**
 * Board order (research R2): a move removes the task from its column, inserts it at
 * `min(index, length)` among the target column's tasks and renumbers both columns 0..n-1 — the
 * same rule as `POST /tasks/{id}/move`, so optimistic updates match the server.
 */
import type { ColumnLike, TaskLike } from "./types";

type Ordered = Pick<TaskLike, "id" | "columnId" | "position">;

const byPosition = (a: Ordered, b: Ordered) => a.position - b.position;

/** The tasks of one column in board order. */
export function columnTasks<T extends Ordered>(tasks: readonly T[], columnId: string): T[] {
  return tasks.filter((t) => t.columnId === columnId).sort(byPosition);
}

/**
 * Moves `taskId` to `index` of `columnId`. Returns a new array (input untouched); tasks of other
 * columns keep their objects. Unknown task → the input unchanged. With `columns`, completion
 * follows the target column like the server: entering a done column from a not-done one sets
 * `completedAt` and `previousColumnId`; leaving a done column clears `completedAt`.
 */
export function applyMove<T extends Ordered & Partial<Pick<TaskLike, "completedAt" | "previousColumnId">>>(
  tasks: readonly T[],
  taskId: string,
  columnId: string,
  index: number,
  columns?: readonly Pick<ColumnLike, "id" | "countsAsDone">[],
  now: Date = new Date(),
): T[] {
  const moving = tasks.find((t) => t.id === taskId);
  if (!moving) return tasks.slice();
  const from = moving.columnId;

  let moved: T = { ...moving, columnId };
  if (columns && from !== columnId) {
    const done = (id: string) => columns.find((c) => c.id === id)?.countsAsDone ?? false;
    if (done(columnId) && !done(from)) moved = { ...moved, completedAt: now.toISOString(), previousColumnId: from };
    else if (!done(columnId) && done(from)) moved = { ...moved, completedAt: null };
  }

  const target = columnTasks(tasks, columnId).filter((t) => t.id !== taskId);
  const at = Math.max(0, Math.min(Math.trunc(index), target.length));
  target.splice(at, 0, moved);

  const renumbered = new Map<string, T>();
  target.forEach((t, i) => renumbered.set(t.id, t.position === i ? t : { ...t, position: i }));
  if (from !== columnId)
    columnTasks(tasks, from)
      .filter((t) => t.id !== taskId)
      .forEach((t, i) => renumbered.set(t.id, t.position === i ? t : { ...t, position: i }));

  return tasks.map((t) => renumbered.get(t.id) ?? t);
}

export interface ColumnGroup<T, C> {
  column: C;
  tasks: T[];
}

/** Columns in board order, each with its tasks in order. Tasks of unknown columns are left out. */
export function tasksByColumn<T extends Ordered, C extends Pick<ColumnLike, "id" | "position">>(
  tasks: readonly T[],
  columns: readonly C[],
): ColumnGroup<T, C>[] {
  const groups = new Map<string, T[]>(columns.map((c) => [c.id, []]));
  for (const t of tasks) groups.get(t.columnId)?.push(t);
  return [...columns]
    .sort((a, b) => a.position - b.position)
    .map((column) => ({ column, tasks: groups.get(column.id)!.sort(byPosition) }));
}
