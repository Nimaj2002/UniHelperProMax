import { useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Session } from "@/features/classes/api";
import { formatDay, monthGrid, sameMonth, todayISO } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { EventBlock } from "./EventBlock";
import { calendarPath } from "./state";

const CHIP_PX = 22;
const HEADER_PX = 28;

interface Props {
  date: string;
  sessions: Session[];
  tz: string;
  /** Chips shown before "+N more" (tests); otherwise computed from the cell height. */
  maxChips?: number;
}

export function MonthView({ date, sessions, tz, maxChips }: Props) {
  const days = monthGrid(date);
  const today = todayISO(tz);
  const navigate = useNavigate();
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
              const shown = list.length > fit ? list.slice(0, fit) : list;
              const hidden = list.length - shown.length;
              const inMonth = sameMonth(d, date);
              return (
                <div
                  key={d}
                  role="gridcell"
                  aria-label={formatDay(d)}
                  className={cn("min-h-0 overflow-hidden border-b border-l border-grid-line p-1", !inMonth && "bg-surface-sunken")}
                >
                  <button
                    type="button"
                    onClick={() => navigate(calendarPath("day", d))}
                    aria-label={`Open ${formatDay(d)} in day view`}
                    className={cn(
                      "mb-0.5 grid size-6 place-items-center rounded-full text-xs tabular-nums hover:bg-accent",
                      !inMonth && "text-muted-foreground",
                      d === today && "bg-primary font-semibold text-primary-foreground hover:bg-primary",
                    )}
                  >
                    {formatDay(d, "d")}
                  </button>
                  <div className="grid gap-0.5">
                    {shown.map((s) => (
                      <EventBlock
                        key={s.key}
                        session={s}
                        compact
                        className="h-5 py-0"
                        onClick={() => navigate(`/sessions/${encodeURIComponent(s.key)}`)}
                      />
                    ))}
                    {hidden > 0 && (
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            className="h-5 rounded px-1 text-left text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                            aria-label={`Show ${hidden} more sessions on ${formatDay(d)}`}
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
                                onClick={() => navigate(`/sessions/${encodeURIComponent(s.key)}`)}
                              />
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
