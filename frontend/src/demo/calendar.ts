/**
 * 024: calendar logic for the demo — dates, weekly recurrence and session views — mirroring the
 * backend's shapes (session key = `<lineageId>:<YYYY-MM-DD>`, wall-clock ISO times with offset).
 * Only weekly / one-off patterns exist in the app, so this stays small.
 */
import { TZDate } from "@date-fns/tz";
import type { Schemas } from "@/lib/api";
import { getSlices, getStore, type DemoStore, type Series } from "./store";

const DAY = 86_400_000;
export const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

const utc = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const isoOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function addDays(iso: string, days: number): string {
  return isoOf(utc(iso) + days * DAY);
}

export function weekdayOf(iso: string): Weekday {
  return WEEKDAYS[(new Date(utc(iso)).getUTCDay() + 6) % 7];
}

/** Monday of the week containing `iso`. */
export function mondayOf(iso: string): string {
  return addDays(iso, -WEEKDAYS.indexOf(weekdayOf(iso)));
}

/** Today's date in the store's time zone. */
export function todayIso(store: Pick<DemoStore, "now" | "timeZone"> = getStore()): string {
  return new TZDate(store.now.getTime(), store.timeZone).toISOString().slice(0, 10);
}

/** `2026-11-08T09:40:00+03:00` — wall time in the user's zone, like the backend's isoformat(). */
export function zoned(date: string, time: string, timeZone = getStore().timeZone): string {
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  return new TZDate(y, m - 1, d, h, mi, 0, timeZone).toISOString().replace(".000", "");
}

export const sessionKey = (lineageId: string, date: string) => `${lineageId}:${date}`;

export function parseKey(key: string): { lineageId: string; date: string } | null {
  const i = key.lastIndexOf(":");
  if (i <= 0) return null;
  const date = key.slice(i + 1);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? { lineageId: key.slice(0, i), date } : null;
}

function semesterOf(series: Series): Schemas["Semester"] | undefined {
  return getStore().semesters.find((s) => s.id === series.semesterId);
}

/** Every scheduled date of a series (before per-occurrence overrides). */
export function seriesDates(series: Series): string[] {
  const r = series.recurrence;
  if (r.freq === "none") return [series.startDate];
  const sem = semesterOf(series);
  const end = r.end ?? { kind: "semester_end" };
  const until = end.kind === "until" ? end.untilDate : end.kind === "semester_end" ? sem?.endDate : null;
  const limit = until ?? addDays(series.startDate, 7 * 26);
  const max = end.kind === "count" ? (end.count ?? 1) : Infinity;
  const days = r.byWeekday?.length ? r.byWeekday : [weekdayOf(series.startDate)];
  const interval = r.intervalWeeks ?? 1;
  const out: string[] = [];
  const firstMonday = mondayOf(series.startDate);
  for (let week = 0; out.length < max; week += interval) {
    const monday = addDays(firstMonday, week * 7);
    if (monday > limit) break;
    for (const wd of WEEKDAYS) {
      if (!days.includes(wd)) continue;
      const d = addDays(monday, WEEKDAYS.indexOf(wd));
      if (d < series.startDate || d > limit || out.length >= max) continue;
      out.push(d);
    }
  }
  return out;
}

const DAY_NAMES: Record<Weekday, string> = { MO: "Mon", TU: "Tue", WE: "Wed", TH: "Thu", FR: "Fri", SA: "Sat", SU: "Sun" };

export function recurrenceSummary(r: Schemas["Recurrence"]): string {
  if (r.freq === "none") return "Does not repeat";
  const interval = r.intervalWeeks ?? 1;
  let head = interval === 1 ? "Weekly" : `Every ${interval} weeks`;
  head += ` on ${(r.byWeekday ?? []).map((d) => DAY_NAMES[d]).join(", ")}`;
  const end = r.end;
  if (!end || end.kind === "semester_end") return `${head} until semester end`;
  if (end.kind === "until" && end.untilDate) {
    const d = new Date(utc(end.untilDate));
    return `${head} until ${d.getUTCDate()} ${d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })} ${d.getUTCFullYear()}`;
  }
  if (end.kind === "count" && end.count) return `${head}, ${end.count} times`;
  return head;
}

export function sessionOut(series: Series, scheduledDate: string): Schemas["SessionOut"] | null {
  const store = getStore();
  const key = sessionKey(series.lineageId, scheduledDate);
  const o = store.overrides[key];
  if (o?.deleted) return null;
  const course = series.courseId ? store.courses.find((c) => c.id === series.courseId) : undefined;
  const date = o?.date ?? scheduledDate;
  const start = zoned(date, o?.startTime ?? series.startTime);
  const end = zoned(date, o?.endTime ?? series.endTime);
  return {
    key,
    kind: series.kind,
    lineageId: series.lineageId,
    seriesId: series.id,
    seriesVersion: series.version,
    courseId: course?.id ?? null,
    courseName: course?.name ?? null,
    semesterId: series.semesterId,
    title: o?.title !== undefined ? o.title : series.title,
    date,
    start,
    end,
    location: o?.location !== undefined ? o.location : series.location,
    color: o?.color ?? series.color,
    links: series.links,
    recurrenceSummary: recurrenceSummary(series.recurrence),
    isException: !!o,
    exceptionVersion: o ? o.version : null,
    status: Date.parse(end) < store.now.getTime() ? "past" : "upcoming",
    scheduled: true,
    taskId: getSlices().reduce<string | null>((id, s) => id ?? s.taskFor?.(key) ?? null, null),
  };
}

export function seriesSessions(series: Series): Schemas["SessionOut"][] {
  return seriesDates(series)
    .map((d) => sessionOut(series, d))
    .filter((s): s is Schemas["SessionOut"] => s !== null);
}

export function allSessions(): Schemas["SessionOut"][] {
  return getStore()
    .series.flatMap(seriesSessions)
    .sort((a, b) => a.start.localeCompare(b.start) || a.key.localeCompare(b.key));
}

export function getSession(key: string): Schemas["SessionOut"] | null {
  const k = parseKey(key);
  if (!k) return null;
  const series = getStore().series.find((s) => s.lineageId === k.lineageId);
  if (!series || !seriesDates(series).includes(k.date)) return null;
  return sessionOut(series, k.date);
}

export const seriesByLineage = (lineageId: string) => getStore().series.find((s) => s.lineageId === lineageId);

/** Keys of all sessions of the given lineages (for cascades and impact counts). */
export function keysOf(lineageIds: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const s of getStore().series) {
    if (!lineageIds.has(s.lineageId)) continue;
    for (const d of seriesDates(s)) out.add(sessionKey(s.lineageId, d));
  }
  return out;
}
