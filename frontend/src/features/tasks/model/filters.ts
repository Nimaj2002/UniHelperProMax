/**
 * Task filters (FR-033, FR-034): one course or personal tasks, event-linked only, a title search
 * and show/hide Done. They apply to the board and the list; the choice is remembered per browser
 * (`uh.tasks.filters`).
 */
import { isDone } from "./dates";
import type { ColumnLike, TaskLike } from "./types";

export const FILTERS_KEY = "uh.tasks.filters";
export const PERSONAL = "personal";

export interface TaskFilters {
  /** A course id, "personal" (no course) or null (all). */
  course: string | null;
  eventLinked: boolean;
  search: string;
  showDone: boolean;
}

export const NO_FILTERS: TaskFilters = { course: null, eventLinked: false, search: "", showDone: true };

type Filterable = Pick<TaskLike, "title" | "courseId" | "event" | "columnId">;
type Columns = readonly Pick<ColumnLike, "id" | "countsAsDone">[];

/** A stored value made safe: unknown or malformed fields fall back to "no filter". */
export function parseFilters(raw: unknown): TaskFilters {
  const v = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof TaskFilters, unknown>>;
  return {
    course: typeof v.course === "string" && v.course ? v.course : null,
    eventLinked: v.eventLinked === true,
    search: typeof v.search === "string" ? v.search : "",
    showDone: v.showDone !== false,
  };
}

const fold = (s: string) => s.toLocaleLowerCase().normalize("NFKD").replace(/\p{Diacritic}/gu, "");

/** A predicate for the current filters (true = shown). */
export function taskMatcher(filters: TaskFilters, columns: Columns): (task: Filterable) => boolean {
  const query = fold(filters.search.trim());
  return (task) => {
    if (filters.course === PERSONAL ? task.courseId !== null : filters.course !== null && task.courseId !== filters.course) return false;
    if (filters.eventLinked && !task.event) return false;
    if (!filters.showDone && isDone(task, columns)) return false;
    if (query && !fold(task.title).includes(query)) return false;
    return true;
  };
}

export function applyFilters<T extends Filterable>(tasks: readonly T[], filters: TaskFilters, columns: Columns): T[] {
  return tasks.filter(taskMatcher(filters, columns));
}

/** Number of active filters for the Filter button's badge (a non-empty search counts). */
export function activeFilterCount(filters: TaskFilters): number {
  return (
    (filters.course !== null ? 1 : 0) +
    (filters.eventLinked ? 1 : 0) +
    (filters.search.trim() ? 1 : 0) +
    (filters.showDone ? 0 : 1)
  );
}

export function hiddenCount(tasks: readonly Filterable[], filters: TaskFilters, columns: Columns): number {
  return tasks.length - applyFilters(tasks, filters, columns).length;
}
