import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiFetch, isApiError, type Schemas } from "@/lib/api";

export type Year = Schemas["Year"];
export type Semester = Schemas["Semester"];
export type Course = Schemas["Course"];
export type CourseDetail = Schemas["CourseDetail"];
export type YearNode = Schemas["YearNode"];

export const courseTreeKey = ["course-tree"] as const;

export function useCourseTree() {
  return useQuery({
    queryKey: courseTreeKey,
    queryFn: () => apiFetch<YearNode[]>("/course-tree"),
  });
}

export function useYears() {
  return useQuery({ queryKey: ["years"], queryFn: () => apiFetch<Year[]>("/years") });
}

export function useSemesters(yearId: string | undefined) {
  return useQuery({
    queryKey: ["semesters", yearId],
    queryFn: () => apiFetch<Semester[]>("/semesters", { query: { yearId } }),
    enabled: !!yearId,
  });
}

export function useCourses(semesterId: string | undefined) {
  return useQuery({
    queryKey: ["courses", semesterId],
    queryFn: () => apiFetch<Course[]>("/courses", { query: { semesterId } }),
    enabled: !!semesterId,
  });
}

export function useCourse(courseId: string | undefined) {
  return useQuery({
    queryKey: ["course", courseId],
    queryFn: () => apiFetch<CourseDetail>(`/courses/${encodeURIComponent(courseId!)}`),
    enabled: !!courseId,
  });
}

// ---- mutations (US3) ---------------------------------------------------------------------

function useInvalidateHierarchy() {
  const qc = useQueryClient();
  return () =>
    Promise.all(
      // 012: tasks show course names and become personal when their course is deleted
      ["course-tree", "years", "semesters", "courses", "course", "sessions", "session", "tasks", "task-columns"].map((k) =>
        qc.invalidateQueries({ queryKey: [k] }),
      ),
    );
}

export type HierarchyKind = "year" | "semester" | "course";
const PATHS: Record<HierarchyKind, string> = { year: "years", semester: "semesters", course: "courses" };

export function conflictMessage(err: unknown): string {
  if (isApiError(err, "version_conflict")) return "This was changed elsewhere. The list has been refreshed — try again.";
  if (isApiError(err)) return err.errors[0]?.message ?? err.title;
  return "Something went wrong. Please retry.";
}

export function useUpdateHierarchy() {
  const invalidate = useInvalidateHierarchy();
  return useMutation({
    mutationFn: ({ kind, id, version, body }: { kind: HierarchyKind; id: string; version: number; body: Record<string, unknown> }) =>
      apiFetch<unknown>(`/${PATHS[kind]}/${id}`, { method: "PATCH", body, version }),
    onSettled: invalidate,
  });
}

export function useDeleteHierarchy() {
  const invalidate = useInvalidateHierarchy();
  return useMutation({
    mutationFn: ({ kind, id, version, linkedTasks }: { kind: HierarchyKind; id: string; version: number; linkedTasks?: "keep" | "delete" }) =>
      apiFetch<void>(`/${PATHS[kind]}/${id}`, { method: "DELETE", version, query: { linkedTasks } }),
    onSettled: invalidate,
  });
}

export type DeletionImpact = Schemas["DeletionImpact"];

export function fetchDeletionImpact(kind: HierarchyKind, id: string) {
  return apiFetch<DeletionImpact>(`/${PATHS[kind]}/${id}/deletion-impact`);
}

/** Reorder years with an optimistic update; rolls back and tells the user on failure. */
export function useReorderYears() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (yearIds: string[]) => apiFetch<Year[]>("/years/order", { method: "PUT", body: { yearIds } }),
    onMutate: async (yearIds) => {
      await qc.cancelQueries({ queryKey: courseTreeKey });
      const previous = qc.getQueryData<YearNode[]>(courseTreeKey);
      if (previous) {
        const byId = new Map(previous.map((n) => [n.year.id, n]));
        qc.setQueryData<YearNode[]>(
          courseTreeKey,
          yearIds.map((id) => byId.get(id)).filter((n): n is YearNode => !!n),
        );
      }
      return { previous };
    },
    onError: (_err, _ids, ctx) => {
      if (ctx?.previous) qc.setQueryData(courseTreeKey, ctx.previous);
      toast.error("Couldn't save the new order. It has been restored.");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: courseTreeKey });
      qc.invalidateQueries({ queryKey: ["years"] });
    },
  });
}
