/**
 * The list view's groups (FR-021, research R9): Overdue, Today, This week, Later, No date, Done —
 * always in this order — each sorted by due date, then due time (a date-only task after the timed
 * ones of its day: it is due at the end of the day), then title.
 */
import { dueBucket, type DueBucket } from "./dates";
import type { ColumnLike, TaskLike } from "./types";

type WeekStart = 0 | 1 | 2 | 3 | 4 | 5 | 6;
type Groupable = Pick<TaskLike, "dueDate" | "dueTime" | "columnId" | "completedAt" | "title">;

export const GROUP_ORDER: readonly DueBucket[] = ["overdue", "today", "thisWeek", "later", "noDate", "done"];

export const GROUP_LABEL: Record<DueBucket, string> = {
  overdue: "Overdue",
  today: "Today",
  thisWeek: "This week",
  later: "Later",
  noDate: "No date",
  done: "Done",
};

export interface TaskGroup<T> {
  id: DueBucket;
  label: string;
  tasks: T[];
}

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/** Due date, then time (date-only last within a day), then title; no date after any date. */
export function compareByDue(a: Groupable, b: Groupable): number {
  if (a.dueDate !== b.dueDate) {
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  }
  if (a.dueTime !== b.dueTime) {
    if (!a.dueTime) return 1;
    if (!b.dueTime) return -1;
    return a.dueTime < b.dueTime ? -1 : 1;
  }
  return collator.compare(a.title, b.title);
}

/** All six groups in order (empty ones included; the view decides whether to show them). */
export function groupForList<T extends Groupable>(
  tasks: readonly T[],
  columns: readonly Pick<ColumnLike, "id" | "countsAsDone">[],
  now: Date,
  tz: string,
  weekStartsOn: WeekStart = 1,
): TaskGroup<T>[] {
  const buckets = new Map<DueBucket, T[]>(GROUP_ORDER.map((id) => [id, []]));
  for (const t of tasks) buckets.get(dueBucket(t, now, tz, weekStartsOn, columns))!.push(t);
  return GROUP_ORDER.map((id) => ({ id, label: GROUP_LABEL[id], tasks: buckets.get(id)!.sort(compareByDue) }));
}
