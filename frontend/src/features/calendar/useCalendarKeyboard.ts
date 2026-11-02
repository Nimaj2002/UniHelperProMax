import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { todayISO } from "@/lib/dates";
import { matchFirst } from "@/lib/keymap";
import { hasModifier, isTypingTarget } from "@/lib/shortcuts";
import { shiftPeriod } from "./navigation";
import { calendarPath, type CalendarView } from "./state";

const CALENDAR_COMMANDS = [
  "calendar.today", "calendar.dayView", "calendar.weekView", "calendar.monthView", "calendar.nextPeriod",
  "calendar.prevPeriod", "calendar.newClass", "calendar.newEvent", "calendar.help",
] as const;

/** Global calendar shortcuts (keys from the 019 keymap); ignored while typing, inside dialogs, or inside the time grid. */
export function useCalendarKeyboard(view: CalendarView, date: string, tz: string, onHelp: () => void) {
  const navigate = useNavigate();
  // read the latest view/date at key time: rapid key presses must not use a stale closure
  const current = useRef({ view, date });
  useEffect(() => {
    current.current = { view, date };
  }, [view, date]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { view, date } = current.current;
      // a focused tool (the time grid, a menu) handles its own keys first (019 research R5)
      if (e.defaultPrevented || (!hasModifier(e) && isTypingTarget(e.target))) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest("[role='dialog'],[role='alertdialog'],[role='menu'],[role='listbox']")) return;
      // home page (012 FR-095): not while focus is in the Tasks panel or the Calendar panel is closed
      if (target?.closest('[data-panel="tasks"]') || document.querySelector("#calendar-panel[data-calendar-closed]")) return;
      if (document.querySelector("[role='dialog'][data-state='open'],[role='alertdialog'][data-state='open']")) return;
      const inGrid = !!target?.closest("[data-calendar-grid]");
      const go = (d: string, v: CalendarView = view) => {
        current.current = { view: v, date: d };
        navigate(calendarPath(v, d));
      };
      // arrow keys inside the grid move between its slots, even where the grid doesn't handle them
      if (inGrid && e.key.startsWith("Arrow")) return;
      switch (matchFirst(e, CALENDAR_COMMANDS)) {
        case "calendar.today": go(todayISO(tz)); break;
        case "calendar.dayView": go(date, "day"); break;
        case "calendar.weekView": go(date, "week"); break;
        case "calendar.monthView": go(date, "month"); break;
        case "calendar.nextPeriod": go(shiftPeriod(view, date, 1)); break;
        case "calendar.prevPeriod": go(shiftPeriod(view, date, -1)); break;
        case "calendar.newClass": navigate("/classes/new"); break;
        case "calendar.newEvent": navigate("/events/new"); break;
        case "calendar.help": onHelp(); break;
        default: return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tz, navigate, onHelp]);
}
