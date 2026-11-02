/**
 * Local days in the user's time zone (020 FR-048, FR-061): an entry is shown and counted on each
 * day for the part that falls on it, also on daylight-saving days (23 or 25 hours long).
 */
import { TZDate } from "@date-fns/tz";
import { addDays, format } from "date-fns";

/** UTC instants (ms) where the local day `iso` starts and ends. */
export function dayBounds(iso: string, tz: string): { start: number; end: number } {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const start = new TZDate(y, m - 1, d, tz);
  return { start: start.getTime(), end: addDays(start, 1).getTime() };
}

/** `[from, to)` as ISO strings covering the local days `firstIso` … `lastIso`. */
export function rangeOf(firstIso: string, lastIso: string, tz: string): { from: string; to: string } {
  return { from: new Date(dayBounds(firstIso, tz).start).toISOString(), to: new Date(dayBounds(lastIso, tz).end).toISOString() };
}

export const localDay = (ms: number, tz: string) => format(new TZDate(ms, tz), "yyyy-MM-dd");

export interface DayPart {
  day: string;
  start: number;
  end: number;
}

/** Split `[start, end)` at local midnights. */
export function splitByDay(start: number, end: number, tz: string): DayPart[] {
  const parts: DayPart[] = [];
  let cursor = start;
  while (cursor < end) {
    const day = localDay(cursor, tz);
    const dayEnd = Math.min(dayBounds(day, tz).end, end);
    parts.push({ day, start: cursor, end: dayEnd });
    cursor = dayEnd;
  }
  return parts;
}

/** Seconds of `[start, end)` inside `[from, to)`, less paused time in proportion. */
export function clippedSeconds(e: { startedAt: string; endedAt: string; pausedSeconds: number }, from: number, to: number): number {
  const s = Date.parse(e.startedAt);
  const f = Date.parse(e.endedAt);
  const inside = Math.max(0, Math.min(f, to) - Math.max(s, from));
  const span = f - s;
  if (span <= 0) return 0;
  return ((inside / span) * (span - e.pausedSeconds * 1000)) / 1000;
}

/** Minutes since local midnight of `day` (for the calendar grid). */
export function minutesInDay(ms: number, day: string, tz: string): number {
  return (ms - dayBounds(day, tz).start) / 60_000;
}

export const timeOfDay = (ms: number, tz: string) => format(new TZDate(ms, tz), "HH:mm");

/** `datetime-local` value for an instant, in the user's time zone. */
export const toLocalInput = (ms: number, tz: string) => format(new TZDate(ms, tz), "yyyy-MM-dd'T'HH:mm");

/** The instant a `datetime-local` value means in the user's time zone (NaN when empty). */
export function fromLocalInput(value: string, tz: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return NaN;
  const [, y, mo, d, h, mi] = m.map(Number) as [number, number, number, number, number, number];
  return new TZDate(y, mo - 1, d, h, mi, tz).getTime();
}
