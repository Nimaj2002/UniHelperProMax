import { useReducedMotion } from "motion/react";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { Session } from "@/features/classes/api";
import { formatDay, formatHHmm, minutesOf, nowMinutes, todayISO } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { DueStrip } from "@/features/tasks/calendar/DueStrip";
import { TaskMarker } from "@/features/tasks/calendar/TaskMarker";
import type { CalendarTask, CalendarTasks } from "@/features/tasks/calendar/useCalendarTasks";
import { clickDraft, keyRangeMinutes, moveRange, rangeLabel, SNAP_MIN, type KeyRange, type RangeKey } from "./draft";
import { EventBlock } from "./EventBlock";
import { useGuardedNavigate } from "./entryGuard";
import { layoutOverlaps } from "./layoutOverlaps";
import { calendarPath } from "./state";
import type { DraftControls } from "./useDraft";
import { useGridDrag } from "./useGridDrag";

export const HOUR_PX = 48;
/** 009: 15-minute slots for clicks, drags and keyboard ranges (research R11). */
export const SLOT_MIN = SNAP_MIN;
const SLOTS = (24 * 60) / SLOT_MIN;
const SLOT_PX = (HOUR_PX * SLOT_MIN) / 60;
const MIN_EVENT_PX = 20;
const DRAFT_KEY = "__draft__";

type Placement = { column: number; columns: number };
const NO_SESSIONS: Session[] = [];

interface Props {
  days: string[];
  sessions: Session[];
  tz: string;
  /** 009: the calendar's new-entry draft (owned by `CalendarPage`). */
  drafts: DraftControls;
  /** 012: tasks to show ("Show tasks" on): timed markers on the grid, date-only in the due strip. */
  tasks?: CalendarTasks;
}

/** The slot button a draft's start (or any time) belongs to, for focus return (009 FR-043). */
export function slotSelector(date: string, min: number): string {
  return `[data-slot-at="${date} ${Math.floor(min / SLOT_MIN)}"]`;
}

/** Shared time grid for day and week views (FR-008, FR-010, FR-012; 009 US5/US7: drafts by
 * press-and-drag, click, tap and keyboard ranges). */
export function TimeGrid({ days, sessions, tz, drafts, tasks }: Props) {
  const navigate = useGuardedNavigate();
  const scrollRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const pointer = useGridDrag(scrollRef, HOUR_PX, drafts);
  const { draft, phase } = drafts.state;
  const today = todayISO(tz);
  const [now, setNow] = useState(() => nowMinutes(tz));
  const [active, setActive] = useState(() => ({
    day: Math.max(0, days.indexOf(today)),
    slot: (9 * 60) / SLOT_MIN,
  }));
  const daysKey = days.join(",");

  useEffect(() => {
    const id = window.setInterval(() => setNow(nowMinutes(tz)), 60_000);
    return () => window.clearInterval(id);
  }, [tz]);

  // initial scroll: first session of the period (minus 30 min) or 07:00
  useEffect(() => {
    if (!scrollRef.current) return;
    const starts = sessions.map((s) => minutesOf(s.start));
    const first = starts.length ? Math.max(0, Math.min(...starts) - 30) : 7 * 60;
    scrollRef.current.scrollTop = (Math.min(first, 7 * 60) / 60) * HOUR_PX;
    // only when the visible period changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daysKey]);

  // the draft takes part in the overlap layout, so overlapping entries stay visible beside it
  // (FR-028). Only the draft's day is laid out again while it moves; the other days keep their
  // layout (and their memoized entries), so a drag stays light in a full week (SC-003).
  const byDay = useMemo(() => {
    const out = new Map<string, Session[]>();
    for (const s of sessions) out.set(s.date, [...(out.get(s.date) ?? []), s]);
    return out;
  }, [sessions]);
  const baseLayout = useMemo(() => {
    const out = new Map<string, Map<string, Placement>>();
    for (const [d, list] of byDay) out.set(d, layoutOverlaps(list.map((s) => ({ key: s.key, start: minutesOf(s.start), end: minutesOf(s.end) }))));
    return out;
  }, [byDay]);
  const draftDate = draft?.date;
  const draftStart = draft?.startMin;
  const draftEnd = draft?.endMin;
  const draftLayout = useMemo(() => {
    if (draftDate === undefined || draftStart === undefined || draftEnd === undefined) return null;
    const items = (byDay.get(draftDate) ?? []).map((s) => ({ key: s.key, start: minutesOf(s.start), end: minutesOf(s.end) }));
    items.push({ key: DRAFT_KEY, start: draftStart, end: draftEnd });
    return layoutOverlaps(items);
  }, [byDay, draftDate, draftStart, draftEnd]);
  const layoutOf = (d: string) => (d === draftDate && draftLayout ? draftLayout : baseLayout.get(d));

  const activeDay = Math.min(active.day, days.length - 1);

  const focusSlot = (day: number, slot: number) => {
    const d = Math.max(0, Math.min(days.length - 1, day));
    const s = Math.max(0, Math.min(SLOTS - 1, slot));
    setActive({ day: d, slot: s });
    requestAnimationFrame(() => {
      const el = scrollRef.current?.querySelector<HTMLButtonElement>(`[data-slot="${d}-${s}"]`);
      el?.focus();
      el?.scrollIntoView({ block: "nearest" });
    });
  };

  /** The keyboard range (a draft in the `select` phase) as slots, if it is in this view. */
  const selection = (): KeyRange | null => {
    if (!draft || phase !== "select") return null;
    const day = days.indexOf(draft.date);
    if (day < 0) return null;
    const slot = Math.floor(draft.startMin / SLOT_MIN);
    return { day, slot, len: Math.max(1, Math.round((draft.endMin - draft.startMin) / SLOT_MIN)) };
  };

  const select = (r: KeyRange) => {
    const range = keyRangeMinutes(r);
    if (draft && phase === "select") drafts.update(draft.id, range, days[r.day]);
    else drafts.start(days[r.day], range, "keyboard", "select");
    focusSlot(r.day, r.slot);
  };

  /** Enter/Space (or an assistive-technology click): the quick form for the range, or a
   * one-hour draft from the focused slot (FR-042). */
  const openAt = (day: number, slot: number) => {
    const sel = selection();
    if (sel && draft) drafts.open(draft.id);
    else drafts.start(days[day], clickDraft(slot * SLOT_MIN), "keyboard", "open");
  };

  // stable handlers for the memoized columns; they call the latest render's functions
  const latest = useRef({ openAt, navigate });
  useEffect(() => {
    latest.current = { openAt, navigate };
  });
  const onSlotFocus = useCallback((day: number, slot: number) => setActive({ day, slot }), []);
  const onSlotClick = useCallback((day: number, slot: number) => latest.current.openAt(day, slot), []);
  const onOpenEntry = useCallback((key: string) => latest.current.navigate(`/sessions/${encodeURIComponent(key)}`), []);

  const onGridKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    // only the slot buttons (shadcn parts carry their own `data-slot` names)
    if (!target.dataset.slot || !target.hasAttribute("data-slot-at")) return;
    const [d, s] = target.dataset.slot.split("-").map(Number);
    const arrows: Record<string, RangeKey> = { ArrowUp: "ArrowUp", ArrowDown: "ArrowDown", ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight" };
    const sel = selection();
    if (arrows[e.key]) {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        select(moveRange(sel ?? { day: d, slot: s, len: 1 }, arrows[e.key], true, days.length));
      } else if (sel) {
        select(moveRange(sel, arrows[e.key], false, days.length));
      } else {
        const [dd, ds] = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[arrows[e.key]];
        focusSlot(d + dd, s + ds);
      }
    } else if (e.key === "PageUp" || e.key === "PageDown") {
      e.preventDefault();
      e.stopPropagation();
      focusSlot(d, s + (e.key === "PageUp" ? -4 : 4));
    } else if (e.key === "Home") {
      e.preventDefault();
      focusSlot(d, 0);
    } else if (e.key === "End") {
      e.preventDefault();
      focusSlot(d, SLOTS - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault(); // no native button click
      openAt(d, s);
    } else if (e.key === "Escape" && draft && phase !== "open") {
      e.preventDefault();
      drafts.discard(draft.id);
    }
  };

  const cols = `56px repeat(${days.length}, minmax(0,1fr))`;

  return (
    <div className="flex h-full min-h-0 flex-col" data-calendar-grid>
      <div className="grid border-b border-divider pr-[var(--scrollbar,0px)]" style={{ gridTemplateColumns: cols }}>
        <div />
        {days.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => navigate(calendarPath("day", d))}
            aria-label={`Open ${formatDay(d)} in day view`}
            className="rounded-md px-2 py-2 text-center hover:bg-accent"
          >
            <div className="text-xs text-muted-foreground">{formatDay(d, "EEE")}</div>
            <div
              className={cn(
                "mx-auto mt-0.5 grid size-8 place-items-center rounded-full text-lg tabular-nums",
                d === today && "bg-primary font-semibold text-primary-foreground",
              )}
            >
              {formatDay(d, "d")}
            </div>
          </button>
        ))}
      </div>
      {tasks && days.some((d) => tasks.dateOnly.has(d)) && <DueStrip days={days} tasks={tasks.dateOnly} columns={cols} />}
      {/* keyboard handling lives on the grid; slots are buttons with a roving tabindex */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div
        ref={scrollRef}
        data-calendar-scroll
        className="min-h-0 flex-1 overflow-y-auto"
        onKeyDown={onGridKey}
        onBlur={(e) => {
          // a keyboard range is cleared when focus leaves the grid (not when the form opens)
          if (draft && phase === "select" && !e.currentTarget.contains(e.relatedTarget as Node | null)) drafts.discard(draft.id);
        }}
      >
        <div className="relative grid" style={{ gridTemplateColumns: cols, height: 24 * HOUR_PX }}>
          <div className="relative" aria-hidden>
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="absolute right-2 -translate-y-1/2 text-[11px] tabular-nums text-muted-foreground" style={{ top: h * HOUR_PX }}>
                {h === 0 ? "" : `${String(h).padStart(2, "0")}:00`}
              </div>
            ))}
          </div>
          {days.map((d, di) => (
            // pointer handlers start drafts; keyboard users create them from the slot buttons
            <div
              key={d}
              className="relative touch-pan-y select-none border-l border-grid-line"
              role="group"
              aria-label={formatDay(d)}
              data-day={d}
              onPointerDown={(e) => pointer.onPointerDown(e, d)}
              onPointerMove={pointer.onPointerMove}
              onPointerUp={pointer.onPointerUp}
              onPointerCancel={pointer.onPointerCancel}
            >
              <ColumnSlots
                day={d}
                dayIndex={di}
                activeSlot={di === activeDay ? active.slot : -1}
                onSlotFocus={onSlotFocus}
                onSlotClick={onSlotClick}
              />
              {d === today && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-now-line before:absolute before:-left-1 before:-top-[5px] before:size-2 before:rounded-full before:bg-now-line"
                  style={{ top: (now / 60) * HOUR_PX }}
                />
              )}
              <ColumnEntries sessions={byDay.get(d) ?? NO_SESSIONS} layout={layoutOf(d)} onOpen={onOpenEntry} />
              {tasks?.timed.has(d) && <TimedTasks entries={tasks.timed.get(d)!} />}
              {draft && draft.date === d && (
                <DraftBlock
                  label={rangeLabel(draft)}
                  top={(draft.startMin / 60) * HOUR_PX}
                  height={Math.max(((draft.endMin - draft.startMin) / 60) * HOUR_PX - 2, MIN_EVENT_PX - 8)}
                  placement={draftLayout?.get(DRAFT_KEY) ?? { column: 0, columns: 1 }}
                  animate={!reduceMotion && phase !== "drag"}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Grid lines and the 96 slot buttons of one day; memoized so drafts don't re-render them. */
const ColumnSlots = memo(function ColumnSlots({ day, dayIndex, activeSlot, onSlotFocus, onSlotClick }: {
  day: string;
  dayIndex: number;
  /** The roving-tabindex slot when it is in this day, else -1. */
  activeSlot: number;
  onSlotFocus: (day: number, slot: number) => void;
  onSlotClick: (day: number, slot: number) => void;
}) {
  return (
    <>
      {Array.from({ length: 24 }, (_, h) => (
        <div key={h} aria-hidden className="pointer-events-none absolute inset-x-0 border-t border-grid-line" style={{ top: h * HOUR_PX }} />
      ))}
      {Array.from({ length: SLOTS }, (_, si) => (
        <button
          key={si}
          type="button"
          data-slot={`${dayIndex}-${si}`}
          data-slot-at={`${day} ${si}`}
          tabIndex={si === activeSlot ? 0 : -1}
          aria-label={`New entry on ${formatDay(day)} at ${formatHHmm(si * SLOT_MIN)}`}
          onFocus={() => onSlotFocus(dayIndex, si)}
          // pointer clicks are handled by the column (press-and-drag); a click without
          // a pointer (assistive technology) opens a one-hour draft here
          onClick={(e) => e.detail === 0 && onSlotClick(dayIndex, si)}
          className="absolute inset-x-0 block focus-visible:z-10 focus-visible:bg-accent/70 focus-visible:outline-2 focus-visible:-outline-offset-2"
          style={{ top: si * SLOT_PX, height: SLOT_PX }}
        />
      ))}
    </>
  );
});

/** One day's entries, side by side where they overlap; memoized per day (see `layoutOf`). */
const ColumnEntries = memo(function ColumnEntries({ sessions, layout, onOpen }: {
  sessions: Session[];
  layout: Map<string, Placement> | undefined;
  onOpen: (key: string) => void;
}) {
  return sessions.map((s) => {
    const top = (minutesOf(s.start) / 60) * HOUR_PX;
    const height = Math.max(((minutesOf(s.end) - minutesOf(s.start)) / 60) * HOUR_PX - 2, MIN_EVENT_PX);
    const p = layout?.get(s.key) ?? { column: 0, columns: 1 };
    const width = 100 / p.columns;
    return (
      <EventBlock
        key={s.key}
        session={s}
        kind={s.kind}
        compact={height < 40}
        className="absolute z-10"
        style={{
          top: top + 1,
          height,
          left: `calc(${p.column * width}% + 2px)`,
          width: `calc(${width}% - 4px)`,
        }}
        onClick={() => onOpen(s.key)}
      />
    );
  });
});

const MARKER_PX = 20;

/**
 * 012 FR-047/FR-051: a day's timed tasks in their own layer, outside the overlap layout, so entries
 * never shrink for them. Compact markers on the right at their due time; tasks due at the same
 * time stack downwards.
 */
function TimedTasks({ entries }: { entries: CalendarTask[] }) {
  const taken = new Map<number, number>();
  return (
    <div className="pointer-events-none absolute inset-0 z-[15]">
      {entries.map((e) => {
        const [h, m] = (e.task.dueTime ?? "00:00").split(":").map(Number);
        const top = Math.min(((h * 60 + m) / 60) * HOUR_PX, 24 * HOUR_PX - MARKER_PX);
        const row = Math.round(top);
        const n = taken.get(row) ?? 0;
        taken.set(row, n + 1);
        return (
          <TaskMarker
            key={e.task.id}
            entry={e}
            className="pointer-events-auto absolute right-0.5 max-w-[60%]"
            style={{ top: top + n * MARKER_PX }}
          />
        );
      })}
    </div>
  );
}

/** The new-entry draft: draft tokens, dashed edge (never colour alone), its time range as text.
 * Hidden from assistive technology; the live region announces it instead (FR-043). */
function DraftBlock({ label, top, height, placement, animate }: {
  label: string;
  top: number;
  height: number;
  placement: Placement;
  animate: boolean;
}) {
  const width = 100 / placement.columns;
  return (
    <div
      data-draft
      aria-hidden
      className={cn(
        "absolute z-20 overflow-hidden rounded-[6px] border-2 border-dashed border-draft-border bg-draft-bg px-1.5 py-0.5 text-xs font-semibold leading-tight text-draft-fg shadow-sm",
        animate && "transition-[top,height] duration-100 ease-out",
      )}
      style={{ top: top + 1, height, left: `calc(${placement.column * width}% + 2px)`, width: `calc(${width}% - 4px)` }}
    >
      <span className="tabular-nums">{label}</span>
    </div>
  );
}
