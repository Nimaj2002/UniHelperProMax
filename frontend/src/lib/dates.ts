/**
 * Calendar date helpers. Calendar days are handled as ISO strings (YYYY-MM-DD) and Date
 * objects at local noon (immune to DST edges). Session times come from the API already in
 * the user's time zone (ISO with offset), so wall-clock minutes are read from the string.
 */
import { TZDate } from "@date-fns/tz";
import { addDays, addMonths, endOfMonth, format, parseISO, startOfMonth, startOfWeek } from "date-fns";

export const WEEK_OPTS = { weekStartsOn: 1 as const };

export function toISODate(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

/** Parse YYYY-MM-DD as a local date at noon. */
export function fromISODate(iso: string): Date {
  const d = parseISO(iso);
  d.setHours(12, 0, 0, 0);
  return d;
}

export function todayISO(tz?: string): string {
  return tz ? format(new TZDate(Date.now(), tz), "yyyy-MM-dd") : toISODate(new Date());
}

export function weekStart(iso: string): string {
  return toISODate(startOfWeek(fromISODate(iso), WEEK_OPTS));
}

export function weekDays(iso: string): string[] {
  const start = fromISODate(weekStart(iso));
  return Array.from({ length: 7 }, (_, i) => toISODate(addDays(start, i)));
}

export function weekRange(iso: string): { from: string; to: string } {
  const days = weekDays(iso);
  return { from: days[0], to: days[6] };
}

/** 6×7 grid of days covering the month of `iso`, starting Monday. */
export function monthGrid(iso: string): string[] {
  const first = startOfWeek(startOfMonth(fromISODate(iso)), WEEK_OPTS);
  return Array.from({ length: 42 }, (_, i) => toISODate(addDays(first, i)));
}

export function monthRange(iso: string): { from: string; to: string } {
  const grid = monthGrid(iso);
  return { from: grid[0], to: grid[41] };
}

export function sameMonth(a: string, b: string): boolean {
  return a.slice(0, 7) === b.slice(0, 7);
}

export function shiftDay(iso: string, days: number): string {
  return toISODate(addDays(fromISODate(iso), days));
}

export function shiftMonth(iso: string, months: number): string {
  return toISODate(addMonths(fromISODate(iso), months));
}

export function endOfMonthISO(iso: string): string {
  return toISODate(endOfMonth(fromISODate(iso)));
}

/** "10:30" from "2026-10-05T10:30:00+03:00" (wall clock in the user's zone). */
export function wallTime(isoDateTime: string): string {
  return isoDateTime.slice(11, 16);
}

export function minutesOf(isoDateTime: string): number {
  const [h, m] = wallTime(isoDateTime).split(":").map(Number);
  return h * 60 + m;
}

export function parseTimeHHmm(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

export function formatHHmm(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function nowMinutes(tz: string): number {
  const now = new TZDate(Date.now(), tz);
  return now.getHours() * 60 + now.getMinutes();
}

export function formatDay(iso: string, pattern = "EEEE d MMMM"): string {
  return format(fromISODate(iso), pattern);
}

export function formatRangeLabel(view: "day" | "week" | "month", iso: string): string {
  if (view === "day") return format(fromISODate(iso), "EEEE, d MMMM yyyy");
  if (view === "month") return format(fromISODate(iso), "MMMM yyyy");
  const days = weekDays(iso);
  const a = fromISODate(days[0]);
  const b = fromISODate(days[6]);
  if (a.getFullYear() !== b.getFullYear()) return `${format(a, "d MMM yyyy")} – ${format(b, "d MMM yyyy")}`;
  if (a.getMonth() !== b.getMonth()) return `${format(a, "d MMM")} – ${format(b, "d MMM yyyy")}`;
  return `${format(a, "d")} – ${format(b, "d MMMM yyyy")}`;
}

/** Compact label for narrow screens: "5 Oct", "5–11 Oct", "Oct 2026". */
export function formatShortRangeLabel(view: "day" | "week" | "month", iso: string): string {
  if (view === "day") return format(fromISODate(iso), "EEE d MMM");
  if (view === "month") return format(fromISODate(iso), "MMM yyyy");
  const days = weekDays(iso);
  const a = fromISODate(days[0]);
  const b = fromISODate(days[6]);
  return a.getMonth() === b.getMonth() ? `${format(a, "d")}–${format(b, "d MMM")}` : `${format(a, "d MMM")}–${format(b, "d MMM")}`;
}
