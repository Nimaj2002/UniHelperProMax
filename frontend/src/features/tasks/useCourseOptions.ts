import { useMemo } from "react";
import { useCourseTree } from "@/features/courses/api";

export interface CourseOption {
  id: string;
  name: string;
  /** "Semester · Year", to tell same-named courses apart. */
  where: string;
}

/** Every course of the user (newest year first, as the course tree orders them). */
export function useCourseOptions(): CourseOption[] {
  const tree = useCourseTree();
  return useMemo(
    () =>
      (tree.data ?? []).flatMap((y) =>
        y.semesters.flatMap((s) => s.courses.map((c) => ({ id: c.id, name: c.name, where: `${s.semester.name} · ${y.year.name}` }))),
      ),
    [tree.data],
  );
}
