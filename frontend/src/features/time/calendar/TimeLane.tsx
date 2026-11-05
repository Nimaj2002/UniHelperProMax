/**
 * Tracked time on the calendar (020 US7): blocks drawn like calendar entries and laid out with them
 * (overlaps side by side), coloured by tag (neutral when untagged), a running
 * timer's block growing live. Entries crossing midnight show on each day for their part (FR-048).
 * Pressing a block never starts a new class or event (FR-049).
 */
import { Timer } from "@phosphor-icons/react";
import { useMemo, type CSSProperties } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useLocation, useNavigate } from "react-router";
import { clockOffset, useEntries, useTags, useTimer, type Entry, type Tag } from "../api";
import { elapsedMs, formatDuration } from "../clock";
import { clippedSeconds, rangeOf, splitByDay, timeOfDay } from "../days";
import { requestEntryEdit, requestTimePanel, TIME_HREF } from "../openTime";
import { tagBlock } from "../tagColors";
import { useTick } from "../useTick";
import { useShowTime } from "./showTime";

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
  block: LaneBlock;
  tz: string;
  compact?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** One tracked-time block, drawn like a calendar entry and laid out with them. */
export function TimeBlock({ block: b, tz, compact, className, style }: Props) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const open = () => {
    if (b.entry) requestEntryEdit(b.entry);
    requestTimePanel();
    if (pathname !== "/") navigate(TIME_HREF);
  };
  const range = `${timeOfDay(b.start, tz)}–${b.entry ? timeOfDay(b.end, tz) : "now"}`;
  const label = `${b.title}, ${b.tag?.name ?? "No tag"}, ${range}, ${formatDuration((b.end - b.start) / 1000)}`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={open}
          // pointer presses here never start a class or event draft
          onPointerDown={(e) => e.stopPropagation()}
          data-no-drag
          data-time-entry={b.entry?.id ?? "running"}
          className={cn(
            "flex flex-col overflow-hidden rounded-[6px] border border-l-[3px] px-1.5 py-1 text-left text-xs leading-tight",
            "transition-[filter] hover:brightness-[0.97] focus-visible:z-20 active:scale-[0.99]",
            className,
          )}
          style={{ ...tagBlock(b.tag?.color), ...style }}
        >
          <span className="flex min-w-0 items-center gap-1 truncate font-semibold">
            <Timer size={12} weight="bold" aria-hidden className="shrink-0" />
            <span className="truncate">{b.title}</span>
          </span>
          {!compact && <span className="truncate tabular-nums opacity-90">{range}</span>}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        <p className="font-medium">{b.title}</p>
        <p>{b.tag?.name ?? "No tag"} · {range}</p>
      </TooltipContent>
    </Tooltip>
  );
}
