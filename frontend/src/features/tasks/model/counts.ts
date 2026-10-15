/** The Tasks rail's numbers (FR-073): open = not in a done column; overdue = open and past due. */
import { isDone, isOverdue } from "./dates";
import type { ColumnLike, TaskLike } from "./types";

type Columns = readonly Pick<ColumnLike, "id" | "countsAsDone">[];

export function openCount(tasks: readonly Pick<TaskLike, "columnId">[], columns: Columns): number {
  return tasks.reduce((n, t) => n + (isDone(t, columns) ? 0 : 1), 0);
}

export function overdueCount(
  tasks: readonly Pick<TaskLike, "dueDate" | "dueTime" | "columnId" | "completedAt">[],
  columns: Columns,
  now: Date,
  tz: string,
): number {
  return tasks.reduce((n, t) => n + (isOverdue(t, now, tz, columns) ? 1 : 0), 0);
}

/** Counts above 99 show as "99+" (spec Assumptions). */
export function formatCount(n: number): string {
  return n > 99 ? "99+" : String(n);
}
