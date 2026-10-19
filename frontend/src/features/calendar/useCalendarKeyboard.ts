import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { todayISO } from "@/lib/dates";
import { hasModifier, isTypingTarget } from "@/lib/shortcuts";
import { shiftPeriod } from "./navigation";
import { calendarPath, type CalendarView } from "./state";

export const CALENDAR_SHORTCUTS: [string, string][] = [
  ["T", "Go to today"],
  ["D / W / M", "Day, week or month view"],
  ["← / →  or  K / J", "Previous / next period"],
  ["N", "New class"],
  ["E", "New event"],
  ["/", "Search courses"],
  ["[", "Show or hide the course panel"],
  ["Shift + C", "Show or hide the calendar panel (home page)"],
  ["Shift + T", "Show or hide the tasks panel (home page)"],
  ["Enter / Space", "Pick up the focused task card or column (task board)"],
  ["↑ / ↓ / ← / →", "Move a picked-up card within its column or to the next column"],
  ["Enter  or  Esc", "Drop the picked-up card, or cancel the move"],
  ["Arrow keys", "Move between 15-minute slots, or a day left/right (inside the calendar grid)"],
  ["Shift + ↑ / ↓", "Shorten or extend the highlighted range (inside the calendar grid)"],
  ["Enter", "New class or event for the highlighted range, or open the focused session"],
  ["Esc", "Clear the range, cancel a new entry, or close a dialog"],
  ["?", "Show keyboard shortcuts"],
];

/** Global calendar shortcuts; ignored while typing, inside dialogs, or inside the time grid. */
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
      if (e.defaultPrevented || hasModifier(e) || isTypingTarget(e.target)) return;
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
      switch (e.key) {
        case "t": go(todayISO(tz)); break;
        case "d": go(date, "day"); break;
        case "w": go(date, "week"); break;
        case "m": go(date, "month"); break;
        case "j": go(shiftPeriod(view, date, 1)); break;
        case "k": go(shiftPeriod(view, date, -1)); break;
        case "ArrowRight": if (inGrid) return; go(shiftPeriod(view, date, 1)); break;
        case "ArrowLeft": if (inGrid) return; go(shiftPeriod(view, date, -1)); break;
        case "n": navigate("/classes/new"); break;
        case "e": navigate("/events/new"); break;
        case "?": onHelp(); break;
        default: return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tz, navigate, onHelp]);
}
