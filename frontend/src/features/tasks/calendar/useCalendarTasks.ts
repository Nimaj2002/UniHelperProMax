/**
 * Tasks shown on the calendar (FR-046–FR-051, research R16): live tasks with a due date in the
 * visible range that are not linked to an event (an event-linked task is shown by its event's
 * "On board" indicator instead). Timed tasks go on the time grid; date-only ones in the due strip.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { columnKeys, taskKeys, type Task, type TaskColumn } from "../api";
import { isDone, isOverdue } from "../model/dates";
import { useNow } from "../useNow";

export interface CalendarTask {
  task: Task;
  done: boolean;
  overdue: boolean;
}

export interface CalendarTasks {
  /** Tasks with a due time by date, sorted by time then title. */
  timed: Map<string, CalendarTask[]>;
  /** Date-only tasks by date, sorted by title. */
  dateOnly: Map<string, CalendarTask[]>;
}

export function useCalendarTasks(enabled: boolean, from: string, to: string, tz: string): CalendarTasks | undefined {
  const tasks = useQuery({ queryKey: taskKeys.all, queryFn: () => apiFetch<Task[]>("/tasks"), enabled });
  const columns = useQuery({ queryKey: columnKeys, queryFn: () => apiFetch<TaskColumn[]>("/task-columns"), enabled });
  const now = useNow();
  return useMemo(() => {
    if (!enabled || !tasks.data || !columns.data) return undefined;
    const timed = new Map<string, CalendarTask[]>();
    const dateOnly = new Map<string, CalendarTask[]>();
    for (const task of tasks.data) {
      if (task.event || !task.dueDate || task.dueDate < from || task.dueDate > to) continue;
      const entry = { task, done: isDone(task, columns.data), overdue: isOverdue(task, now, tz, columns.data) };
      const map = task.dueTime ? timed : dateOnly;
      map.set(task.dueDate, [...(map.get(task.dueDate) ?? []), entry]);
    }
    const byTitle = (a: CalendarTask, b: CalendarTask) => a.task.title.localeCompare(b.task.title);
    for (const list of timed.values()) list.sort((a, b) => (a.task.dueTime ?? "").localeCompare(b.task.dueTime ?? "") || byTitle(a, b));
    for (const list of dateOnly.values()) list.sort(byTitle);
    return { timed, dateOnly };
  }, [enabled, tasks.data, columns.data, from, to, tz, now]);
}
