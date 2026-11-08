/**
 * 024: time tracking — the timer state machine, entries and tags (contracts/demo-mode.md §2),
 * mirroring services/time_service.py. The timer runs on the real clock; seeded entries are
 * placed in the week before the demo opened.
 */
import { http, type HttpHandler } from "msw";
import type { Schemas } from "@/lib/api";
import { addDays, allSessions, getSession, todayIso, zoned } from "../calendar";
import { API, checkIfMatch, json, noContent, notFound, problem, readJson, validation, type Body } from "../http";
import { IDS } from "../seed";
import { bump, getStore, newId, registerSlice } from "../store";
import { findLiveTask } from "./tasks";

type Timer = Schemas["TimerOut"];
type EntryOut = Schemas["EntryOut"];
type Entry = Omit<EntryOut, "durationSeconds"> & { deletedAt: string | null };
type Tag = Omit<Schemas["TagOut"], "entryCount">;
type Links = Pick<Timer, "courseId" | "taskId" | "sessionKey" | "linkTitle">;

const MIN_SAVE_MS = 5_000;
const SETTLE_GRACE_MS = 60_000;
const BACKDATE_MS = 86_400_000;
const EXTEND_MIN = 5;
const MAX_FOCUS_MIN = 480;
const COLOR_KEYS = ["slate", "red", "orange", "amber", "lime", "green", "teal", "cyan", "blue", "indigo", "violet", "pink"];

let timer: Timer | null = null;
let entries: Entry[] = [];
let tags: Tag[] = [];

const ms = (iso: string) => Date.parse(iso);
const iso = (t: number) => new Date(t).toISOString();

export function entryOut({ deletedAt: _d, ...e }: Entry): EntryOut {
  return { ...e, durationSeconds: Math.max(0, Math.floor((ms(e.endedAt) - ms(e.startedAt)) / 1000) - e.pausedSeconds) };
}

/** Live entries overlapping [from, to), oldest first (also used by the CSV export). */
export function entriesIn(from: number, to: number, sessionKey?: string | null): EntryOut[] {
  return entries
    .filter((e) => !e.deletedAt && ms(e.startedAt) < to && ms(e.endedAt) > from && (!sessionKey || e.sessionKey === sessionKey))
    .sort((a, b) => ms(a.startedAt) - ms(b.startedAt))
    .map(entryOut);
}

export const tagName = (id: string | null) => tags.find((t) => t.id === id)?.name ?? "";

function prefs() {
  const p = getStore().preferences.time ?? {};
  return {
    work: p.pomodoroWorkMin ?? 25,
    short: p.pomodoroShortMin ?? 5,
    long: p.pomodoroLongMin ?? 15,
    periods: p.pomodoroPeriods ?? 4,
    autoStart: p.pomodoroAutoStart ?? false,
  };
}

// ---------- links and tags ----------

/** courseId / taskId / sessionKey → validated links plus linkTitle, or a 404 (resolve_links). */
function resolveLinks(l: { courseId?: string | null; taskId?: string | null; sessionKey?: string | null }): Links | Response {
  let courseId = l.courseId ?? null;
  let title: string | null = null;
  if (l.taskId) {
    const t = findLiveTask(l.taskId);
    if (!t) return notFound("Task");
    courseId = t.courseId ?? courseId;
    title = t.title;
  }
  if (l.sessionKey) {
    const s = getSession(l.sessionKey);
    if (!s) return notFound("Session");
    courseId = s.courseId ?? courseId;
    title ??= s.title ?? (s.courseName ? `${s.courseName} ${s.date}` : null);
  }
  if (courseId && !getStore().courses.some((c) => c.id === courseId)) return notFound("Course");
  return { courseId, taskId: l.taskId ?? null, sessionKey: l.sessionKey ?? null, linkTitle: title?.slice(0, 200) ?? null };
}

const tagMissing = (id: string | null | undefined) => !!id && !tags.some((t) => t.id === id);

/** Every course of a semester running today gets a tag of its name and colour. */
function ensureCourseTags() {
  const s = getStore();
  const today = todayIso();
  for (const c of s.courses) {
    const sem = s.semesters.find((x) => x.id === c.semesterId);
    if (!sem?.startDate || sem.startDate > today || (sem.endDate && sem.endDate < today)) continue;
    const name = c.name.trim().slice(0, 30).trim();
    if (!name || tags.some((t) => t.name.toLowerCase() === name.toLowerCase())) continue;
    tags.push({ id: newId("tag"), name, color: `tag-${COLOR_KEYS.indexOf(c.defaultColor) + 1 || 1}`, version: 1 });
  }
}

function tagOut(t: Tag): Schemas["TagOut"] {
  return { ...t, entryCount: entries.filter((e) => !e.deletedAt && e.tagId === t.id).length };
}

function tagNameError(raw: unknown, exceptId?: string): Response | string {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!name) return validation("name", "Give the tag a name.", "name_required");
  if (name.length > 30) return validation("name", "A tag name is at most 30 characters.", "name_too_long");
  if (tags.some((t) => t.id !== exceptId && t.name.toLowerCase() === name.toLowerCase()))
    return problem(409, "tag_name_taken", "A tag with this name already exists.");
  return name;
}

// ---------- the timer state machine ----------

interface Extra {
  settled?: Schemas["Settled"][];
  undo?: Schemas["Undo"] | null;
  saved?: Entry | null;
}

function response(t: Timer | null, extra: Extra = {}): Schemas["TimerResponse"] {
  return { timer: t, serverNow: iso(Date.now()), settled: extra.settled ?? [], undo: extra.undo ?? null, saved: extra.saved ? entryOut(extra.saved) : null };
}

function snapshot({ version: _v, linkTitle: _l, ...rest }: Timer): Schemas["TimerSnapshot"] {
  return rest;
}

/** Save the timer's current stretch ending at `end`; null under 5 s of counted time. */
function saveEntry(t: Timer, end: number): Entry | null {
  if (end - ms(t.startedAt) - t.pausedMs < MIN_SAVE_MS) return null;
  const e: Entry = {
    id: newId("entry"),
    startedAt: t.startedAt,
    endedAt: iso(end),
    pausedSeconds: Math.floor(t.pausedMs / 1000),
    source: t.style,
    description: t.style === "focus" && !t.description ? (t.goal ?? "") : t.description,
    tagId: t.tagId,
    courseId: t.courseId,
    taskId: t.taskId,
    sessionKey: t.sessionKey,
    linkTitle: t.linkTitle,
    version: 1,
    deletedAt: null,
  };
  entries.push(e);
  return e;
}

/** Where a stretch ends when stopped at `at`: at the pause, never after a planned end or before the start. */
function stretchEnd(t: Timer, at: number): number {
  let end = t.pausedAt ? ms(t.pausedAt) : at;
  if (t.plannedEndAt) end = Math.min(end, ms(t.plannedEndAt));
  return Math.max(end, ms(t.startedAt));
}

type Phase = NonNullable<Timer["phase"]>;

function nextPhase(phase: Phase, period: number): [Phase, number] {
  if (phase === "work") return [period >= prefs().periods ? "long_break" : "short_break", period];
  return ["work", phase === "long_break" ? 1 : period + 1];
}

function beginPhase(t: Timer, phase: Phase, period: number, at: number, run: boolean) {
  const p = prefs();
  const minutes = phase === "work" ? p.work : phase === "short_break" ? p.short : p.long;
  Object.assign(t, { phase, period, startedAt: iso(at), pausedAt: null, pausedMs: 0, plannedEndAt: iso(at + minutes * 60_000), finishedAt: null, state: run ? "running" : "waiting" });
}

/** A Pomodoro phase or Focus session reached its planned end. */
function finishPhase(t: Timer, end: number, auto: boolean): [Entry | null, Timer | null] {
  const saved = t.phase === null || t.phase === "work" ? saveEntry(t, end) : null;
  if (t.style === "focus") return [saved, (timer = null)];
  const [phase, period] = nextPhase(t.phase!, t.period!);
  beginPhase(t, phase, period, end, auto);
  if (!auto) t.finishedAt = iso(end);
  bump(t);
  return [saved, t];
}

/** Settle a phase that ended while nobody was watching; never auto-starts. */
function settle(): Schemas["Settled"][] {
  const t = timer;
  if (!t || t.state !== "running" || !t.plannedEndAt) return [];
  const end = ms(t.plannedEndAt);
  if (Date.now() < end + SETTLE_GRACE_MS) return [];
  const phase = t.phase;
  const [saved] = finishPhase(t, end, false);
  return [{ phase, finishedAt: iso(end), entryId: saved?.id ?? null }];
}

const clamp = (at: string | null | undefined, low: number, high: number) => (at ? Math.min(Math.max(ms(at), low), high) : high);

/** The running timer checked against If-Match, or the problem to answer. */
function requireTimer(request: Request): Timer | Response {
  if (!timer) return problem(409, "no_timer", "No timer is running.");
  return checkIfMatch(request, timer) ?? timer;
}

function stop(t: Timer, at: string | null | undefined, settled: Schemas["Settled"][] = []) {
  let undo: Schemas["Undo"] | null = null;
  let saved: Entry | null = null;
  if (t.state !== "waiting" && (t.phase === null || t.phase === "work")) {
    saved = saveEntry(t, stretchEnd(t, clamp(at, ms(t.startedAt), Date.now())));
    if (!saved) undo = { previous: snapshot(t), entryId: null };
  }
  timer = null;
  return json(response(null, { settled, undo, saved }));
}

/** POST /time/timer/<name>: settle, check the timer and its version, then run `fn`. */
function action(name: string, fn: (t: Timer, request: Request, settled: Schemas["Settled"][]) => Response | Promise<Response>, settleFirst = false) {
  return http.post(`${API}/time/timer/${name}`, async ({ request }) => {
    const settled = settleFirst ? settle() : [];
    if (settleFirst && !timer && settled.length) return json(response(null, { settled }));
    const t = requireTimer(request);
    return t instanceof Response ? t : fn(t, request, settled);
  });
}

const atOf = async (request: Request) => (await readJson<{ at?: string | null } | null>(request))?.at;

// ---------- seed ----------

function seed() {
  timer = null;
  entries = [];
  tags = [];
  ensureCourseTags();
  const s = getStore();
  const today = todayIso();
  const weekAgo = addDays(today, -7);
  const tagOf = (courseId: string | null) => tags.find((t) => t.name === s.courses.find((c) => c.id === courseId)?.name)?.id ?? null;
  const add = (start: string, minutes: number, description: string, source: Entry["source"], links: Partial<Links> = {}, pausedSeconds = 0) => {
    const courseId = links.courseId ?? null;
    entries.push({
      id: newId("entry"),
      startedAt: iso(ms(start)),
      endedAt: iso(ms(start) + minutes * 60_000),
      pausedSeconds,
      source,
      description,
      tagId: tagOf(courseId),
      courseId,
      taskId: null,
      sessionKey: links.sessionKey ?? null,
      linkTitle: links.linkTitle ?? null,
      version: 1,
      deletedAt: null,
    });
  };
  // a review after each class of the past week, linked to its session
  for (const x of allSessions()) {
    if (x.kind !== "class" || x.status !== "past" || x.date < weekAgo || x.date >= today) continue;
    add(iso(ms(x.end) + 30 * 60_000), 45, "Review lecture notes", "pomodoro", { courseId: x.courseId, sessionKey: x.key, linkTitle: `${x.courseName} ${x.date}` });
  }
  const evening: [string, number, string, string][] = [
    ["19:00", 90, "Problem set 4", IDS.algo],
    ["20:00", 60, "Chapter 5 exercises", IDS.linalg],
    ["18:30", 75, "Essay research", IDS.writing],
  ];
  for (let i = 1; i <= 7; i++) {
    const [time, minutes, description, courseId] = evening[i % evening.length];
    add(zoned(addDays(today, -i), time), minutes, description, i % 2 ? "track" : "focus", { courseId }, i % 3 ? 0 : 300);
  }
}

registerSlice({
  name: "time",
  seed,
  removeSessions: (keys) => {
    for (const e of entries) if (e.sessionKey && keys.has(e.sessionKey)) e.sessionKey = null; // keeps its link title
    if (timer?.sessionKey && keys.has(timer.sessionKey)) timer.sessionKey = null;
  },
});

// ---------- handlers ----------

export const handlers: HttpHandler[] = [
  http.get(`${API}/time/timer`, () => {
    const settled = settle();
    return json(response(timer, { settled }));
  }),
  http.patch(`${API}/time/timer`, async ({ request }) => {
    const t = requireTimer(request);
    if (t instanceof Response) return t;
    const body = await readJson<Body<"/api/v1/time/timer", "patch">>(request);
    if ("tagId" in body && tagMissing(body.tagId)) return notFound("Tag");
    if ("courseId" in body || "taskId" in body || "sessionKey" in body) {
      const links = resolveLinks({ courseId: t.courseId, taskId: t.taskId, sessionKey: t.sessionKey, ...body });
      if (links instanceof Response) return links;
      Object.assign(t, links);
    }
    if ("description" in body) t.description = (body.description ?? "").trim();
    if ("tagId" in body) t.tagId = body.tagId ?? null;
    if (body.reminderAck != null) t.reminderAck = body.reminderAck;
    bump(t);
    return json(response(t));
  }),
  http.post(`${API}/time/timer/start`, async ({ request }) => {
    const body = await readJson<Body<"/api/v1/time/timer/start", "post">>(request);
    const settled = settle();
    const now = Date.now();
    const at = clamp(body.at, now - BACKDATE_MS, now);
    if (tagMissing(body.tagId)) return notFound("Tag");
    const links = resolveLinks(body);
    if (links instanceof Response) return links;
    if (body.style === "focus" && body.focusMinutes == null) return validation("focusMinutes", "Choose a length.", "required");
    let undo: Schemas["Undo"] | null = null;
    if (timer) {
      const prev = snapshot(timer);
      const saved = saveEntry(timer, stretchEnd(timer, Math.max(at, ms(timer.startedAt))));
      undo = { previous: prev, entryId: saved?.id ?? null };
    }
    const t: Timer = {
      style: body.style,
      state: "running",
      startedAt: iso(at),
      pausedAt: null,
      pausedMs: 0,
      plannedEndAt: null,
      finishedAt: null,
      description: (body.description ?? "").trim(),
      tagId: body.tagId ?? null,
      ...links,
      phase: null,
      period: null,
      focusMinutes: null,
      goal: null,
      hidePanels: !!body.hidePanels,
      reminderAck: 0,
      version: 1,
    };
    if (body.style === "pomodoro") beginPhase(t, "work", 1, at, true);
    else if (body.style === "focus") Object.assign(t, { focusMinutes: body.focusMinutes, goal: body.goal?.trim() || null, plannedEndAt: iso(at + body.focusMinutes! * 60_000) });
    timer = t;
    return json(response(t, { settled, undo }), 201);
  }),
  action("stop", async (t, request, settled) => stop(t, await atOf(request), settled), true),
  action("set-end", async (t, request) => {
    const { endedAt } = await readJson<Body<"/api/v1/time/timer/set-end", "post">>(request);
    if (!endedAt || ms(endedAt) <= ms(t.startedAt)) return validation("endedAt", "The end must be after the start.", "end_not_after_start");
    if (ms(endedAt) > Date.now()) return validation("endedAt", "The end can't be in the future.", "end_in_future");
    const saved = t.phase === null || t.phase === "work" ? saveEntry(t, ms(endedAt)) : null;
    timer = null;
    return json(response(null, { saved }));
  }),
  action(
    "pause",
    async (t, request, settled) => {
      const at = await atOf(request);
      if (t.style === "track") return stop(t, at, settled); // a Track pause ends the entry
      if (t.state !== "running") return problem(409, "not_running", "The timer isn't running.");
      t.pausedAt = iso(stretchEnd(t, clamp(at, ms(t.startedAt), Date.now())));
      t.state = "paused";
      bump(t);
      return json(response(t, { settled }));
    },
    true,
  ),
  action("resume", (t) => {
    if (t.state !== "paused" || !t.pausedAt) return problem(409, "not_paused", "The timer isn't paused.");
    const pause = Math.max(0, Date.now() - ms(t.pausedAt));
    t.pausedMs += pause;
    if (t.plannedEndAt) t.plannedEndAt = iso(ms(t.plannedEndAt) + pause);
    Object.assign(t, { pausedAt: null, state: "running" });
    bump(t);
    return json(response(t));
  }),
  action("advance", (t) => {
    if (t.state === "waiting") {
      beginPhase(t, t.phase!, t.period!, Date.now(), true);
      bump(t);
      return json(response(t));
    }
    if (t.state !== "running" || !t.plannedEndAt || Date.now() < ms(t.plannedEndAt)) return problem(409, "not_due", "This phase hasn't ended yet.");
    const [saved, next] = finishPhase(t, ms(t.plannedEndAt), prefs().autoStart);
    return json(response(next, { saved }));
  }),
  action("skip", (t) => {
    if (t.style !== "pomodoro") return problem(409, "not_pomodoro", "Only a Pomodoro has phases to skip.");
    const now = Date.now();
    const saved = t.phase === "work" && t.state !== "waiting" ? saveEntry(t, stretchEnd(t, now)) : null;
    const [phase, period] = nextPhase(t.phase!, t.period!);
    beginPhase(t, phase, period, now, true);
    bump(t);
    return json(response(t, { saved }));
  }),
  action("reset", (t) => {
    if (t.style !== "pomodoro") return problem(409, "not_pomodoro", "Only a Pomodoro has a cycle to reset.");
    const saved = t.phase === "work" && t.state !== "waiting" ? saveEntry(t, stretchEnd(t, Date.now())) : null;
    timer = null;
    return json(response(null, { saved }));
  }),
  action("extend", (t) => {
    if (t.style !== "focus" || t.focusMinutes === null || !t.plannedEndAt) return problem(409, "not_focus", "Only a Focus session can be extended.");
    if (t.focusMinutes + EXTEND_MIN > MAX_FOCUS_MIN) return validation("focusMinutes", "A Focus session is at most 8 hours.", "too_long");
    t.focusMinutes += EXTEND_MIN;
    t.plannedEndAt = iso(ms(t.plannedEndAt) + EXTEND_MIN * 60_000);
    bump(t);
    return json(response(t));
  }),
  http.post(`${API}/time/timer/undo`, async ({ request }) => {
    const body = await readJson<Body<"/api/v1/time/timer/undo", "post">>(request);
    const expected = body.timerVersion ?? null;
    const gone = () => problem(409, "undo_unavailable", "This can no longer be undone.");
    if ((timer === null) !== (expected === null) || (timer && timer.version !== expected)) return gone();
    const u = body.undo ?? {};
    const entry = u.entryId ? entries.find((e) => e.id === u.entryId) : undefined;
    if (u.entryId && (!entry || entry.version !== 1 || entry.deletedAt)) return gone();
    const prev = u.previous;
    if (!prev) return gone();
    if (tagMissing(prev.tagId)) return notFound("Tag");
    const links = resolveLinks(prev);
    if (links instanceof Response) return links;
    if (entry) entries = entries.filter((e) => e !== entry);
    timer = {
      pausedAt: null,
      plannedEndAt: null,
      finishedAt: null,
      tagId: null,
      phase: null,
      period: null,
      focusMinutes: null,
      goal: null,
      ...prev,
      ...links,
      version: 1,
    };
    return json(response(timer));
  }),

  // entries
  http.get(`${API}/time/entries`, ({ request }) => {
    const p = new URL(request.url).searchParams;
    const range = rangeOf(p);
    return range instanceof Response ? range : json(entriesIn(range[0], range[1], p.get("sessionKey")));
  }),
  http.post(`${API}/time/entries`, async ({ request }) => {
    const body = await readJson<Body<"/api/v1/time/entries", "post">>(request);
    const start = ms(body.startedAt);
    if (Number.isNaN(start)) return validation("startedAt", "Give a start time.", "required");
    if (body.endedAt == null && body.durationSeconds == null) return validation("endedAt", "Give an end or a duration.", "required");
    const end = body.endedAt != null ? ms(body.endedAt) : start + body.durationSeconds! * 1000;
    if (!(end > start)) return validation("endedAt", "The end must be after the start.", "end_not_after_start");
    if (tagMissing(body.tagId)) return notFound("Tag");
    const links = resolveLinks(body);
    if (links instanceof Response) return links;
    const e: Entry = {
      id: newId("entry"),
      startedAt: iso(start),
      endedAt: iso(end),
      pausedSeconds: 0,
      source: "manual",
      description: (body.description ?? "").trim(),
      tagId: body.tagId ?? null,
      ...links,
      version: 1,
      deletedAt: null,
    };
    entries.push(e);
    return json({ entry: entryOut(e), overlaps: overlaps(e) }, 201);
  }),
  http.patch(`${API}/time/entries/:id`, async ({ request, params }) => {
    const e = entries.find((x) => x.id === params.id && !x.deletedAt);
    if (!e) return notFound("Entry");
    const conflict = checkIfMatch(request, e);
    if (conflict) return conflict;
    const body = await readJson<Body<"/api/v1/time/entries/{entry_id}", "patch">>(request);
    const start = body.startedAt ? ms(body.startedAt) : ms(e.startedAt);
    const end = body.endedAt ? ms(body.endedAt) : ms(e.endedAt);
    if (!(end > start)) return validation("endedAt", "The end must be after the start.", "end_not_after_start");
    if ("tagId" in body && tagMissing(body.tagId)) return notFound("Tag");
    if ("courseId" in body || "taskId" in body || "sessionKey" in body) {
      const links = resolveLinks({ courseId: e.courseId, taskId: e.taskId, sessionKey: e.sessionKey, ...body });
      if (links instanceof Response) return links;
      Object.assign(e, links);
    }
    Object.assign(e, { startedAt: iso(start), endedAt: iso(end) });
    if (e.pausedSeconds >= (end - start) / 1000) e.pausedSeconds = 0;
    if ("description" in body) e.description = (body.description ?? "").trim();
    if ("tagId" in body) e.tagId = body.tagId ?? null;
    bump(e);
    return json({ entry: entryOut(e), overlaps: overlaps(e) });
  }),
  http.delete(`${API}/time/entries/:id`, ({ params }) => {
    const e = entries.find((x) => x.id === params.id && !x.deletedAt);
    if (!e) return notFound("Entry");
    e.deletedAt = iso(Date.now());
    return noContent();
  }),
  http.post(`${API}/time/entries/:id/restore`, ({ params }) => {
    const e = entries.find((x) => x.id === params.id && x.deletedAt);
    if (!e) return notFound("Entry");
    e.deletedAt = null;
    return json(entryOut(e));
  }),

  // tags
  http.get(`${API}/time/tags`, () => {
    ensureCourseTags();
    return json([...tags].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())).map(tagOut));
  }),
  http.post(`${API}/time/tags`, async ({ request }) => {
    const body = await readJson<Body<"/api/v1/time/tags", "post">>(request);
    const name = tagNameError(body.name);
    if (name instanceof Response) return name;
    const t: Tag = { id: newId("tag"), name, color: body.color, version: 1 };
    tags.push(t);
    return json(tagOut(t), 201);
  }),
  http.patch(`${API}/time/tags/:id`, async ({ request, params }) => {
    const t = tags.find((x) => x.id === params.id);
    if (!t) return notFound("Tag");
    const conflict = checkIfMatch(request, t);
    if (conflict) return conflict;
    const body = await readJson<Body<"/api/v1/time/tags/{tag_id}", "patch">>(request);
    if (body.name != null) {
      const name = tagNameError(body.name, t.id);
      if (name instanceof Response) return name;
      t.name = name;
    }
    if (body.color != null) t.color = body.color;
    bump(t);
    return json(tagOut(t));
  }),
  http.delete(`${API}/time/tags/:id`, ({ params }) => {
    const t = tags.find((x) => x.id === params.id);
    if (!t) return notFound("Tag");
    for (const e of entries) if (e.tagId === t.id) e.tagId = null; // entries and the timer keep going, untagged
    if (timer?.tagId === t.id) timer.tagId = null;
    tags = tags.filter((x) => x !== t);
    return noContent();
  }),
];

/** `from`/`to` query params as epoch ms, or the 422 the API answers. */
export function rangeOf(p: URLSearchParams): [number, number] | Response {
  const from = ms(p.get("from") ?? "");
  const to = ms(p.get("to") ?? "");
  if (Number.isNaN(from)) return validation("from", "Give a start.", "required");
  if (Number.isNaN(to)) return validation("to", "Give an end.", "required");
  if (to <= from) return validation("to", "`to` must be after `from`.", "range_empty");
  if (to - from > 400 * 86_400_000) return validation("to", "Ask for at most 400 days at once.", "range_too_long");
  return [from, to];
}

function overlaps(e: Entry): Schemas["Overlap"][] {
  return entries
    .filter((r) => r !== e && !r.deletedAt && ms(r.startedAt) < ms(e.endedAt) && ms(r.endedAt) > ms(e.startedAt))
    .map((r) => ({ id: r.id, description: r.description, startedAt: r.startedAt, endedAt: r.endedAt }));
}
