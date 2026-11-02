import { useEffect, type ReactNode, type UIEvent } from "react";
import { Card } from "@/app/shell/Card";
import { CalendarPage } from "@/features/calendar/CalendarPage";
import { rememberScroll, restoreScroll, scrollKeys } from "./scrollMemory";

interface Props {
  open: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
}

const GRID = "#calendar-panel [data-calendar-scroll]";

/** The time grid's scroll is remembered while the user scrolls (FR-089). */
function onScrollCapture(e: UIEvent<HTMLElement>) {
  const target = e.target as HTMLElement;
  if (target.matches?.("[data-calendar-scroll]")) rememberScroll(scrollKeys.calendarGrid, target.scrollTop);
}

/**
 * The home page's Calendar panel (FR-063): the compact header and the calendar, each in its own card. It stays
 * mounted while closed (hidden and inert, FR-075), marked so the calendar's single-key shortcuts
 * stay off (FR-095). Coming back to the home page restores the time grid's scroll (FR-089).
 */
export function CalendarPanel({ open, leading, trailing }: Props) {
  // runs after the grid's own first scroll (child effects run first), so the remembered one wins
  useEffect(() => {
    const el = document.querySelector<HTMLElement>(GRID);
    if (el) restoreScroll(scrollKeys.calendarGrid, el);
  }, []);
  return (
    <Card
      as="section"
      id="calendar-panel"
      data-panel="calendar"
      data-calendar-closed={open ? undefined : ""}
      label="Calendar"
      body="fill"
      chrome={false}
      hidden={!open}
      inert={!open}
      className="@container/calendar h-full"
      onScrollCapture={onScrollCapture}
    >
      <CalendarPage compact leading={leading} trailing={trailing} />
    </Card>
  );
}
