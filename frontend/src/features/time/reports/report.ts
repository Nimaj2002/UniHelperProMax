/**
 * Report maths (020 FR-050–FR-055), pure: entries are clipped to the period, grouped by tag,
 * course or day, with share and entry count. Small slices merge into "Other" for the chart only.
 */
import type { Entry } from "../api";
import { clippedSeconds, dayBounds, splitByDay } from "../days";

export type Group = "tag" | "course" | "day";

export interface Row {
  key: string;
  name: string;
  color: string | null;
  seconds: number;
  /** 0–1 of the period total. */
  share: number;
  count: number;
  entries: Entry[];
}

export interface Names {
  tag: (id: string) => { name: string; color: string } | undefined;
  course: (id: string) => string | undefined;
  day: (iso: string) => string;
}

export const OTHER_SHARE = 0.03;

export function buildReport(entries: Entry[], from: number, to: number, group: Group, tz: string, names: Names): { total: number; rows: Row[] } {
  const rows = new Map<string, Row>();
  const add = (key: string, name: string, color: string | null, seconds: number, e: Entry) => {
    if (seconds <= 0) return;
    const row = rows.get(key) ?? { key, name, color, seconds: 0, share: 0, count: 0, entries: [] };
    row.seconds += seconds;
    if (!row.entries.includes(e)) {
      row.entries.push(e);
      row.count += 1;
    }
    rows.set(key, row);
  };
  for (const e of entries) {
    if (group === "day") {
      for (const part of splitByDay(Math.max(Date.parse(e.startedAt), from), Math.min(Date.parse(e.endedAt), to), tz)) {
        const { start, end } = dayBounds(part.day, tz);
        add(part.day, names.day(part.day), null, clippedSeconds(e, Math.max(start, from), Math.min(end, to)), e);
      }
      continue;
    }
    const seconds = clippedSeconds(e, from, to);
    if (group === "tag") {
      const tag = e.tagId ? names.tag(e.tagId) : undefined;
      add(tag ? e.tagId! : "none", tag?.name ?? "No tag", tag?.color ?? null, seconds, e);
    } else {
      const course = e.courseId ? names.course(e.courseId) : undefined;
      add(course ? e.courseId! : "none", course ?? "No course", null, seconds, e);
    }
  }
  const total = [...rows.values()].reduce((s, r) => s + r.seconds, 0);
  const list = [...rows.values()].map((r) => ({ ...r, share: total ? r.seconds / total : 0 }));
  list.sort(group === "day" ? (a, b) => a.key.localeCompare(b.key) : (a, b) => b.seconds - a.seconds);
  return { total, rows: list };
}

/** Chart slices: rows under 3 % of the total merge into one "Other" slice (FR-052). */
export function chartSlices(rows: Row[]): Row[] {
  const small = rows.filter((r) => r.share < OTHER_SHARE);
  if (small.length < 2) return rows;
  const other: Row = {
    key: "__other",
    name: "Other",
    color: null,
    seconds: small.reduce((s, r) => s + r.seconds, 0),
    share: small.reduce((s, r) => s + r.share, 0),
    count: small.reduce((s, r) => s + r.count, 0),
    entries: small.flatMap((r) => r.entries),
  };
  return [...rows.filter((r) => r.share >= OTHER_SHARE), other];
}
