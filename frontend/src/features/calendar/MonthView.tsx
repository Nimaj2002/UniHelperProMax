import { useLayoutEffect, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Session } from "@/features/classes/api";
import { formatDay, monthGrid, sameMonth, todayISO } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { TaskMarker } from "@/features/tasks/calendar/TaskMarker";
import type { CalendarTask, CalendarTasks } from "@/features/tasks/calendar/useCalendarTasks";
import { rangeLabel, type Draft } from "./draft";
import { EventBlock } from "./EventBlock";
import { useGuardedNavigate } from "./entryGuard";
import { calendarPath } from "./state";

const CHIP_PX = 22;
const HEADER_PX = 28;

interface Props {
  date: string;
  sessions: Session[];
  tz: string;
  /** Chips shown before "+N more" (tests); otherwise computed from the cell height. */
  maxChips?: number;
  /** 009: the new-entry draft, shown as a chip in its day. */
  draft?: Draft | null;
  /** 009 FR-029: a click on empty day space creates a 09:00–10:00 draft for that date. */
  onCreateDraft?: (date: string) => void;
  /** 012: tasks shown ("Show tasks" on), listed after the day's entries. */
  tasks?: CalendarTasks;
}

const NO_TASKS: CalendarTask[] = [];

/** Clicks on these are their own actions, never "empty day space". */
const OWN_ACTION = "button,a,[data-session-key],[data-draft],[role='dialog']";

export function MonthView({ date, sessions, tz, maxChips, draft, onCreateDraft, tasks }: Props) {
  const days = monthGrid(date);
  const today = todayISO(tz);
  const navigate = useGuardedNavigate();
  const gridRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(maxChips ?? 3);

  useLayoutEffect(() => {
    if (maxChips !== undefined || !gridRef.current) return;
    const el = gridRef.current;
    const measure = () => {
      const cellHeight = el.clientHeight / 6;
      // rows that fit, keeping one row free for the "+N more" button
      setFit(Math.max(1, Math.floor((cellHeight - HEADER_PX - 4) / CHIP_PX) - 1));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [maxChips]);

  const byDay = new Map<string, Session[]>();
  for (const s of sessions) byDay.set(s.date, [...(byDay.get(s.date) ?? []), s]);

  return (
    <div role="grid" aria-label={formatDay(date, "MMMM yyyy")} className="flex h-full min-h-0 flex-col">
      <div role="row" className="grid grid-cols-7 border-b border-divider">
        {days.slice(0, 7).map((d) => (
          <div key={d} role="columnheader" className="py-2 text-center text-xs font-medium text-muted-foreground">
            {formatDay(d, "EEE")}
          </div>
        ))}
      </div>
      <div ref={gridRef} className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
        {Array.from({ length: 6 }, (_, row) => (
          <div key={row} role="row" className="contents">
            {days.slice(row * 7, row * 7 + 7).map((d) => {
              const list = byDay.get(d) ?? [];
              // the day's tasks follow its entries and share the "+N more" overflow
              const dayTasks = tasks ? [...(tasks.dateOnly.get(d) ?? NO_TASKS), ...(tasks.timed.get(d) ?? NO_TASKS)] : NO_TASKS;
              const total = list.length + dayTasks.length;
              const room = total > fit ? fit : total;
              const shown = list.slice(0, room);
              const shownTasks = dayTasks.slice(0, Math.max(0, room - shown.length));
              const hidden = total - shown.length - shownTasks.length;
              const what = dayTasks.length ? "entries" : "sessions";
              const inMonth = sameMonth(d, date);
              return (
                // a pointer shortcut only: keyboard users create entries from the time grid
                // (day view), which the day number opens
                // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus
                <div
                  key={d}
                  role="gridcell"
                  aria-label={formatDay(d)}
                  data-month-cell={d}
                  className={cn("min-h-0 overflow-hidden border-b border-l border-grid-line p-1", !inMonth && "bg-surface-sunken")}
                  onClick={(e) => {
                    if (!onCreateDraft || (e.target as Element).closest(OWN_ACTION)) return;
                    onCreateDraft(d);
                  }}
                >
                  <button
                    type="button"
                    onClick={() => navigate(calendarPath("day", d))}
                    aria-label={`Open ${formatDay(d)} in day view`}
                    data-month-day={d}
                    className={cn(
                      "mb-0.5 grid size-6 place-items-center rounded-full text-xs tabular-nums hover:bg-accent",
                      !inMonth && "text-muted-foreground",
                      d === today && "bg-primary font-semibold text-primary-foreground hover:bg-primary",
                    )}
                  >
                    {formatDay(d, "d")}
                  </button>
                  <div className="grid gap-0.5">
                    {draft?.date === d && (
                      <div
                        data-draft
                        aria-hidden
                        className="flex h-5 items-center truncate rounded-[6px] border-2 border-dashed border-draft-border bg-draft-bg px-1 text-xs font-semibold text-draft-fg"
                      >
                        <span className="truncate tabular-nums">{rangeLabel(draft)} New entry</span>
                      </div>
                    )}
                    {shown.map((s) => (
                      <EventBlock
                        key={s.key}
                        session={s}
                        kind={s.kind}
                        compact
                        className="h-5 py-0"
                        onClick={() => navigate(`/sessions/${encodeURIComponent(s.key)}`)}
                      />
                    ))}
                    {shownTasks.map((e) => (
                      <TaskMarker key={e.task.id} entry={e} />
                    ))}
                    {hidden > 0 && (
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            className="h-5 rounded px-1 text-left text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                            aria-label={`Show ${hidden} more ${what} on ${formatDay(d)}`}
                          >
                            +{hidden} more
                          </button>
                        </PopoverTrigger>
                        <PopoverContent role="dialog" aria-label={formatDay(d)} className="w-64 p-2">
                          <p className="mb-2 px-1 text-sm font-medium">{formatDay(d)}</p>
                          <div className="grid gap-1">
                            {list.map((s) => (
                              <EventBlock
                                key={s.key}
                                session={s}
                                kind={s.kind}
                                onClick={() => navigate(`/sessions/${encodeURIComponent(s.key)}`)}
                              />
                            ))}
                            {dayTasks.map((e) => (
                              <TaskMarker key={e.task.id} entry={e} />
                            ))}
                          </div>
                        </PopoverContent>
                      </Popover>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
