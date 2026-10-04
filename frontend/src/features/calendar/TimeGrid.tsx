import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router";
import type { Session } from "@/features/classes/api";
import { formatDay, formatHHmm, minutesOf, nowMinutes, todayISO } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { EventBlock } from "./EventBlock";
import { layoutOverlaps } from "./layoutOverlaps";
import { calendarPath } from "./state";

export const HOUR_PX = 48;
const SLOT_MIN = 30;
const SLOTS = (24 * 60) / SLOT_MIN;
const SLOT_PX = (HOUR_PX * SLOT_MIN) / 60;
const MIN_EVENT_PX = 20;

interface Props {
  days: string[];
  sessions: Session[];
  tz: string;
}

/** Shared time grid for day and week views (FR-008, FR-010, FR-012). */
export function TimeGrid({ days, sessions, tz }: Props) {
  const navigate = useNavigate();
  const scrollRef = useRef<HTMLDivElement>(null);
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

  const placements = useMemo(() => {
    const out = new Map<string, { column: number; columns: number }>();
    for (const d of days) {
      const items = sessions
        .filter((s) => s.date === d)
        .map((s) => ({ key: s.key, start: minutesOf(s.start), end: minutesOf(s.end) }));
      layoutOverlaps(items).forEach((v, k) => out.set(k, v));
    }
    return out;
  }, [days, sessions]);

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

  const openSlot = (day: string, slot: number) => {
    const start = slot * SLOT_MIN;
    const end = Math.min(start + 60, 24 * 60 - 5);
    navigate(`/classes/new?date=${day}&start=${formatHHmm(start)}&end=${formatHHmm(end)}`);
  };

  const onGridKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (!target.dataset.slot) return;
    const [d, s] = target.dataset.slot.split("-").map(Number);
    const moves: Record<string, [number, number]> = {
      ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
      PageUp: [0, -4], PageDown: [0, 4],
    };
    if (moves[e.key]) {
      e.preventDefault();
      e.stopPropagation();
      focusSlot(d + moves[e.key][0], s + moves[e.key][1]);
    } else if (e.key === "Home") {
      e.preventDefault();
      focusSlot(d, 0);
    } else if (e.key === "End") {
      e.preventDefault();
      focusSlot(d, SLOTS - 1);
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
      {/* keyboard handling lives on the grid; slots are buttons with a roving tabindex */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto" onKeyDown={onGridKey}>
        <div className="relative grid" style={{ gridTemplateColumns: cols, height: 24 * HOUR_PX }}>
          <div className="relative" aria-hidden>
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="absolute right-2 -translate-y-1/2 text-[11px] tabular-nums text-muted-foreground" style={{ top: h * HOUR_PX }}>
                {h === 0 ? "" : `${String(h).padStart(2, "0")}:00`}
              </div>
            ))}
          </div>
          {days.map((d, di) => (
            <div key={d} className="relative border-l border-grid-line" role="group" aria-label={formatDay(d)}>
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} aria-hidden className="pointer-events-none absolute inset-x-0 border-t border-grid-line" style={{ top: h * HOUR_PX }} />
              ))}
              {Array.from({ length: SLOTS }, (_, si) => (
                <button
                  key={si}
                  type="button"
                  data-slot={`${di}-${si}`}
                  tabIndex={di === activeDay && si === active.slot ? 0 : -1}
                  aria-label={`New class on ${formatDay(d)} at ${formatHHmm(si * SLOT_MIN)}`}
                  onFocus={() => setActive({ day: di, slot: si })}
                  onClick={() => openSlot(d, si)}
                  className="absolute inset-x-0 block focus-visible:z-10 focus-visible:bg-accent/70 focus-visible:outline-2 focus-visible:-outline-offset-2"
                  style={{ top: si * SLOT_PX, height: SLOT_PX }}
                />
              ))}
              {d === today && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-now-line before:absolute before:-left-1 before:-top-[5px] before:size-2 before:rounded-full before:bg-now-line"
                  style={{ top: (now / 60) * HOUR_PX }}
                />
              )}
              {sessions
                .filter((s) => s.date === d)
                .map((s) => {
                  const top = (minutesOf(s.start) / 60) * HOUR_PX;
                  const height = Math.max(((minutesOf(s.end) - minutesOf(s.start)) / 60) * HOUR_PX - 2, MIN_EVENT_PX);
                  const p = placements.get(s.key) ?? { column: 0, columns: 1 };
                  const width = 100 / p.columns;
                  return (
                    <EventBlock
                      key={s.key}
                      session={s}
                      compact={height < 40}
                      className="absolute z-10"
                      style={{
                        top: top + 1,
                        height,
                        left: `calc(${p.column * width}% + 2px)`,
                        width: `calc(${width}% - 4px)`,
                      }}
                      onClick={() => navigate(`/sessions/${encodeURIComponent(s.key)}`)}
                    />
                  );
                })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
