/** Optional per-course badges in the course panel (002: note counts). */
import { useSyncExternalStore, type ComponentType } from "react";
import type { Course } from "./api";

export interface CourseAdornment {
  id: string;
  component: ComponentType<{ course: Course }>;
}

let items: CourseAdornment[] = [];
const listeners = new Set<() => void>();

export function registerCourseAdornment(a: CourseAdornment) {
  items = [...items.filter((i) => i.id !== a.id), a];
  listeners.forEach((l) => l());
}

export function useCourseAdornments(): CourseAdornment[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => items,
    () => items,
  );
}
