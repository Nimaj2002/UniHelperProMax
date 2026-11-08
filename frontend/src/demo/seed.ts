/**
 * 024: the sample workspace (spec FR-004/FR-005). Dates are computed from the moment the demo
 * opens, so the semester always surrounds "today" (research R10). Feature groups seed their own
 * data through their slice (store.ts) using the stable ids and helpers exported here.
 */
import { todayIso, addDays, mondayOf, seriesSessions, seriesByLineage } from "./calendar";
import type { DemoStore, Series } from "./store";

/** Stable ids the slices use to attach sample data. */
export const IDS = {
  user: "demo-user",
  year: "year-1",
  semester: "sem-1",
  algo: "course-algo",
  linalg: "course-linalg",
  writing: "course-writing",
  algoLineage: "lin-algo",
  linalgLineage: "lin-linalg",
  writingLineage: "lin-writing",
  careerLineage: "lin-career",
  reviewLineage: "lin-review",
} as const;

export function createSeed(now: Date, timeZone: string): DemoStore {
  const today = todayIso({ now, timeZone });
  const [y, m] = today.split("-").map(Number);
  // academic year starts in September; spring semester covers Feb–Jun
  const fall = m >= 8 || m === 1;
  const startYear = m >= 8 ? y : y - 1;
  const semStart = addDays(mondayOf(today), -6 * 7);
  const semEnd = addDays(semStart, 14 * 7 - 3); // 14 weeks, ending on a Friday

  const series = (s: Omit<Series, "id" | "version" | "semesterId" | "links"> & { links?: Series["links"] }): Series => ({
    id: s.lineageId, // like the backend: an unsplit lineage's series id is the lineage id
    version: 1,
    semesterId: IDS.semester,
    links: [],
    ...s,
  });
  const weekly = (byWeekday: Series["recurrence"]["byWeekday"]): Series["recurrence"] => ({
    freq: "weekly",
    intervalWeeks: 1,
    byWeekday,
    end: { kind: "semester_end" },
  });

  return {
    now,
    timeZone,
    me: { id: IDS.user, username: "demo-student", role: "member", mustChangePassword: false, timezone: timeZone },
    // the mascot's light theme (a built-in preset) is the demo's first look
    preferences: { tour: { status: "not_seen", chapter: null }, theme: "preset:yuii" },
    years: [{ id: IDS.year, name: `${startYear}-${startYear + 1}`, folderName: `${startYear}-${startYear + 1}`, position: 0, version: 1 }],
    semesters: [
      {
        id: IDS.semester,
        yearId: IDS.year,
        name: fall ? "Fall" : "Spring",
        folderName: fall ? "Fall" : "Spring",
        startDate: semStart,
        endDate: semEnd,
        version: 1,
      },
    ],
    courses: [
      { id: IDS.algo, semesterId: IDS.semester, name: "Algorithms", folderName: "Algorithms", defaultColor: "blue", version: 1, reservedNameConflict: false },
      { id: IDS.linalg, semesterId: IDS.semester, name: "Linear Algebra", folderName: "Linear Algebra", defaultColor: "violet", version: 1, reservedNameConflict: false },
      { id: IDS.writing, semesterId: IDS.semester, name: "Academic Writing", folderName: "Academic Writing", defaultColor: "amber", version: 1, reservedNameConflict: false },
    ],
    series: [
      series({ kind: "class", lineageId: IDS.algoLineage, courseId: IDS.algo, title: null, location: "FENS L045", color: "blue", startDate: semStart, startTime: "09:40", endTime: "11:30", recurrence: weekly(["MO", "WE"]) }),
      series({ kind: "class", lineageId: IDS.linalgLineage, courseId: IDS.linalg, title: null, location: "FASS G022", color: "violet", startDate: semStart, startTime: "13:40", endTime: "15:30", recurrence: weekly(["TU", "TH"]) }),
      series({ kind: "class", lineageId: IDS.writingLineage, courseId: IDS.writing, title: null, location: "SL 1021", color: "amber", startDate: semStart, startTime: "10:40", endTime: "12:30", recurrence: weekly(["FR"]) }),
      series({ kind: "event", lineageId: IDS.careerLineage, courseId: null, title: "Career Fair", location: "University Center", color: "teal", startDate: addDays(today, 3), startTime: "14:00", endTime: "17:00", recurrence: { freq: "none", intervalWeeks: 1 } }),
      series({ kind: "event", lineageId: IDS.reviewLineage, courseId: null, title: "Algorithms study group", location: "Library, room 2", color: "pink", startDate: addDays(today, -2), startTime: "18:00", endTime: "19:30", recurrence: { freq: "none", intervalWeeks: 1 } }),
    ],
    overrides: {},
    trash: [],
    nextId: 1000,
  };
}

/** Keys of a lineage's past sessions, most recent first (for attaching sample notes etc.). */
export function pastKeys(lineageId: string): string[] {
  const s = seriesByLineage(lineageId);
  if (!s) return [];
  return seriesSessions(s)
    .filter((x) => x.status === "past")
    .map((x) => x.key)
    .reverse();
}

/** Keys of a lineage's upcoming sessions, soonest first. */
export function upcomingKeys(lineageId: string): string[] {
  const s = seriesByLineage(lineageId);
  return s ? seriesSessions(s).filter((x) => x.status === "upcoming").map((x) => x.key) : [];
}
