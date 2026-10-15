import { useMutation, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { apiFetch, type Schemas } from "@/lib/api";

export type Session = Schemas["SessionOut"];
export type ClassSeries = Schemas["ClassSeriesOut"];
export type ClassCreate = Schemas["ClassCreate"];
export type ClassCreated = Schemas["ClassCreated"];

export const sessionsKey = (from: string, to: string, courseId?: string) =>
  ["sessions", from, to, courseId ?? null] as const;

export function useSessions(from: string, to: string, courseId?: string) {
  return useQuery({
    queryKey: sessionsKey(from, to, courseId),
    queryFn: () => apiFetch<Session[]>("/sessions", { query: { from, to, courseId } }),
    placeholderData: keepPreviousData,
  });
}

export function useSession(key: string | undefined) {
  return useQuery({
    queryKey: ["session", key],
    queryFn: () => apiFetch<Session>(`/sessions/${encodeURIComponent(key!)}`),
    enabled: !!key,
  });
}

/** Invalidate everything derived from classes, (009) events and the hierarchy — and (012) the
 * task board: linked tasks follow their event, course names show on cards. */
export function invalidateSchedule(qc: ReturnType<typeof useQueryClient>) {
  return Promise.all(
    ["sessions", "session", "course-tree", "years", "semesters", "courses", "course", "class", "events", "tasks", "task-columns"].map((k) =>
      qc.invalidateQueries({ queryKey: [k] }),
    ),
  );
}

export function useCreateClass() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ClassCreate) => apiFetch<ClassCreated>("/classes", { method: "POST", body }),
    onSuccess: () => invalidateSchedule(qc),
  });
}

export type ClassDetail = Schemas["ClassDetail"];
export type ScopeResult = Schemas["ScopeResult"];
export type Scope = "this" | "following" | "all";
/** 012: what happens to tasks linked to the deleted events (default keep). */
export type LinkedTasks = "keep" | "delete";

export function useClassDetail(lineageId: string | undefined) {
  return useQuery({
    queryKey: ["class", lineageId],
    queryFn: () => apiFetch<ClassDetail>(`/classes/${encodeURIComponent(lineageId!)}`),
    enabled: !!lineageId,
  });
}

export function useEditSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, scope, version, body }: { key: string; scope: Scope; version: number; body: unknown }) =>
      apiFetch<ScopeResult>(`/sessions/${encodeURIComponent(key)}`, { method: "PATCH", query: { scope }, version, body }),
    onSettled: () => invalidateSchedule(qc),
  });
}

export function useDeleteSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, scope, version, linkedTasks }: { key: string; scope: Scope; version: number; linkedTasks?: LinkedTasks }) =>
      apiFetch<ScopeResult>(`/sessions/${encodeURIComponent(key)}`, { method: "DELETE", query: { scope, linkedTasks }, version }),
    onSettled: () => invalidateSchedule(qc),
  });
}

/** If-Match for a scoped operation: the exception's version for "this" when one exists. */
export function scopeVersion(session: Session, scope: Scope): number {
  return scope === "this" && session.exceptionVersion != null ? session.exceptionVersion : session.seriesVersion;
}

export function isRecurring(session: Session): boolean {
  return session.recurrenceSummary !== "Does not repeat";
}
