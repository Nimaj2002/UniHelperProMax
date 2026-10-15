/**
 * Due-date rules (research R9, spec Assumptions): "Today" and "This week" use the user's time zone
 * and the calendar's week start. A task is overdue when it is not done and its due moment has
 * passed: the due time, or for a date-only task the end of the due day. Tasks without a due date
 * are never overdue.
 */
import { TZDate } from "@date-fns/tz";
import { addDays, format, startOfWeek } from "date-fns";
import { fromISODate, toISODate, WEEK_OPTS } from "@/lib/dates";
import type { ColumnLike, TaskLike } from "./types";

type Columns = readonly Pick<ColumnLike, "id" | "countsAsDone">[];
type WeekStart = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type DueBucket = "overdue" | "today" | "thisWeek" | "later" | "noDate" | "done";

/** In a column that counts as done. */
export function isDone(task: Pick<TaskLike, "columnId">, columns: Columns): boolean {
  return columns.find((c) => c.id === task.columnId)?.countsAsDone ?? false;
}

/** Done by its column when columns are known, else by the server's completion date. */
function done(task: Pick<TaskLike, "columnId" | "completedAt">, columns?: Columns): boolean {
  return columns ? isDone(task, columns) : task.completedAt != null;
}

/** Today's date (YYYY-MM-DD) in `tz`. */
export function todayIn(now: Date, tz: string): string {
  return format(new TZDate(now.getTime(), tz), "yyyy-MM-dd");
}

/** The moment a task is due: its time, or the end of its day (= the next day's start) in `tz`. */
export function dueMoment(task: Pick<TaskLike, "dueDate" | "dueTime">, tz: string): number | null {
  if (!task.dueDate) return null;
  const [y, m, d] = task.dueDate.split("-").map(Number);
  if (task.dueTime) {
    const [h, min] = task.dueTime.split(":").map(Number);
    return new TZDate(y, m - 1, d, h, min, tz).getTime();
  }
  return new TZDate(y, m - 1, d + 1, 0, 0, tz).getTime();
}

export function isOverdue(
  task: Pick<TaskLike, "dueDate" | "dueTime" | "columnId" | "completedAt">,
  now: Date,
  tz: string,
  columns?: Columns,
): boolean {
  if (done(task, columns)) return false;
  const due = dueMoment(task, tz);
  return due !== null && now.getTime() > due;
}

/** The list view's group (FR-021): Overdue, Today, This week, Later, No date, Done. */
export function dueBucket(
  task: Pick<TaskLike, "dueDate" | "dueTime" | "columnId" | "completedAt">,
  now: Date,
  tz: string,
  weekStartsOn: WeekStart = WEEK_OPTS.weekStartsOn,
  columns?: Columns,
): DueBucket {
  if (done(task, columns)) return "done";
  if (!task.dueDate) return "noDate";
  if (isOverdue(task, now, tz, columns)) return "overdue";
  const today = todayIn(now, tz);
  if (task.dueDate === today) return "today";
  const weekEnd = toISODate(addDays(startOfWeek(fromISODate(today), { weekStartsOn }), 6));
  return task.dueDate > today && task.dueDate <= weekEnd ? "thisWeek" : "later";
}

/** Chip text: "Overdue", "Today", or the date ("Mon 12 Oct", with the year when not this year). */
export function dueLabel(
  task: Pick<TaskLike, "dueDate" | "dueTime" | "columnId" | "completedAt">,
  now: Date,
  tz: string,
  columns?: Columns,
): string | null {
  if (!task.dueDate) return null;
  if (isOverdue(task, now, tz, columns)) return "Overdue";
  const today = todayIn(now, tz);
  if (task.dueDate === today) return "Today";
  const date = fromISODate(task.dueDate);
  return format(date, task.dueDate.slice(0, 4) === today.slice(0, 4) ? "EEE d MMM" : "EEE d MMM yyyy");
}
