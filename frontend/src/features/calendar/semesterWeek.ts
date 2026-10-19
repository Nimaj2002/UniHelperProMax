import { differenceInCalendarDays } from "date-fns";
import { useCourseTree, type YearNode } from "@/features/courses/api";
import { fromISODate, weekStart } from "@/lib/dates";

export interface SemesterWeek {
  week: number;
  semesterName: string;
}

/** The semester week `iso` falls in: week 1 is the (Monday-based) week holding the semester's
 * start date. Semesters without a start date are skipped; a missing end date is open-ended.
 * When semesters overlap, the one that started most recently wins. */
export function semesterWeekOf(tree: YearNode[], iso: string): SemesterWeek | null {
  let best: { start: string; name: string } | null = null;
  for (const y of tree)
    for (const { semester: s } of y.semesters) {
      if (!s.startDate || s.startDate > iso) continue;
      if (s.endDate && s.endDate < iso) continue;
      if (!best || s.startDate > best.start) best = { start: s.startDate, name: s.name };
    }
  if (!best) return null;
  const days = differenceInCalendarDays(fromISODate(weekStart(iso)), fromISODate(weekStart(best.start)));
  return { week: Math.floor(days / 7) + 1, semesterName: best.name };
}

export function useSemesterWeek(iso: string): SemesterWeek | null {
  const tree = useCourseTree();
  return tree.data ? semesterWeekOf(tree.data, iso) : null;
}
