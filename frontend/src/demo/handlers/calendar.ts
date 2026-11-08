/** 024: years, semesters, courses, classes, events and sessions (contracts/demo-mode.md §2). */
import { http, type HttpHandler } from "msw";
import type { Schemas } from "@/lib/api";
import {
  addDays,
  allSessions,
  getSession,
  keysOf,
  parseKey,
  seriesByLineage,
  seriesDates,
  seriesSessions,
  sessionOut,
  weekdayOf,
} from "../calendar";
import { API, checkIfMatch, json, noContent, notFound, problem, readJson, validation, type Body, type Res } from "../http";
import { bump, getSlices, getStore, newId, nowIso, type Series } from "../store";

type Impact = Schemas["DeletionImpact"];

// ---------- helpers ----------

function folderName(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, "-").trim() || "Untitled";
}

function courseDetail(c: Schemas["Course"]): Schemas["CourseDetail"] {
  const s = getStore();
  const semester = s.semesters.find((x) => x.id === c.semesterId)!;
  const year = s.years.find((y) => y.id === semester.yearId)!;
  return { ...c, year, semester };
}

function sliceCounts(keys: Set<string>, lineages: Set<string>) {
  const out: Record<string, number> = {};
  for (const slice of getSlices()) {
    for (const [k, v] of Object.entries(slice.count?.(keys, lineages) ?? {})) out[k] = (out[k] ?? 0) + (v ?? 0);
  }
  return out;
}

/** Remove series (and everything attached to their sessions) for good. */
function dropLineages(lineages: Set<string>) {
  const s = getStore();
  const keys = keysOf(lineages);
  for (const slice of getSlices()) slice.removeSessions?.(keys, lineages);
  s.series = s.series.filter((x) => !lineages.has(x.lineageId));
  for (const k of Object.keys(s.overrides)) if (keys.has(k)) delete s.overrides[k];
}

function lineagesWhere(pred: (x: Series) => boolean) {
  return new Set(getStore().series.filter(pred).map((x) => x.lineageId));
}

function impact(lineages: Set<string>, extra: Partial<Impact>, keptFolder: string): Impact {
  const s = getStore();
  const keys = keysOf(lineages);
  const list = s.series.filter((x) => lineages.has(x.lineageId));
  const c = sliceCounts(keys, lineages);
  return {
    semesters: 0,
    courses: 0,
    ...extra,
    classes: list.filter((x) => x.kind === "class").length,
    events: list.filter((x) => x.kind === "event").length,
    notes: c.notes ?? 0,
    recordings: c.recordings ?? 0,
    documents: c.documents ?? 0,
    chats: c.chats ?? 0,
    keptFolder,
    linkedTaskCount: c.linkedTaskCount ?? 0,
    taskCount: c.taskCount ?? 0,
  };
}

/** Move a whole series to the trash, keeping a snapshot so Restore brings everything back. */
function trashSeries(series: Series): string {
  const s = getStore();
  const lineages = new Set([series.lineageId]);
  const keys = keysOf(lineages);
  const sessions = seriesSessions(series);
  const counts = sliceCounts(keys, lineages);
  const restores = getSlices().map((sl) => sl.snapshot?.(lineages)).filter((f): f is () => void => !!f);
  const overrides = Object.fromEntries(Object.entries(s.overrides).filter(([k]) => keys.has(k)));
  const semester = s.semesters.find((x) => x.id === series.semesterId);
  const year = s.years.find((y) => y.id === semester?.yearId);
  const course = s.courses.find((c) => c.id === series.courseId);
  const id = newId("trash");
  dropLineages(lineages);
  s.trash.push({
    out: {
      id,
      kind: series.kind,
      label: series.title ?? course?.name ?? "Class",
      yearName: year?.name ?? "",
      semesterName: semester?.name ?? "",
      courseName: course?.name ?? null,
      firstDate: sessions[0]?.date ?? series.startDate,
      lastDate: sessions.at(-1)?.date ?? series.startDate,
      startTime: series.startTime,
      endTime: series.endTime,
      occurrenceCount: sessions.length,
      noteCount: counts.notes ?? 0,
      recordingCount: counts.recordings ?? 0,
      documentCount: counts.documents ?? 0,
      deletedAt: nowIso(),
      purgeError: null,
      missingFiles: 0,
      version: 1,
      taskCount: counts.taskCount ?? 0,
      chatCount: counts.chats ?? 0,
    },
    restore: () => {
      s.series.push(series);
      Object.assign(s.overrides, overrides);
      for (const r of restores) r();
      return {
        kind: series.kind,
        lineageId: series.lineageId,
        firstSessionKey: sessions[0]?.key ?? `${series.lineageId}:${series.startDate}`,
        recreated: { year: false, semester: false, course: false },
        movedFolders: 0,
      };
    },
  });
  return id;
}

type RefYear = Schemas["RefId"] | Schemas["RefNewYear"];
type RefSemester = Schemas["RefId"] | Schemas["RefNewSemester"];
type RefCourse = Schemas["RefId"] | Schemas["RefNewCourse"];
interface Created {
  yearId?: string | null;
  semesterId?: string | null;
  courseId?: string | null;
}

function resolveYear(ref: RefYear, created: Created): string {
  if ("id" in ref) return ref.id;
  const s = getStore();
  const year: Schemas["Year"] = { id: newId("year"), name: ref.new.name, folderName: folderName(ref.new.name), position: s.years.length, version: 1 };
  s.years.push(year);
  created.yearId = year.id;
  return year.id;
}

function resolveSemester(ref: RefSemester, created: Created): string {
  if ("id" in ref) return ref.id;
  const n = ref.new;
  const sem: Schemas["Semester"] = {
    id: newId("sem"),
    yearId: resolveYear(n.year, created),
    name: n.name,
    folderName: folderName(n.name),
    startDate: n.startDate ?? null,
    endDate: n.endDate ?? null,
    version: 1,
  };
  getStore().semesters.push(sem);
  created.semesterId = sem.id;
  return sem.id;
}

function resolveCourse(ref: RefCourse, color: Schemas["Course"]["defaultColor"], created: Created): Schemas["Course"] | undefined {
  const s = getStore();
  if ("id" in ref) return s.courses.find((c) => c.id === ref.id);
  const course: Schemas["Course"] = {
    id: newId("course"),
    semesterId: resolveSemester(ref.new.semester, created),
    name: ref.new.name,
    folderName: folderName(ref.new.name),
    defaultColor: color,
    version: 1,
    reservedNameConflict: false,
  };
  s.courses.push(course);
  created.courseId = course.id;
  return course;
}

function checkTimes(start: string, end: string, field = "endTime") {
  return end <= start ? validation(field, "End time must be after the start time.", "end_before_start") : null;
}

function normaliseRecurrence(r: Schemas["Recurrence"] | undefined, startDate: string): Schemas["Recurrence"] {
  if (!r || r.freq === "none") return { freq: "none", intervalWeeks: 1 };
  return {
    freq: "weekly",
    intervalWeeks: r.intervalWeeks ?? 1,
    byWeekday: r.byWeekday?.length ? r.byWeekday : [weekdayOf(startDate)],
    end: r.end ?? { kind: "semester_end" },
  };
}

function seriesOut(x: Series): Schemas["ClassSeriesOut"] {
  return {
    id: x.id,
    lineageId: x.lineageId,
    courseId: x.courseId ?? "",
    title: x.title,
    location: x.location,
    color: x.color,
    startDate: x.startDate,
    startTime: x.startTime,
    endTime: x.endTime,
    links: x.links,
    recurrence: x.recurrence,
    version: x.version,
  };
}

const exceptionCount = (lineageId: string) =>
  Object.keys(getStore().overrides).filter((k) => parseKey(k)?.lineageId === lineageId).length;

function scopeResult(series: Series, extra: Partial<Schemas["ScopeResult"]> = {}): Schemas["ScopeResult"] {
  return { lineageId: series.lineageId, affectedSeriesIds: [series.id], preservedOverrides: 0, removedOverrides: 0, unchangedCount: 0, ...extra };
}

// ---------- handlers ----------

export const handlers: HttpHandler[] = [
  http.get(`${API}/course-tree`, ({ request }) => {
    const s = getStore();
    const q = new URL(request.url).searchParams.get("q")?.toLowerCase() ?? "";
    const tree: Res<"/api/v1/course-tree", "get"> = [...s.years]
      .sort((a, b) => a.position - b.position)
      .map((year) => ({
        year,
        semesters: s.semesters
          .filter((sem) => sem.yearId === year.id)
          .map((semester) => ({
            semester,
            courses: s.courses.filter((c) => c.semesterId === semester.id && c.name.toLowerCase().includes(q)),
            eventCount: s.series.filter((x) => x.kind === "event" && x.semesterId === semester.id).length,
          })),
      }));
    return json(tree);
  }),

  // years
  http.get(`${API}/years`, () => json([...getStore().years].sort((a, b) => a.position - b.position))),
  http.post(`${API}/years`, async ({ request }) => {
    const body = await readJson<Body<"/api/v1/years", "post">>(request);
    if (!body.name?.trim()) return validation("name", "Enter a name.");
    const s = getStore();
    const year: Schemas["Year"] = { id: newId("year"), name: body.name.trim(), folderName: folderName(body.name), position: s.years.length, version: 1 };
    s.years.push(year);
    return json(year, 201);
  }),
  http.put(`${API}/years/order`, async ({ request }) => {
    const body = await readJson<Body<"/api/v1/years/order", "put">>(request);
    const s = getStore();
    body.yearIds.forEach((id, i) => {
      const y = s.years.find((x) => x.id === id);
      if (y) y.position = i;
    });
    return json([...s.years].sort((a, b) => a.position - b.position));
  }),
  http.patch(`${API}/years/:id`, async ({ request, params }) => {
    const y = getStore().years.find((x) => x.id === params.id);
    if (!y) return notFound("Year");
    const conflict = checkIfMatch(request, y);
    if (conflict) return conflict;
    const body = await readJson<Body<"/api/v1/years/{year_id}", "patch">>(request);
    if (!body.name?.trim()) return validation("name", "Enter a name.");
    y.name = body.name.trim();
    return json(bump(y));
  }),
  http.get(`${API}/years/:id/deletion-impact`, ({ params }) => {
    const s = getStore();
    const sems = new Set(s.semesters.filter((x) => x.yearId === params.id).map((x) => x.id));
    const lineages = lineagesWhere((x) => sems.has(x.semesterId));
    return json(impact(lineages, { semesters: sems.size, courses: s.courses.filter((c) => sems.has(c.semesterId)).length }, "Trash"));
  }),
  http.delete(`${API}/years/:id`, ({ request, params }) => {
    const s = getStore();
    const y = s.years.find((x) => x.id === params.id);
    if (!y) return notFound("Year");
    const conflict = checkIfMatch(request, y);
    if (conflict) return conflict;
    const sems = new Set(s.semesters.filter((x) => x.yearId === y.id).map((x) => x.id));
    dropLineages(lineagesWhere((x) => sems.has(x.semesterId)));
    s.courses = s.courses.filter((c) => !sems.has(c.semesterId));
    s.semesters = s.semesters.filter((x) => !sems.has(x.id));
    s.years = s.years.filter((x) => x.id !== y.id);
    return noContent();
  }),

  // semesters
  http.get(`${API}/semesters`, ({ request }) => {
    const yearId = new URL(request.url).searchParams.get("yearId");
    return json(getStore().semesters.filter((x) => !yearId || x.yearId === yearId));
  }),
  http.post(`${API}/semesters`, async ({ request }) => {
    const body = await readJson<Body<"/api/v1/semesters", "post">>(request);
    if (!body.name?.trim()) return validation("name", "Enter a name.");
    if (body.startDate && body.endDate && body.endDate < body.startDate) return validation("endDate", "The end date must be after the start date.");
    const sem: Schemas["Semester"] = {
      id: newId("sem"),
      yearId: body.yearId,
      name: body.name.trim(),
      folderName: folderName(body.name),
      startDate: body.startDate ?? null,
      endDate: body.endDate ?? null,
      version: 1,
    };
    getStore().semesters.push(sem);
    return json(sem, 201);
  }),
  http.patch(`${API}/semesters/:id`, async ({ request, params }) => {
    const sem = getStore().semesters.find((x) => x.id === params.id);
    if (!sem) return notFound("Semester");
    const conflict = checkIfMatch(request, sem);
    if (conflict) return conflict;
    const body = await readJson<Body<"/api/v1/semesters/{semester_id}", "patch">>(request);
    if (body.name !== undefined && body.name !== null) {
      if (!body.name.trim()) return validation("name", "Enter a name.");
      sem.name = body.name.trim();
    }
    if (body.startDate !== undefined) sem.startDate = body.startDate;
    if (body.endDate !== undefined) sem.endDate = body.endDate;
    if (sem.startDate && sem.endDate && sem.endDate < sem.startDate) return validation("endDate", "The end date must be after the start date.");
    return json(bump(sem));
  }),
  http.get(`${API}/semesters/:id/deletion-impact`, ({ params }) => {
    const s = getStore();
    return json(impact(lineagesWhere((x) => x.semesterId === params.id), { courses: s.courses.filter((c) => c.semesterId === params.id).length }, "Trash"));
  }),
  http.delete(`${API}/semesters/:id`, ({ request, params }) => {
    const s = getStore();
    const sem = s.semesters.find((x) => x.id === params.id);
    if (!sem) return notFound("Semester");
    const conflict = checkIfMatch(request, sem);
    if (conflict) return conflict;
    dropLineages(lineagesWhere((x) => x.semesterId === sem.id));
    s.courses = s.courses.filter((c) => c.semesterId !== sem.id);
    s.semesters = s.semesters.filter((x) => x.id !== sem.id);
    return noContent();
  }),
  http.get(`${API}/semesters/:id/events/timeline`, ({ params }) => {
    const out: Res<"/api/v1/semesters/{semester_id}/events/timeline", "get"> = getStore()
      .series.filter((x) => x.kind === "event" && x.semesterId === params.id)
      .flatMap(seriesSessions)
      .map((x) => {
        const c = sliceCounts(new Set([x.key]), new Set());
        return {
          sessionKey: x.key,
          lineageId: x.lineageId,
          title: x.title ?? "Event",
          date: x.date,
          startTime: x.start.slice(11, 16),
          endTime: x.end.slice(11, 16),
          start: x.start,
          end: x.end,
          location: x.location,
          color: x.color,
          status: x.status,
          noteCount: c.notes ?? 0,
          audioCount: c.recordings ?? 0,
          documentCount: c.documents ?? 0,
        };
      })
      .sort((a, b) => a.start.localeCompare(b.start));
    return json(out);
  }),

  // courses
  http.get(`${API}/courses`, ({ request }) => {
    const p = new URL(request.url).searchParams;
    const sem = p.get("semesterId");
    const q = p.get("q")?.toLowerCase() ?? "";
    return json(getStore().courses.filter((c) => (!sem || c.semesterId === sem) && c.name.toLowerCase().includes(q)));
  }),
  http.post(`${API}/courses`, async ({ request }) => {
    const body = await readJson<Body<"/api/v1/courses", "post">>(request);
    const name = body.name?.trim();
    if (!name) return validation("name", "Enter a course name.");
    const s = getStore();
    const existing = s.courses.find((c) => c.semesterId === body.semesterId && c.name.toLowerCase() === name.toLowerCase());
    if (existing) return json(existing, 200);
    const course: Schemas["Course"] = { id: newId("course"), semesterId: body.semesterId, name, folderName: folderName(name), defaultColor: body.defaultColor ?? "blue", version: 1, reservedNameConflict: false };
    s.courses.push(course);
    return json(course, 201);
  }),
  http.get(`${API}/courses/:id`, ({ params }) => {
    const c = getStore().courses.find((x) => x.id === params.id);
    return c ? json(courseDetail(c)) : notFound("Course");
  }),
  http.patch(`${API}/courses/:id`, async ({ request, params }) => {
    const c = getStore().courses.find((x) => x.id === params.id);
    if (!c) return notFound("Course");
    const conflict = checkIfMatch(request, c);
    if (conflict) return conflict;
    const body = await readJson<Body<"/api/v1/courses/{course_id}", "patch">>(request);
    if (body.name !== undefined && body.name !== null) {
      if (!body.name.trim()) return validation("name", "Enter a course name.");
      c.name = body.name.trim();
      c.folderName = folderName(c.name);
    }
    if (body.defaultColor) c.defaultColor = body.defaultColor;
    return json(bump(c));
  }),
  http.get(`${API}/courses/:id/deletion-impact`, ({ params }) => json(impact(lineagesWhere((x) => x.courseId === params.id), {}, "Trash"))),
  http.delete(`${API}/courses/:id`, ({ request, params }) => {
    const s = getStore();
    const c = s.courses.find((x) => x.id === params.id);
    if (!c) return notFound("Course");
    const conflict = checkIfMatch(request, c);
    if (conflict) return conflict;
    dropLineages(lineagesWhere((x) => x.courseId === c.id));
    s.courses = s.courses.filter((x) => x.id !== c.id);
    return noContent();
  }),
  http.get(`${API}/courses/:id/timeline`, ({ params }) => {
    const entries = getStore()
      .series.filter((x) => x.courseId === params.id)
      .flatMap(seriesSessions)
      .sort((a, b) => a.start.localeCompare(b.start))
      .map((x) => {
        const c = sliceCounts(new Set([x.key]), new Set());
        return {
          key: x.key,
          lineageId: x.lineageId,
          courseId: x.courseId ?? "",
          date: x.date,
          start: x.start,
          end: x.end,
          title: x.title,
          location: x.location,
          color: x.color,
          status: x.status,
          scheduled: true,
          noteCount: c.notes ?? 0,
          audioCount: c.recordings ?? 0,
        };
      });
    return json<Res<"/api/v1/courses/{course_id}/timeline", "get">>({ courseId: String(params.id), entries });
  }),

  // classes & events
  http.post(`${API}/classes`, async ({ request }) => {
    const body = await readJson<Body<"/api/v1/classes", "post">>(request);
    const bad = checkTimes(body.startTime, body.endTime);
    if (bad) return bad;
    if ("new" in body.course && !body.course.new.name?.trim()) return validation("course/new/name", "Enter a course name.");
    const created: Created = {};
    const course = resolveCourse(body.course, body.color, created);
    if (!course) return validation("course", "Pick a course.");
    const lineageId = newId("lin");
    const series: Series = {
      kind: "class",
      id: lineageId,
      lineageId,
      courseId: course.id,
      semesterId: course.semesterId,
      title: body.title ?? null,
      location: body.location ?? null,
      color: body.color,
      startDate: body.startDate,
      startTime: body.startTime,
      endTime: body.endTime,
      links: body.links ?? [],
      recurrence: normaliseRecurrence(body.recurrence, body.startDate),
      version: 1,
    };
    getStore().series.push(series);
    const out: Res<"/api/v1/classes", "post"> = { ...seriesOut(series), created: { lineageId, ...created } };
    return json(out, 201);
  }),
  http.get(`${API}/classes/:lineageId`, ({ params }) => {
    const x = seriesByLineage(String(params.lineageId));
    const c = x && getStore().courses.find((cc) => cc.id === x.courseId);
    if (!x || !c) return notFound("Class");
    return json<Res<"/api/v1/classes/{lineage_id}", "get">>({ lineageId: x.lineageId, course: courseDetail(c), segments: [seriesOut(x)], exceptionCount: exceptionCount(x.lineageId) });
  }),
  http.post(`${API}/events`, async ({ request }) => {
    const body = await readJson<Body<"/api/v1/events", "post">>(request);
    if (!body.title?.trim()) return validation("title", "Enter a title.");
    const bad = checkTimes(body.startTime, body.endTime);
    if (bad) return bad;
    const created: Created = {};
    const semesterId = resolveSemester(body.semester, created);
    const lineageId = newId("lin");
    const series: Series = {
      kind: "event",
      id: lineageId,
      lineageId,
      courseId: null,
      semesterId,
      title: body.title.trim(),
      location: body.location ?? null,
      color: body.color ?? "teal",
      startDate: body.startDate,
      startTime: body.startTime,
      endTime: body.endTime,
      links: body.links ?? [],
      recurrence: normaliseRecurrence(body.recurrence, body.startDate),
      version: 1,
    };
    getStore().series.push(series);
    return json<Res<"/api/v1/events", "post">>({ lineageId, semesterId, version: 1, created: { lineageId, ...created } }, 201);
  }),
  http.get(`${API}/events/:lineageId`, ({ params }) => {
    const s = getStore();
    const x = seriesByLineage(String(params.lineageId));
    if (!x || x.kind !== "event") return notFound("Event");
    const sem = s.semesters.find((y) => y.id === x.semesterId);
    const year = s.years.find((y) => y.id === sem?.yearId);
    return json<Res<"/api/v1/events/{lineage_id}", "get">>({
      lineageId: x.lineageId,
      semesterId: x.semesterId,
      semesterName: sem?.name ?? "",
      yearName: year?.name ?? "",
      segments: [{ id: x.id, title: x.title ?? "", location: x.location, color: x.color, startDate: x.startDate, startTime: x.startTime, endTime: x.endTime, recurrence: x.recurrence, links: x.links, version: x.version }],
      exceptionCount: exceptionCount(x.lineageId),
      semesterLocked: false,
    });
  }),
  http.post(`${API}/creations/undo`, async ({ request }) => {
    const body = await readJson<Body<"/api/v1/creations/undo", "post">>(request);
    const s = getStore();
    const x = seriesByLineage(body.created.lineageId);
    if (!x) return notFound("Class or event");
    if (x.version !== body.version) return problem(412, "version_conflict", "This item was changed elsewhere. Reload and try again.");
    dropLineages(new Set([x.lineageId]));
    const { courseId, semesterId, yearId } = body.created;
    if (courseId) s.courses = s.courses.filter((c) => c.id !== courseId);
    if (semesterId) s.semesters = s.semesters.filter((c) => c.id !== semesterId);
    if (yearId) s.years = s.years.filter((c) => c.id !== yearId);
    return noContent();
  }),

  // sessions
  http.get(`${API}/sessions`, ({ request }) => {
    const p = new URL(request.url).searchParams;
    const from = p.get("from") ?? "0000-01-01";
    const to = p.get("to") ?? "9999-12-31";
    const courseId = p.get("courseId");
    return json(allSessions().filter((x) => x.date >= from && x.date <= to && (!courseId || x.courseId === courseId)));
  }),
  http.get(`${API}/sessions/:key`, ({ params }) => {
    const x = getSession(String(params.key));
    return x ? json(x) : notFound("Session");
  }),
  http.get(`${API}/sessions/:key/deletion-impact`, ({ request, params }) => {
    const key = String(params.key);
    const x = getSession(key);
    if (!x) return notFound("Session");
    const scope = new URL(request.url).searchParams.get("scope") ?? "this";
    const series = seriesByLineage(x.lineageId)!;
    const keys = scope === "this" ? new Set([key]) : new Set(seriesDates(series).filter((d) => scope === "all" || d >= x.date).map((d) => `${x.lineageId}:${d}`));
    const c = sliceCounts(keys, scope === "all" ? new Set([x.lineageId]) : new Set());
    return json<Res<"/api/v1/sessions/{session_key}/deletion-impact", "get">>({
      kind: series.kind,
      occurrences: keys.size,
      notes: c.notes ?? 0,
      recordings: c.recordings ?? 0,
      documents: c.documents ?? 0,
      linkedTaskCount: c.linkedTaskCount ?? 0,
      chats: c.chats ?? 0,
      chatTitles: [],
      teacherChats: c.teacherChats ?? 0,
      graphIdeas: c.graphIdeas ?? 0,
    });
  }),
  http.patch(`${API}/sessions/:key`, async ({ request, params }) => {
    const key = String(params.key);
    const k = parseKey(key);
    const series = k && seriesByLineage(k.lineageId);
    if (!k || !series || !seriesDates(series).includes(k.date)) return notFound("Session");
    const scope = new URL(request.url).searchParams.get("scope") ?? "this";
    const body = await readJson<Body<"/api/v1/sessions/{session_key}", "patch">>(request);
    const s = getStore();
    const current = sessionOut(series, k.date);
    const startTime = body.startTime ?? current?.start.slice(11, 16) ?? series.startTime;
    const endTime = body.endTime ?? current?.end.slice(11, 16) ?? series.endTime;
    const bad = checkTimes(startTime, endTime);
    if (bad) return bad;
    if ("title" in body && series.kind === "event" && body.title !== undefined && !body.title?.trim()) return validation("title", "Enter a title.");
    if (scope === "this") {
      const o = s.overrides[key] ?? { version: 0 };
      if (body.date) o.date = body.date;
      if (body.startTime) o.startTime = body.startTime;
      if (body.endTime) o.endTime = body.endTime;
      if (body.title !== undefined) o.title = body.title;
      if (body.location !== undefined) o.location = body.location;
      if (body.color) o.color = body.color;
      s.overrides[key] = bump(o);
      return json(scopeResult(series));
    }
    const conflict = checkIfMatch(request, series);
    if (conflict) return conflict;
    if (scope === "following" && k.date > series.startDate) {
      // simplified split: the edit applies to the whole series from the chosen date on
      series.startDate = k.date;
    }
    if (body.startTime) series.startTime = body.startTime;
    if (body.endTime) series.endTime = body.endTime;
    if (body.title !== undefined) series.title = body.title;
    if (body.location !== undefined) series.location = body.location;
    if (body.color) series.color = body.color;
    if (body.links) series.links = body.links;
    if (body.recurrence) series.recurrence = normaliseRecurrence(body.recurrence, series.startDate);
    if ("semesterId" in body && body.semesterId) series.semesterId = body.semesterId;
    bump(series);
    return json(scopeResult(series));
  }),
  http.delete(`${API}/sessions/:key`, ({ request, params }) => {
    const key = String(params.key);
    const k = parseKey(key);
    const series = k && seriesByLineage(k.lineageId);
    if (!k || !series || !seriesDates(series).includes(k.date)) return notFound("Session");
    const scope = new URL(request.url).searchParams.get("scope") ?? "this";
    const s = getStore();
    const dates = seriesDates(series);
    if (scope === "all" || (scope === "following" && k.date <= dates[0]) || dates.length === 1) {
      const trashEntryId = trashSeries(series);
      return json(scopeResult(series, { trashEntryId }));
    }
    const doomed = new Set(scope === "this" ? [key] : dates.filter((d) => d >= k.date).map((d) => `${k.lineageId}:${d}`));
    for (const slice of getSlices()) slice.removeSessions?.(doomed, new Set());
    if (scope === "this") s.overrides[key] = { deleted: true, version: 1 };
    else {
      const end = addDays(k.date, -1);
      series.recurrence = { ...series.recurrence, end: { kind: "until", untilDate: end } };
      bump(series);
    }
    return json(scopeResult(series));
  }),

  // trash
  http.get(`${API}/trash`, ({ request }) => {
    const kind = new URL(request.url).searchParams.get("kind");
    return json(getStore().trash.map((t) => t.out).filter((t) => !kind || t.kind === kind));
  }),
  http.post(`${API}/trash/:id/restore`, ({ params }) => {
    const s = getStore();
    const entry = s.trash.find((t) => t.out.id === params.id);
    if (!entry) return notFound("Trash entry");
    s.trash = s.trash.filter((t) => t !== entry);
    return json(entry.restore());
  }),
  http.delete(`${API}/trash/:id`, ({ params }) => {
    const s = getStore();
    if (!s.trash.some((t) => t.out.id === params.id)) return notFound("Trash entry");
    s.trash = s.trash.filter((t) => t.out.id !== params.id);
    return noContent();
  }),
];
