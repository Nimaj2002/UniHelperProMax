import { useMemo } from "react";
import { matchPath, useLocation } from "react-router";
import { useCourseTree, type YearNode } from "@/features/courses/api";
import type { HierarchyValue } from "@/features/classes/HierarchyPicker";
import { usePreferences } from "@/features/sessions/api";

/** What is open when a form is started: a course (course page, session workspace) or a semester
 * (Events page, event workspace). Passed to `/events/new` and `/classes/new` as router state. */
export interface OpenContext {
  courseId?: string;
  semesterId?: string;
}

export function openContextFrom(pathname: string): OpenContext | undefined {
  const course = matchPath("/courses/:courseId/*", pathname) ?? matchPath("/courses/:courseId", pathname);
  if (course?.params.courseId) return { courseId: course.params.courseId };
  const semester = matchPath("/semesters/:semesterId/*", pathname);
  if (semester?.params.semesterId) return { semesterId: semester.params.semesterId };
  return undefined;
}

/** Router state for a "New event" / "New class" navigation from the current page. */
export function useOpenContextState(): { from: OpenContext } | undefined {
  const { pathname } = useLocation();
  const from = openContextFrom(pathname);
  return from ? { from } : undefined;
}

export interface SemesterPick {
  yearId: string;
  yearName: string;
  semesterId: string;
  semesterName: string;
}

function findSemester(tree: YearNode[], match: (semesterId: string, courseIds: string[]) => boolean): SemesterPick | null {
  for (const y of tree)
    for (const s of y.semesters)
      if (match(s.semester.id, s.courses.map((c) => c.id)))
        return { yearId: y.year.id, yearName: y.year.name, semesterId: s.semester.id, semesterName: s.semester.name };
  return null;
}

/** The semester a form starts with (009 FR-004, research R9): the open course's (or semester's),
 * else the last one used if it still exists, else none. `ready` is false while loading. */
export function preselectSemester(tree: YearNode[], from: OpenContext | undefined, lastSemesterId: string | null | undefined) {
  if (from?.courseId) {
    const id = from.courseId;
    const hit = findSemester(tree, (_s, courses) => courses.includes(id));
    if (hit) return hit;
  }
  if (from?.semesterId) {
    const id = from.semesterId;
    const hit = findSemester(tree, (s) => s === id);
    if (hit) return hit;
  }
  if (lastSemesterId) return findSemester(tree, (s) => s === lastSemesterId);
  return null;
}

export function usePreselectedSemester(): { ready: boolean; pick: SemesterPick | null } {
  const location = useLocation();
  const tree = useCourseTree();
  const prefs = usePreferences();
  const from = (location.state as { from?: OpenContext } | null)?.from;
  const ready = !tree.isPending && !prefs.isPending;
  const pick = useMemo(
    () => (ready ? preselectSemester(tree.data ?? [], from, prefs.data?.lastSemesterId) : null),
    [ready, tree.data, from, prefs.data?.lastSemesterId],
  );
  return { ready, pick };
}

/** The pick as the hierarchy picker's value (course left empty). */
export function hierarchyFrom(pick: SemesterPick | null, base: HierarchyValue): HierarchyValue {
  if (!pick) return base;
  return {
    ...base,
    year: { kind: "existing", id: pick.yearId, name: pick.yearName },
    semester: { kind: "existing", id: pick.semesterId, name: pick.semesterName },
  };
}
