/**
 * 024: local exports generated from the in-memory store (contracts/demo-mode.md §2): tasks CSV,
 * calendar .ics and time-entries CSV, with the real API's content types and file names. Nothing
 * leaves the tab — the browser downloads the response.
 */
import { TZDate } from "@date-fns/tz";
import { http, type HttpHandler } from "msw";
import { allSessions, todayIso } from "../calendar";
import { API, notFound, problem, validation } from "../http";
import { getStore } from "../store";
import { boardColumns, liveNotesOf, liveTasks, taskOut } from "./tasks";
import { entriesIn, rangeOf, tagName } from "./time";

const APP = "UniHelperProMax";

function file(body: string, type: string, filename: string, headers: Record<string, string> = {}) {
  return new Response(body, {
    headers: {
      "Content-Type": `${type}; charset=utf-8`,
      "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

/** RFC 4180 rows with CRLF line ends, quoted when needed (Python's csv.writer). */
function csv(rows: (string | number)[][]): string {
  const cell = (v: string | number) => (/[",\r\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return rows.map((r) => r.map(cell).join(",") + "\r\n").join("");
}

function tasksCsv(): string {
  const cols = new Map(boardColumns().map((c) => [c.id, c.name]));
  const header = ["Title", "Description", "Column", "Due date", "Due time", "Course", "Linked event", "Checklist", "Quick notes", "Completed at"];
  const rows = liveTasks().map((t) => {
    const o = taskOut(t);
    const notes = liveNotesOf(t.id)
      .reverse()
      .map((n) => (n.title && n.body ? `${n.title}: ${n.body}` : n.title || n.body));
    return [
      o.title,
      o.description,
      cols.get(o.columnId) ?? "",
      o.dueDate ?? "",
      o.dueTime ?? "",
      o.courseName ?? "",
      o.event ? `${o.title} (${o.event.date})` : "",
      t.checklist.map((i) => `[${i.done ? "x" : " "}] ${i.text}`).join("\n"),
      notes.join("\n\n"),
      o.completedAt ?? "",
    ];
  });
  return "\ufeff" + csv([header, ...rows]); // BOM so spreadsheet programs read non-ASCII text
}

const icsText = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const icsUtc = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

// shortcut: one VEVENT per occurrence (no RRULE, no line folding); fine for re-import, upgrade if the demo must match the app's file byte for byte
function calendarIcs(semesterId: string | null): Response {
  const s = getStore();
  const sessions = allSessions().filter((x) => !semesterId || x.semesterId === semesterId);
  if (!sessions.length) return problem(409, "nothing_to_export", "There is nothing to export.");
  const stamp = icsUtc(new Date().toISOString());
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:-//${APP}//Demo//EN`, "CALSCALE:GREGORIAN"];
  for (const x of sessions) {
    lines.push("BEGIN:VEVENT", `UID:${x.key}@unihelperpromax`, `DTSTAMP:${stamp}`, `DTSTART:${icsUtc(x.start)}`, `DTEND:${icsUtc(x.end)}`);
    lines.push(`SUMMARY:${icsText(x.title ?? x.courseName ?? "Event")}`);
    if (x.location) lines.push(`LOCATION:${icsText(x.location)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  const lineages = new Map(sessions.map((x) => [x.lineageId, x.kind]));
  const count = (k: string) => [...lineages.values()].filter((v) => v === k).length;
  const sem = semesterId ? s.semesters.find((x) => x.id === semesterId) : undefined;
  const year = sem && s.years.find((y) => y.id === sem.yearId);
  const part = sem && year ? `${year.name} ${sem.name}`.replace(/\s+/g, "-").replace(/[^\w.-]/g, "") || "semester" : "calendar";
  return file(lines.join("\r\n") + "\r\n", "text/calendar", `${APP}-${part}-${todayIso()}.ics`, {
    "X-Export-Counts": `classes=${count("class")}; events=${count("event")}`,
  });
}

function timeCsv(p: URLSearchParams): Response {
  const range = rangeOf(p);
  if (range instanceof Response) return range;
  const tz = p.get("tz") ?? "";
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
  } catch {
    return validation("tz", "Unknown time zone.", "unknown_tz");
  }
  if (!tz) return validation("tz", "Unknown time zone.", "unknown_tz");
  const local = (iso: string) => new TZDate(Date.parse(iso), tz).toISOString(); // 2026-11-04T12:00:00.000+03:00
  const two = (n: number) => String(n).padStart(2, "0");
  const rows = entriesIn(range[0], range[1]).map((e) => {
    const s = local(e.startedAt);
    const d = e.durationSeconds;
    return [s.slice(0, 10), s.slice(11, 19), local(e.endedAt).slice(11, 19), `${Math.floor(d / 3600)}:${two(Math.floor(d / 60) % 60)}:${two(d % 60)}`, e.description, tagName(e.tagId), e.linkTitle ?? ""];
  });
  return new Response(csv([["date", "start", "end", "duration", "description", "tag", "link"], ...rows]), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="time-entries.csv"', "Cache-Control": "no-store" },
  });
}

export const handlers: HttpHandler[] = [
  http.get(`${API}/tasks/export`, () => file(tasksCsv(), "text/csv", `${APP}-tasks-${todayIso()}.csv`)),
  http.get(`${API}/calendar-export`, ({ request }) => {
    const semesterId = new URL(request.url).searchParams.get("semesterId");
    if (semesterId && !getStore().semesters.some((x) => x.id === semesterId)) return notFound("Semester");
    return calendarIcs(semesterId);
  }),
  http.get(`${API}/time/entries/export.csv`, ({ request }) => timeCsv(new URL(request.url).searchParams)),
];
