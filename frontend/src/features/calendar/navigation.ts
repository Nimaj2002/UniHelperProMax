import { shiftDay, shiftMonth } from "@/lib/dates";
import type { CalendarView } from "./state";

export function shiftPeriod(view: CalendarView, date: string, dir: 1 | -1): string {
  if (view === "day") return shiftDay(date, dir);
  if (view === "week") return shiftDay(date, 7 * dir);
  return shiftMonth(date, dir);
}

export const PERIOD_NOUN: Record<CalendarView, string> = { day: "day", week: "week", month: "month" };
