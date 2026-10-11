import { FilePdf, Microphone, NotePencil } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef } from "react";
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { formatDay, wallTime } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { TimelineEntry } from "./api";
import { statusAt, useNow } from "./useNow";

/** A session's workspace: under its course, or (009) an event's under its semester. Without
 * either (a recording or transcription job of an event) `/workspace/:key` finds the right one. */
export function workspacePath(courseId: string | null | undefined, key: string, semesterId?: string | null) {
  if (courseId) return `/courses/${courseId}/sessions/${encodeURIComponent(key)}`;
  if (semesterId) return `/semesters/${semesterId}/events/${encodeURIComponent(key)}`;
  return `/workspace/${encodeURIComponent(key)}`;
}

/** The workspace path of a calendar entry (class session or event occurrence). */
export function entryWorkspacePath(s: { kind: string; courseId: string | null; semesterId: string; key: string }) {
  return workspacePath(s.courseId, s.key, s.kind === "event" ? s.semesterId : null);
}

/** One row of the timeline: a course timeline entry, or (009) an event occurrence. */
export type TimelineItem = Omit<TimelineEntry, "courseId"> & {
  courseId: string | null;
  semesterId?: string | null;
  documentCount?: number;
};

/** Key of the current or next session (where the timeline scrolls to, FR-004). */
export function focusKey(entries: TimelineItem[], now: number): string | undefined {
  const current = entries.find((e) => Date.parse(e.start) <= now && Date.parse(e.end) > now);
  if (current) return current.key;
  return entries.find((e) => Date.parse(e.start) > now)?.key ?? entries[entries.length - 1]?.key;
}

function monthLabel(iso: string) {
  return formatDay(iso, "MMMM yyyy");
}

interface Props {
  entries: TimelineItem[];
  variant: "page" | "compact";
  activeKey?: string;
}

/** Sessions grouped by month; past normal, upcoming muted + "Upcoming" (FR-001–FR-006, FR-011). */
export function SessionTimeline({ entries, variant, activeKey }: Props) {
  const starts = useMemo(() => entries.map((e) => e.start), [entries]);
  const now = useNow(starts);
  const listRef = useRef<HTMLDivElement>(null);
  const target = activeKey ?? focusKey(entries, now);

  const groups = useMemo(() => {
    const out: { month: string; items: TimelineItem[] }[] = [];
    for (const e of entries) {
      const m = e.date.slice(0, 7);
      if (out[out.length - 1]?.month !== m) out.push({ month: m, items: [] });
      out[out.length - 1].items.push(e);
    }
    return out;
  }, [entries]);

  useEffect(() => {
    if (!target) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-timeline-key="${CSS.escape(target)}"]`);
    el?.scrollIntoView({ block: variant === "page" ? "start" : "center" });
    // only when the target changes
  }, [target, variant]);

  const compact = variant === "compact";
  return (
    <div ref={listRef} className={cn("grid", compact ? "gap-3" : "gap-8")}>
      {groups.map(({ month, items }) => (
        <section key={month} aria-labelledby={`month-${month}-${variant}`} className="[content-visibility:auto]">
          <h2
            id={`month-${month}-${variant}`}
            className={cn(
              "sticky top-0 z-10 bg-surface-elevated font-semibold",
              compact ? "px-2 py-1 text-xs text-muted-foreground" : "py-2 text-sm",
            )}
          >
            {monthLabel(`${month}-01`)}
          </h2>
          <ul className={cn("grid", compact ? "gap-0.5" : "gap-1")}>
            {items.map((e) => {
              const upcoming = statusAt(e.start, now) === "upcoming";
              const active = e.key === activeKey;
              return (
                <li key={e.key}>
                  <Link
                    to={workspacePath(e.courseId, e.key, e.semesterId)}
                    data-timeline-key={e.key}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "grid items-center rounded-md hover:bg-accent",
                      compact ? "grid-cols-[3rem_1fr] gap-2 px-2 py-1.5 text-sm" : "grid-cols-[4.5rem_1fr_auto] gap-4 px-3 py-2.5",
                      upcoming && "text-muted-foreground",
                      active && "bg-accent font-medium text-foreground",
                    )}
                  >
                    <span className="tabular-nums">
                      <span className={cn("block font-semibold", compact ? "text-sm" : "text-lg leading-none")}>
                        {formatDay(e.date, "d")}
                      </span>{" "}
                      <span className="text-xs">{formatDay(e.date, "EEE")}</span>{" "}
                    </span>
                    <span className="min-w-0">
                      {" "}
                      <span className="block truncate">
                        {wallTime(e.start)}–{wallTime(e.end)}
                        {e.title && <span> · {e.title}</span>}
                      </span>
                      {!compact && e.location && <span className="block truncate text-sm text-muted-foreground">{e.location}</span>}
                      <span className="mt-0.5 flex flex-wrap gap-1">
                        {upcoming && <Badge variant="outline" className="text-[11px]">Upcoming</Badge>}
                        {!e.scheduled && <Badge variant="outline" className="text-[11px]">No longer scheduled</Badge>}
                      </span>
                    </span>
                    {!compact && (
                      <span className="flex items-center gap-3 text-sm text-muted-foreground">
                        {e.noteCount > 0 && (
                          <span className="flex items-center gap-1">
                            <NotePencil size={16} aria-hidden />
                            {e.noteCount} {e.noteCount === 1 ? "note" : "notes"}
                          </span>
                        )}
                        {e.audioCount > 0 && (
                          <span className="flex items-center gap-1">
                            <Microphone size={16} aria-hidden /> audio
                          </span>
                        )}
                        {!!e.documentCount && (
                          <span className="flex items-center gap-1">
                            <FilePdf size={16} aria-hidden />
                            {e.documentCount} {e.documentCount === 1 ? "document" : "documents"}
                          </span>
                        )}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
