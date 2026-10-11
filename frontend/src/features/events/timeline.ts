import type { TimelineItem } from "@/features/sessions/SessionTimeline";
import type { EventTimelineEntry } from "./api";

/** The semester's event occurrences as timeline rows (same past/upcoming styling, FR-010). */
export function eventTimelineItems(entries: EventTimelineEntry[], semesterId: string): TimelineItem[] {
  return entries.map((e) => ({
    key: e.sessionKey,
    lineageId: e.lineageId,
    courseId: null,
    semesterId,
    date: e.date,
    start: e.start,
    end: e.end,
    title: e.title,
    location: e.location ?? null,
    color: e.color,
    status: e.status,
    scheduled: true,
    noteCount: e.noteCount,
    audioCount: e.audioCount,
    documentCount: e.documentCount,
  }));
}
