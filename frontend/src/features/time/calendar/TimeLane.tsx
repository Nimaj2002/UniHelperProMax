/**
 * Tracked time on the calendar (020 US7): thin blocks in a narrow lane at the right edge of each
 * day column, coloured by tag (neutral when untagged), overlapping entries side by side, a running
 * timer's block growing live. Entries crossing midnight show on each day for their part (FR-048).
 * Pressing in the lane never starts a new class or event (FR-049).
 */
import { useMemo } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { layoutOverlaps } from "@/features/calendar/layoutOverlaps";
import { useLocation, useNavigate } from "react-router";
import { clockOffset, useEntries, useTags, useTimer, type Entry, type Tag } from "../api";
import { elapsedMs, formatDuration } from "../clock";
import { clippedSeconds, minutesInDay, rangeOf, splitByDay, timeOfDay } from "../days";
import { requestEntryEdit, requestTimePanel, TIME_HREF } from "../openTime";
import { tagBlock } from "../tagColors";
import { useTick } from "../useTick";
import { useShowTime } from "./showTime";

/** Width the lane takes from each day column (the rest is for classes, events and tasks). */
export const LANE_PX = 10;
const MIN_BLOCK_PX = 4;

export interface LaneBlock {
  key: string;
  entry: Entry | null; // null: the running timer
  start: number;
  end: number;
  tag: Tag | null;
  title: string;
}

/** Entries (and the running timer) of the visible days, split by local day. */
export function useCalendarTime(days: string[], tz: string): { on: boolean; byDay: Map<string, LaneBlock[]>; totals: Map<string, number> } {
  const [on] = useShowTime();
  const first = days[0] ?? "";
  const last = days[days.length - 1] ?? "";
  const { from, to } = rangeOf(first, last, tz);
  const entries = useEntries(from, to, undefined, on && !!first);
  const tags = useTags().data;
  const timer = useTimer().data ?? null;
  const running = !!timer && timer.state === "running" && (timer.style !== "pomodoro" || timer.phase === "work");
  const now = useTick(on && running);

  return useMemo(() => {
    const byDay = new Map<string, LaneBlock[]>();
    const totals = new Map<string, number>();
    if (!on) return { on, byDay, totals };
    const tagOf = (id: string | null | undefined) => tags?.find((t) => t.id === id) ?? null;
    const add = (b: Omit<LaneBlock, "start" | "end" | "key">, key: string, start: number, end: number, seconds: (s: number, e: number) => number) => {
      for (const part of splitByDay(start, end, tz)) {
        if (!days.includes(part.day)) continue;
        byDay.set(part.day, [...(byDay.get(part.day) ?? []), { ...b, key: `${key}@${part.day}`, start: part.start, end: part.end }]);
        totals.set(part.day, (totals.get(part.day) ?? 0) + seconds(part.start, part.end));
      }
    };
    for (const e of entries.data ?? []) {
      add({ entry: e, tag: tagOf(e.tagId), title: e.description || e.linkTitle || "(no description)" }, e.id, Date.parse(e.startedAt), Date.parse(e.endedAt), (s, f) => clippedSeconds(e, s, f));
    }
    if (timer && running) {
      const start = Date.parse(timer.startedAt);
      const end = now + clockOffset();
      const counted = elapsedMs(timer, now, clockOffset()) / 1000; // less any earlier pause
      const span = end - start;
      add({ entry: null, tag: tagOf(timer.tagId), title: `${timer.description || "Timer"} (running)` }, "running", start, end, (s, f) => (span > 0 ? ((f - s) / span) * counted : 0));
    }
    return { on, byDay, totals };
  }, [on, entries.data, tags, timer, running, now, days, tz]);
}

interface Props {
  day: string;
  blocks: LaneBlock[];
  tz: string;
  hourPx: number;
}

export function TimeLane({ day, blocks, tz, hourPx }: Props) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const layout = useMemo(() => layoutOverlaps(blocks.map((b) => ({ key: b.key, start: minutesInDay(b.start, day, tz), end: minutesInDay(b.end, day, tz) }))), [blocks, day, tz]);
  const open = (b: LaneBlock) => {
    if (b.entry) requestEntryEdit(b.entry);
    requestTimePanel();
    if (pathname !== "/") navigate(TIME_HREF);
  };
  return (
    // pointer presses stay in the lane: they never start a class or event draft
    <div
      className="absolute inset-y-0 right-0 z-[16]"
      style={{ width: LANE_PX }}
      data-time-lane={day}
      role="group"
      aria-label={`Tracked time, ${day}`}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {blocks.map((b) => {
        const top = (minutesInDay(b.start, day, tz) / 60) * hourPx;
        const height = Math.max(((b.end - b.start) / 3_600_000) * hourPx, MIN_BLOCK_PX);
        const p = layout.get(b.key) ?? { column: 0, columns: 1 };
        const width = 100 / p.columns;
        const range = `${timeOfDay(b.start, tz)}–${b.entry ? timeOfDay(b.end, tz) : "now"}`;
        const label = `${b.title}, ${b.tag?.name ?? "No tag"}, ${range}, ${formatDuration((b.end - b.start) / 1000)}`;
        return (
          <Tooltip key={b.key}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={label}
                onClick={() => open(b)}
                className="absolute rounded-[3px] border outline-none focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                style={{ ...tagBlock(b.tag?.color), top, height, left: `${p.column * width}%`, width: `${width}%` }}
                data-time-entry={b.entry?.id ?? "running"}
              />
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-xs">
              <p className="font-medium">{b.title}</p>
              <p>{b.tag?.name ?? "No tag"} · {range}</p>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
