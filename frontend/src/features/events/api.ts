/**
 * Events (feature 009): query keys and hooks shared by the calendar, the Events page and the forms.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invalidateSchedule } from "@/features/classes/api";
import { apiFetch, type Schemas } from "@/lib/api";

export type EventCreate = Schemas["EventCreate"];
export type EventCreated = Schemas["EventCreated"];
export type EventDetail = Schemas["EventDetail"];
export type EventTimelineEntry = Schemas["EventTimelineEntry"];

export const eventKeys = {
  all: ["events"] as const,
  detail: (lineageId: string) => ["events", "detail", lineageId] as const,
  timeline: (semesterId: string) => ["events", "timeline", semesterId] as const,
};

export function useCreateEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: EventCreate) => apiFetch<EventCreated>("/events", { method: "POST", body }),
    onSuccess: () => Promise.all([invalidateSchedule(qc), qc.invalidateQueries({ queryKey: eventKeys.all })]),
  });
}

export function useEventDetail(lineageId: string | undefined) {
  return useQuery({
    queryKey: eventKeys.detail(lineageId ?? ""),
    queryFn: () => apiFetch<EventDetail>(`/events/${encodeURIComponent(lineageId!)}`),
    enabled: !!lineageId,
  });
}

/** Every event occurrence of the semester, in date order (FR-010). */
export function useEventTimeline(semesterId: string | undefined) {
  return useQuery({
    queryKey: eventKeys.timeline(semesterId ?? ""),
    queryFn: () => apiFetch<EventTimelineEntry[]>(`/semesters/${encodeURIComponent(semesterId!)}/events/timeline`),
    enabled: !!semesterId,
  });
}

/** Workspace of an event occurrence (`/semesters/:semesterId/events/:sessionKey`). */
export function eventWorkspacePath(semesterId: string, key: string) {
  return `/semesters/${semesterId}/events/${encodeURIComponent(key)}`;
}

export function eventsPagePath(semesterId: string) {
  return `/semesters/${semesterId}/events`;
}
