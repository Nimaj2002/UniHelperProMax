import type { TimelineEntry } from "@/features/sessions/api";

export function entry(date: string, extra: Partial<TimelineEntry> = {}): TimelineEntry {
  return {
    key: `L:${date}`, lineageId: "L", courseId: "c1", date, start: `${date}T10:00:00+03:00`, end: `${date}T11:30:00+03:00`,
    title: "Lecture", location: "FENS G032", color: "blue", status: "past", scheduled: true, noteCount: 0, audioCount: 0, ...extra,
  };
}
