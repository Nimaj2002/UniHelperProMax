/**
 * 024: the task board — columns, tasks, checklists and quick notes (contracts/demo-mode.md §2),
 * mirroring services/task_service.py, task_column_service.py and quick_note_service.py.
 * Deleted tasks and notes stay restorable for the whole demo session (the real Undo window is 24 h).
 */
import { http, type HttpHandler } from "msw";
import type { Schemas } from "@/lib/api";
import { addDays, getSession, todayIso } from "../calendar";
import { API, checkIfMatch, json, noContent, notFound, problem, readJson, validation, type Body } from "../http";
import { IDS, upcomingKeys } from "../seed";
import { bump, getStore, newId, nowIso, registerSlice } from "../store";

type TaskOut = Schemas["TaskOut"];
type Column = Omit<Schemas["TaskColumnOut"], "taskCount">;
export interface Task {
  id: string;
  columnId: string;
  position: number;
  title: string;
  description: string;
  dueDate: string | null;
  dueTime: string | null;
  courseId: string | null;
  eventKey: string | null;
  completedAt: string | null;
  previousColumnId: string | null;
  checklist: Schemas["ChecklistItemOut"][];
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
type QuickNote = Schemas["QuickNoteOut"] & { deletedAt: string | null };

let columns: Column[] = [];
let tasks: Task[] = [];
let notes: QuickNote[] = [];

// ---------- queries (also used by exports.ts and time.ts) ----------

export const boardColumns = () => [...columns].sort((a, b) => a.position - b.position);
const liveOf = (columnId: string) =>
  tasks.filter((t) => !t.deletedAt && t.columnId === columnId).sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
/** Live tasks in board order. */
export const liveTasks = () => boardColumns().flatMap((c) => liveOf(c.id));
export const findLiveTask = (id: string) => tasks.find((t) => t.id === id && !t.deletedAt);
export const liveNotesOf = (taskId: string) =>
  notes.filter((n) => n.taskId === taskId && !n.deletedAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));

/** A linked task follows its event occurrence; an occurrence that is gone unlinks it. */
function sync(t: Task) {
  if (!t.eventKey) return;
  const s = getSession(t.eventKey);
  if (!s) {
    t.eventKey = null;
    return;
  }
  t.title = s.title ?? "Event";
  t.dueDate = s.date;
  t.dueTime = s.start.slice(11, 16);
}

export function taskOut(t: Task): TaskOut {
  sync(t);
  return outOf(t);
}

function outOf({ checklist, eventKey, deletedAt: _d, ...rest }: Task): TaskOut {
  const course = rest.courseId ? getStore().courses.find((c) => c.id === rest.courseId) : undefined;
  return {
    ...rest,
    courseName: course?.name ?? null,
    courseColor: course?.defaultColor ?? null,
    event: eventKey ? { sessionKey: eventKey, title: rest.title, date: rest.dueDate!, start: rest.dueTime } : null,
    checklistDone: checklist.filter((i) => i.done).length,
    checklistTotal: checklist.length,
    quickNoteCount: liveNotesOf(rest.id).length,
  };
}

const detailOut = (t: Task): Schemas["TaskDetailOut"] => ({ ...taskOut(t), checklist: t.checklist });
const columnOut = (c: Column): Schemas["TaskColumnOut"] => ({ ...c, taskCount: liveOf(c.id).length });
const columnsOut = () => boardColumns().map(columnOut);

// ---------- helpers ----------

/** Positions 0..n-1 in list order; siblings are renumbered without a version bump (like the API). */
function setPositions(list: Task[]) {
  list.forEach((t, i) => (t.position = i));
}

function touch(t: Task) {
  t.updatedAt = nowIso();
  bump(t);
}

const titleError = () => validation("title", "Enter a title.", "validation_failed");
const timeWithoutDate = () => validation("dueTime", "Add a due date to set a time.", "time_without_date");

function badTitle(title: unknown) {
  return typeof title !== "string" || !title.trim() || title.trim().length > 200;
}

const findColumn = (id: string) => columns.find((c) => c.id === id);
const courseMissing = (id: string | null | undefined) => !!id && !getStore().courses.some((c) => c.id === id);

/** Record or clear completion when a task lands in `target` (task_service._enter_column). */
function enterColumn(t: Task, old: Column | undefined, target: Column) {
  const wasDone = !!old?.countsAsDone;
  if (target.countsAsDone && !wasDone) {
    t.completedAt = nowIso();
    t.previousColumnId = old?.id ?? null;
  } else if (target.countsAsDone) t.completedAt ??= nowIso();
  else t.completedAt = null;
}

function cleanColumnName(name: unknown, excludeId?: string): string | Response {
  const cleaned = typeof name === "string" ? name.trim().replace(/\s+/g, " ") : "";
  const rule = "Column names are required, unique (ignoring case), up to 40 characters.";
  if (!cleaned || cleaned.length > 40) return validation("name", rule, "validation_failed");
  if (columns.some((c) => c.id !== excludeId && c.name.toLowerCase() === cleaned.toLowerCase()))
    return problem(409, "name_taken", "A column with this name already exists.", undefined, [{ field: "/name", code: "name_taken", message: rule }]);
  return cleaned;
}

// ---------- seed ----------

function seed() {
  const today = todayIso();
  const at = nowIso();
  const col = (name: string, position: number, countsAsDone = false): Column => ({ id: newId("col"), name, position, countsAsDone, version: 1 });
  columns = [col("To do", 0), col("In progress", 1), col("Done", 2, true)];
  const [todo, doing, done] = columns;
  tasks = [];
  notes = [];
  const add = (columnId: string, title: string, fields: Partial<Task> = {}) => {
    const t: Task = {
      id: newId("task"),
      columnId,
      position: liveOf(columnId).length,
      title,
      description: "",
      dueDate: null,
      dueTime: null,
      courseId: null,
      eventKey: null,
      completedAt: columnId === done.id ? at : null,
      previousColumnId: columnId === done.id ? todo.id : null,
      checklist: [],
      version: 1,
      createdAt: at,
      updatedAt: at,
      deletedAt: null,
      ...fields,
    };
    tasks.push(t);
    return t;
  };
  const ps = add(todo.id, "Problem set 4: graph traversal", {
    courseId: IDS.algo,
    dueDate: addDays(today, 2),
    dueTime: "23:59",
    description: "Questions 1–5 from the handout. Submit as a single PDF.",
    checklist: [
      { id: newId("chk"), text: "Prove BFS finds shortest paths", done: true },
      { id: newId("chk"), text: "DFS running-time analysis", done: false },
      { id: newId("chk"), text: "Write up and submit", done: false },
    ],
  });
  notes.push({ id: newId("qn"), taskId: ps.id, title: "Hint from the TA", body: "Use the white-path theorem for part (c).", version: 1, createdAt: at, updatedAt: at, deletedAt: null });
  add(todo.id, "Read chapter 5: eigenvalues", { courseId: IDS.linalg, dueDate: addDays(today, 1) });
  const fair = upcomingKeys(IDS.careerLineage)[0];
  if (fair) add(todo.id, "Career Fair", { eventKey: fair, description: "Bring printed CVs." });
  add(todo.id, "Draft essay outline", { courseId: IDS.writing, dueDate: addDays(today, 5) });
  add(doing.id, "Implement Dijkstra for the project", { courseId: IDS.algo, dueDate: addDays(today, 3), dueTime: "14:00" });
  add(doing.id, "Midterm prep: linear transformations", { courseId: IDS.linalg, dueDate: addDays(today, 6) });
  add(done.id, "Submit lab report 3", { courseId: IDS.writing, dueDate: addDays(today, -2) });
  add(done.id, "Register for next semester's courses", { dueDate: addDays(today, -3) });
}

registerSlice({
  name: "tasks",
  seed,
  removeSessions: (keys) => {
    for (const t of tasks) if (t.eventKey && keys.has(t.eventKey)) t.eventKey = null; // unlinked, keeps its title and date
  },
  taskFor: (key) => tasks.find((t) => !t.deletedAt && t.eventKey === key)?.id ?? null,
  count: (keys) => ({ linkedTaskCount: tasks.filter((t) => !t.deletedAt && t.eventKey && keys.has(t.eventKey)).length }),
  snapshot: (lineageIds) => {
    const linked = tasks.filter((t) => t.eventKey && lineageIds.has(t.eventKey.slice(0, t.eventKey.lastIndexOf(":")))).map((t) => [t, t.eventKey] as const);
    return () => {
      for (const [t, key] of linked) t.eventKey = key;
    };
  },
});

// ---------- handlers ----------

const taskOr404 = (id: unknown) => findLiveTask(String(id));

export const handlers: HttpHandler[] = [
  // columns
  http.get(`${API}/task-columns`, () => json(columnsOut())),
  http.post(`${API}/task-columns`, async ({ request }) => {
    const body = await readJson<Body<"/api/v1/task-columns", "post">>(request);
    if (columns.length >= 12) return problem(409, "column_limit", "A board holds at most 12 columns.");
    const name = cleanColumnName(body.name);
    if (name instanceof Response) return name;
    const c: Column = { id: newId("col"), name, position: columns.length, countsAsDone: !!body.countsAsDone, version: 1 };
    columns.push(c);
    return json(columnOut(c), 201);
  }),
  http.put(`${API}/task-columns/order`, async ({ request }) => {
    const { columnIds = [] } = await readJson<Body<"/api/v1/task-columns/order", "put">>(request);
    if (new Set(columnIds).size !== columnIds.length || columnIds.length !== columns.length || !columnIds.every(findColumn))
      return problem(409, "order_mismatch", "The list of columns has changed. Reload and try again.");
    columnIds.forEach((id, i) => (findColumn(id)!.position = i));
    return json(columnsOut());
  }),
  http.patch(`${API}/task-columns/:id`, async ({ request, params }) => {
    const c = findColumn(String(params.id));
    if (!c) return notFound("Column");
    const conflict = checkIfMatch(request, c);
    if (conflict) return conflict;
    const body = await readJson<Body<"/api/v1/task-columns/{column_id}", "patch">>(request);
    if (body.name != null) {
      const name = cleanColumnName(body.name, c.id);
      if (name instanceof Response) return name;
      c.name = name;
    }
    if (body.countsAsDone != null && body.countsAsDone !== c.countsAsDone) {
      const at = nowIso();
      for (const t of liveOf(c.id)) t.completedAt = body.countsAsDone ? (t.completedAt ?? at) : null;
      c.countsAsDone = body.countsAsDone;
    }
    bump(c);
    return json(columnOut(c));
  }),
  http.delete(`${API}/task-columns/:id`, ({ request, params }) => {
    const c = findColumn(String(params.id));
    if (!c) return notFound("Column");
    const conflict = checkIfMatch(request, c);
    if (conflict) return conflict;
    if (columns.length <= 1) return problem(409, "last_column", "The board needs at least one column.");
    const moveTo = new URL(request.url).searchParams.get("moveTo");
    const target = moveTo !== null ? findColumn(moveTo) : undefined;
    if (moveTo !== null && !target) return notFound("Column");
    if (target?.id === c.id) return validation("moveTo", "Choose another column for its tasks.", "validation_failed");
    const live = liveOf(c.id);
    if (live.length && !target) return problem(409, "move_target_required", "Choose the column that receives this column's tasks.");
    if (target) {
      const end = liveOf(target.id).length;
      const at = nowIso();
      live.forEach((t, i) => {
        t.columnId = target.id;
        t.position = end + i;
        t.completedAt = target.countsAsDone ? (t.completedAt ?? at) : null;
      });
    }
    columns = boardColumns().filter((x) => x.id !== c.id);
    const home = target ?? columns[0];
    for (const t of tasks) if (t.deletedAt && t.columnId === c.id) Object.assign(t, { columnId: home.id, position: 1_000_000 });
    columns.forEach((x, i) => (x.position = i));
    return json(columnsOut());
  }),

  // tasks
  http.get(`${API}/tasks`, () => json(liveTasks().map(taskOut))),
  http.post(`${API}/tasks`, async ({ request }) => {
    const body = await readJson<Body<"/api/v1/tasks", "post">>(request);
    const col = body.columnId != null ? findColumn(body.columnId) : boardColumns()[0];
    if (!col) return notFound("Column");
    if (courseMissing(body.courseId)) return notFound("Course");
    const t: Task = {
      id: newId("task"),
      columnId: col.id,
      position: liveOf(col.id).length,
      title: "",
      description: body.description ?? "",
      dueDate: null,
      dueTime: null,
      courseId: body.courseId ?? null,
      eventKey: null,
      completedAt: col.countsAsDone ? nowIso() : null,
      previousColumnId: null,
      checklist: [],
      version: 1,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      deletedAt: null,
    };
    if (body.eventKey != null) {
      const s = getSession(body.eventKey);
      if (!s) return notFound("Event");
      if (s.kind === "class") {
        const message = "Only event occurrences can be linked to a task.";
        return problem(422, "not_an_event", message, undefined, [{ field: "/eventKey", code: "not_an_event", message }]);
      }
      if (tasks.some((x) => !x.deletedAt && x.eventKey === body.eventKey)) return problem(409, "event_has_task", "This event already has a task on the board.");
      t.eventKey = body.eventKey;
    } else {
      if (badTitle(body.title)) return titleError();
      if (body.dueTime != null && body.dueDate == null) return timeWithoutDate();
      Object.assign(t, { title: body.title!.trim(), dueDate: body.dueDate ?? null, dueTime: body.dueTime ?? null });
    }
    tasks.push(t);
    return json(taskOut(t), 201);
  }),
  http.get(`${API}/tasks/:id`, ({ params }) => {
    if (params.id === "export") return; // falls through to exports.ts (index.ts orders it later)
    const t = taskOr404(params.id);
    return t ? json(detailOut(t)) : notFound("Task");
  }),
  http.patch(`${API}/tasks/:id`, async ({ request, params }) => {
    const t = taskOr404(params.id);
    if (!t) return notFound("Task");
    const conflict = checkIfMatch(request, t);
    if (conflict) return conflict;
    const body = await readJson<Body<"/api/v1/tasks/{task_id}", "patch">>(request);
    if (t.eventKey && ["title", "dueDate", "dueTime"].some((f) => f in body))
      return problem(409, "linked_field_read_only", "The title and due date of a linked task follow its event. Edit the event.");
    if ("title" in body && badTitle(body.title)) return titleError();
    if ("courseId" in body && courseMissing(body.courseId)) return notFound("Course");
    const dueDate = "dueDate" in body ? (body.dueDate ?? null) : t.dueDate;
    const dueTime = "dueTime" in body ? (body.dueTime ?? null) : "dueDate" in body && dueDate === null ? null : t.dueTime;
    if (dueTime !== null && dueDate === null) return timeWithoutDate();
    if ("title" in body) t.title = body.title!.trim();
    if ("description" in body) t.description = body.description ?? "";
    if ("courseId" in body) t.courseId = body.courseId ?? null;
    Object.assign(t, { dueDate, dueTime });
    touch(t);
    return json(detailOut(t));
  }),
  http.delete(`${API}/tasks/:id`, ({ request, params }) => {
    const t = taskOr404(params.id);
    if (!t) return notFound("Task");
    const conflict = checkIfMatch(request, t);
    if (conflict) return conflict;
    t.deletedAt = nowIso();
    bump(t);
    setPositions(liveOf(t.columnId));
    return noContent();
  }),
  http.post(`${API}/tasks/:id/restore`, ({ params }) => {
    const t = tasks.find((x) => x.id === params.id && x.deletedAt);
    if (!t) return notFound("Task");
    const col = findColumn(t.columnId) ?? boardColumns()[0];
    t.columnId = col.id;
    if (t.eventKey && tasks.some((x) => x !== t && !x.deletedAt && x.eventKey === t.eventKey)) t.eventKey = null;
    t.completedAt = col.countsAsDone ? (t.completedAt ?? nowIso()) : null;
    const others = liveOf(col.id);
    others.splice(Math.min(t.position, others.length), 0, t);
    t.deletedAt = null;
    setPositions(others);
    bump(t);
    return json(taskOut(t));
  }),
  http.post(`${API}/tasks/:id/move`, async ({ request, params }) => {
    const t = taskOr404(params.id);
    if (!t) return notFound("Task");
    const conflict = checkIfMatch(request, t);
    if (conflict) return conflict;
    const body = await readJson<Body<"/api/v1/tasks/{task_id}/move", "post">>(request);
    const target = findColumn(body.columnId);
    if (!target) return notFound("Column");
    if (target.id !== t.columnId) {
      const source = liveOf(t.columnId).filter((x) => x !== t);
      enterColumn(t, findColumn(t.columnId), target);
      t.columnId = target.id;
      setPositions(source);
    }
    const others = liveOf(target.id).filter((x) => x !== t);
    others.splice(Math.min(Math.max(0, body.index ?? 0), others.length), 0, t);
    setPositions(others);
    touch(t);
    return json(taskOut(t));
  }),
  http.put(`${API}/tasks/:id/checklist`, async ({ request, params }) => {
    const t = taskOr404(params.id);
    if (!t) return notFound("Task");
    const conflict = checkIfMatch(request, t);
    if (conflict) return conflict;
    const { items = [] } = await readJson<Body<"/api/v1/tasks/{task_id}/checklist", "put">>(request);
    const given = items.flatMap((i) => (i.id ? [i.id] : []));
    if (new Set(given).size !== given.length) return validation("items", "Checklist item ids must be unique.", "validation_failed");
    if (items.some((i) => !i.text?.trim())) return validation("items", "Checklist items need some text.", "validation_failed");
    t.checklist = items.map((i) => ({ id: i.id ?? newId("chk"), text: i.text, done: !!i.done }));
    touch(t);
    return json(detailOut(t));
  }),

  // quick notes
  http.get(`${API}/tasks/:id/quick-notes`, ({ params }) => {
    const t = taskOr404(params.id);
    return t ? json(liveNotesOf(t.id).map(noteOut)) : notFound("Task");
  }),
  http.post(`${API}/tasks/:id/quick-notes`, async ({ request, params }) => {
    const t = taskOr404(params.id);
    if (!t) return notFound("Task");
    const body = await readJson<Body<"/api/v1/tasks/{task_id}/quick-notes", "post">>(request);
    const title = (body.title ?? "").trim();
    const text = body.body ?? "";
    if (!title && !text.trim()) return validation("body", "Write a title or some text.", "empty_quick_note");
    const at = nowIso();
    const n: QuickNote = { id: newId("qn"), taskId: t.id, title, body: text, version: 1, createdAt: at, updatedAt: at, deletedAt: null };
    notes.push(n);
    return json(noteOut(n), 201);
  }),
  http.patch(`${API}/quick-notes/:id`, async ({ request, params }) => {
    const n = liveNote(params.id);
    if (!n) return notFound("Quick note");
    const conflict = checkIfMatch(request, n);
    if (conflict) return conflict;
    const body = await readJson<Body<"/api/v1/quick-notes/{note_id}", "patch">>(request);
    if ("title" in body) n.title = (body.title ?? "").trim();
    if ("body" in body) n.body = body.body ?? "";
    n.updatedAt = nowIso();
    bump(n);
    return json(noteOut(n));
  }),
  http.delete(`${API}/quick-notes/:id`, ({ request, params }) => {
    const n = liveNote(params.id);
    if (!n) return notFound("Quick note");
    const conflict = checkIfMatch(request, n);
    if (conflict) return conflict;
    n.deletedAt = nowIso();
    return noContent();
  }),
  http.post(`${API}/quick-notes/:id/restore`, ({ params }) => {
    const n = notes.find((x) => x.id === params.id && x.deletedAt && findLiveTask(x.taskId));
    if (!n) return notFound("Quick note");
    n.deletedAt = null;
    return json(noteOut(n));
  }),
];

function liveNote(id: unknown) {
  return notes.find((n) => n.id === String(id) && !n.deletedAt && findLiveTask(n.taskId));
}

function noteOut({ deletedAt: _d, ...n }: QuickNote): Schemas["QuickNoteOut"] {
  return n;
}
