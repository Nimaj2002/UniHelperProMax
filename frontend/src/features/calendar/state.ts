/** Remembers the last calendar view/date so overlays (/classes/new, /sessions/:key) render
 * over the calendar the user was looking at. */
export type CalendarView = "day" | "week" | "month";

export const VIEWS: CalendarView[] = ["day", "week", "month"];

let last: { view: CalendarView | null; date: string | null } = { view: null, date: null };

export function rememberCalendar(view: CalendarView, date: string) {
  last = { view, date };
}

export function lastCalendar() {
  return last;
}

export function calendarPath(view: CalendarView, date: string) {
  return `/calendar/${view}/${date}`;
}

export function lastCalendarPath(): string {
  return last.view && last.date ? calendarPath(last.view, last.date) : "/calendar";
}
