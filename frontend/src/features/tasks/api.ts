/**
 * Task board API (012): columns, tasks, checklist and quick notes.
 *
 * One `["tasks"]` cache feeds the board, list, rail counts and calendar markers (research R8).
 * Moves are optimistic (`applyMove`, rolled back with a Retry toast — FR-020). Detail fields and
 * quick notes autosave through the notes' `NoteSaver` (sessions/autosave.ts): the saved "content"
 * is the JSON of the editable fields and only changed fields are sent. On 412 the latest version
 * is fetched and the user's unsaved fields are re-applied on top of it (R7, FR-027); network
 * failures keep the values and retry with backoff (`retry()` saves at once).
 */
import { useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError, apiFetch, type Schemas } from "@/lib/api";
import {
  ensureSaver,
  getSaver,
  removeSaver,
  useSaveStatus,
  type SaveFn,
  type SaveStatus,
} from "@/features/sessions/autosave";
import { applyMove } from "./model/order";

export type Task = Schemas["TaskOut"];
export type TaskDetail = Schemas["TaskDetailOut"];
export type TaskColumn = Schemas["TaskColumnOut"];
export type QuickNote = Schemas["QuickNoteOut"];
export type ChecklistItem = Schemas["ChecklistItemOut"];
export type ChecklistItemInput = Schemas["ChecklistItemIn"];
/** `POST /tasks` body; `description` defaults to "" on the server. */
export type TaskCreateInput = Omit<Schemas["TaskCreate"], "description"> & { description?: string };

export const taskKeys = {
  all: ["tasks"] as const,
  detail: (id: string) => ["task", id] as const,
  notes: (id: string) => ["task", id, "quick-notes"] as const,
};
export const columnKeys = ["task-columns"] as const;

const UNDO_MS = 10_000;
const enc = encodeURIComponent;

function invalidateBoard(qc: QueryClient) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: taskKeys.all }),
    qc.invalidateQueries({ queryKey: columnKeys }),
  ]);
}

/** Put a task returned by the server into the list cache (and its details, when given). */
function storeTask(qc: QueryClient, task: Task | TaskDetail) {
  qc.setQueryData<Task[]>(taskKeys.all, (list) => list?.map((t) => (t.id === task.id ? { ...t, ...task } : t)));
  if ("checklist" in task) qc.setQueryData<TaskDetail>(taskKeys.detail(task.id), task);
}

// ---- reads ------------------------------------------------------------------------------------

export function useTasks() {
  return useQuery({ queryKey: taskKeys.all, queryFn: () => apiFetch<Task[]>("/tasks") });
}

export function useTaskColumns() {
  return useQuery({ queryKey: columnKeys, queryFn: () => apiFetch<TaskColumn[]>("/task-columns") });
}

export function useTask(id: string | undefined) {
  return useQuery({
    queryKey: taskKeys.detail(id ?? ""),
    queryFn: () => apiFetch<TaskDetail>(`/tasks/${enc(id!)}`),
    enabled: !!id,
  });
}

// ---- tasks ------------------------------------------------------------------------------------

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TaskCreateInput) => apiFetch<Task>("/tasks", { method: "POST", body }),
    onSuccess: (task) => {
      qc.setQueryData<Task[]>(taskKeys.all, (list) => (list ? [...list, task] : list));
      return invalidateBoard(qc);
    },
  });
}

export interface MoveVars {
  id: string;
  version: number;
  columnId: string;
  index: number;
}

/** Optimistic move: the cached list is reordered at once and restored if the server refuses. */
export function useMoveTask() {
  const qc = useQueryClient();
  const retry = async (vars: MoveVars) => {
    await qc.refetchQueries({ queryKey: taskKeys.all });
    const fresh = qc.getQueryData<Task[]>(taskKeys.all)?.find((t) => t.id === vars.id);
    if (fresh) mutation.mutate({ ...vars, version: fresh.version });
  };
  const mutation = useMutation({
    mutationFn: ({ id, version, columnId, index }: MoveVars) =>
      apiFetch<Task>(`/tasks/${enc(id)}/move`, { method: "POST", version, body: { columnId, index } }),
    onMutate: async ({ id, columnId, index }) => {
      await qc.cancelQueries({ queryKey: taskKeys.all });
      const previous = qc.getQueryData<Task[]>(taskKeys.all);
      const columns = qc.getQueryData<TaskColumn[]>(columnKeys);
      if (previous) qc.setQueryData<Task[]>(taskKeys.all, applyMove(previous, id, columnId, index, columns));
      return { previous };
    },
    onError: (_err, vars, context) => {
      if (context?.previous) qc.setQueryData(taskKeys.all, context.previous);
      toast.error("Couldn't move the task", { action: { label: "Retry", onClick: () => void retry(vars) } });
    },
    onSuccess: (task) => storeTask(qc, task),
    onSettled: (_data, _err, vars) =>
      Promise.all([invalidateBoard(qc), qc.invalidateQueries({ queryKey: taskKeys.detail(vars.id), exact: true })]),
  });
  return mutation;
}

export function useReplaceChecklist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, version, items }: { id: string; version: number; items: ChecklistItemInput[] }) => {
      // pending detail edits first: the checklist shares the task's version (R7)
      const saver = getSaver(taskSaverKey(id));
      if (saver) await saver.flush();
      return apiFetch<TaskDetail>(`/tasks/${enc(id)}/checklist`, {
        method: "PUT",
        version: saver?.version ?? version,
        body: { items },
      });
    },
    onSuccess: (task) => {
      storeTask(qc, task);
      syncSaverVersion(taskSaverKey(task.id), task.version);
    },
    onError: (_err, vars) => qc.invalidateQueries({ queryKey: taskKeys.detail(vars.id), exact: true }),
  });
}

/** Soft delete with a 10 s "Undo" toast that restores position, checklist and quick notes. */
export function useDeleteTask() {
  const qc = useQueryClient();
  const restore = async (id: string) => {
    try {
      await apiFetch<Task>(`/tasks/${enc(id)}/restore`, { method: "POST" });
    } catch {
      toast.error("Couldn't restore the task");
    }
    await Promise.all([invalidateBoard(qc), qc.invalidateQueries({ queryKey: taskKeys.detail(id) })]);
  };
  return useMutation({
    mutationFn: async ({ id, version }: { id: string; version: number }) => {
      const key = taskSaverKey(id);
      const saver = getSaver(key);
      if (saver) await saver.flush();
      await apiFetch<void>(`/tasks/${enc(id)}`, { method: "DELETE", version: saver?.version ?? version });
      dropSaver(key);
    },
    onSuccess: (_data, { id }) => {
      qc.setQueryData<Task[]>(taskKeys.all, (list) => list?.filter((t) => t.id !== id));
      qc.removeQueries({ queryKey: taskKeys.detail(id) });
      toast("Task deleted", { duration: UNDO_MS, action: { label: "Undo", onClick: () => void restore(id) } });
    },
    onSettled: () => invalidateBoard(qc),
  });
}

// ---- columns ----------------------------------------------------------------------------------

export function useCreateColumn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; countsAsDone?: boolean }) =>
      apiFetch<TaskColumn>("/task-columns", { method: "POST", body }),
    onSuccess: (col) => {
      qc.setQueryData<TaskColumn[]>(columnKeys, (cols) => (cols ? [...cols, col] : cols));
      return qc.invalidateQueries({ queryKey: columnKeys });
    },
  });
}

export function usePatchColumn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, version, body }: { id: string; version: number; body: Schemas["TaskColumnPatch"] }) =>
      apiFetch<TaskColumn>(`/task-columns/${enc(id)}`, { method: "PATCH", version, body }),
    onSuccess: (col) => {
      qc.setQueryData<TaskColumn[]>(columnKeys, (cols) => cols?.map((c) => (c.id === col.id ? col : c)));
    },
    // the done flag sets or clears completion on the column's tasks
    onSettled: () => invalidateBoard(qc),
  });
}

/** Optimistic column order; restored with a Retry toast if the server refuses. */
export function useReorderColumns() {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (columnIds: string[]) =>
      apiFetch<TaskColumn[]>("/task-columns/order", { method: "PUT", body: { columnIds } }),
    onMutate: async (columnIds) => {
      await qc.cancelQueries({ queryKey: columnKeys });
      const previous = qc.getQueryData<TaskColumn[]>(columnKeys);
      if (previous) {
        const byId = new Map(previous.map((c) => [c.id, c]));
        const next = columnIds.flatMap((id, position) => {
          const c = byId.get(id);
          return c ? [{ ...c, position }] : [];
        });
        if (next.length === previous.length) qc.setQueryData(columnKeys, next);
      }
      return { previous };
    },
    onError: (_err, columnIds, context) => {
      if (context?.previous) qc.setQueryData(columnKeys, context.previous);
      toast.error("Couldn't reorder the columns", {
        action: { label: "Retry", onClick: () => mutation.mutate(columnIds) },
      });
    },
    onSuccess: (cols) => qc.setQueryData(columnKeys, cols),
    onSettled: () => qc.invalidateQueries({ queryKey: columnKeys }),
  });
  return mutation;
}

/** Delete a column; `moveTo` is required when it holds tasks. Returns the remaining columns. */
export function useDeleteColumn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, version, moveTo }: { id: string; version: number; moveTo?: string }) =>
      apiFetch<TaskColumn[]>(`/task-columns/${enc(id)}`, { method: "DELETE", version, query: { moveTo } }),
    onSuccess: (cols) => qc.setQueryData(columnKeys, cols),
    onSettled: () => invalidateBoard(qc),
  });
}

// ---- autosave (detail fields, quick notes) -------------------------------------------------------

type Fields = Record<string, unknown>;

interface AutosaveConfig {
  /** PATCH the changed fields; resolves with the saved row's version. */
  patch: (body: Fields, version: number) => Promise<{ version: number }>;
  /** The server's current field values and version (after a 412), or null when it is gone. */
  latest: () => Promise<{ fields: Fields; version: number } | null>;
}

/** Fields the user changed here and the server has not confirmed yet, per saver key. */
const touched = new Map<string, Set<string>>();
/** Savers that merged someone else's newer version (412): adopt the server values once saved. */
const adoptAfterSave = new Set<string>();
const configs = new Map<string, AutosaveConfig>();

const taskSaverKey = (id: string) => `task:${id}`;
const noteSaverKey = (id: string) => `quick-note:${id}`;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const saveFields: SaveFn = async (key, content, version) => {
  const config = configs.get(key);
  if (!config) throw new Error("Nothing to save to");
  const local = JSON.parse(content) as Fields;
  const keys = [...(touched.get(key) ?? [])];
  const body = Object.fromEntries(keys.map((k) => [k, local[k]]));
  if (keys.length === 0) return { version, hash: "" };
  let saved: { version: number };
  try {
    saved = await config.patch(body, version);
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 412)) throw err;
    // changed elsewhere: take the latest version and re-apply only what the user changed here
    const latest = await config.latest();
    if (!latest) throw err;
    try {
      saved = await config.patch(body, latest.version);
    } catch (again) {
      // still racing: a plain error keeps the values and retries with backoff
      if (again instanceof ApiError && again.status === 412) throw new Error("Changed elsewhere", { cause: again });
      throw again;
    }
    adoptAfterSave.add(key);
  }
  // fields edited again while the request was in flight stay pending
  const current = JSON.parse(getSaver(key)?.content ?? content) as Fields;
  for (const k of keys) if (same(current[k], local[k])) touched.get(key)?.delete(k);
  return { version: saved.version, hash: "" };
};

function syncSaverVersion(key: string, version: number) {
  const saver = getSaver(key);
  if (saver && saver.status === "saved" && version > saver.version) saver.version = version;
}

function dropSaver(key: string) {
  removeSaver(key);
  touched.delete(key);
  adoptAfterSave.delete(key);
  configs.delete(key);
}

export interface AutosaveHandle<F> {
  status: SaveStatus;
  lastSavedAt: number | null;
  /** The values being edited (unsaved ones included). */
  values: () => F | undefined;
  /** Change fields; saved after a short pause. */
  update: (fields: Partial<F>) => void;
  /** Save now; resolves when nothing is pending or the save failed. */
  flush: () => Promise<void>;
  /** After "Couldn't save": try again now. */
  retry: () => Promise<void>;
}

function useFieldAutosave<F extends Fields>(
  key: string | undefined,
  server: { fields: F; version: number } | undefined,
  config: AutosaveConfig,
): AutosaveHandle<F> {
  if (key) configs.set(key, config);
  const serverJson = server ? JSON.stringify(server.fields) : undefined;
  const loaded = server !== undefined;
  const saver = useMemo(() => {
    if (!key || !server) return undefined;
    if (!touched.has(key)) touched.set(key, new Set());
    return ensureSaver(key, { content: JSON.stringify(server.fields), version: server.version, hash: "" }, saveFields);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one saver per key
  }, [key, loaded]);

  // newer server data (another tab, a move, the checklist) is adopted while nothing is unsaved
  useEffect(() => {
    if (!saver || !server || serverJson === undefined) return;
    const key = saver.noteId;
    if (server.version < saver.version || (server.version === saver.version && !adoptAfterSave.has(key))) return;
    if (saver.adoptServerReplace({ content: serverJson, hash: "", version: server.version })) adoptAfterSave.delete(key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saver, server?.version, serverJson]);

  // closing the editor saves what is pending, then forgets the saver
  useEffect(() => {
    if (!saver) return;
    return () => {
      void saver.flush().then(() => {
        if (!saver.pending && getSaver(saver.noteId) === saver) dropSaver(saver.noteId);
      });
    };
  }, [saver]);

  const snapshot = useSaveStatus(saver);
  return {
    status: snapshot?.status ?? "saved",
    lastSavedAt: snapshot?.lastSavedAt ?? null,
    values: () => (saver ? (JSON.parse(saver.content) as F) : undefined),
    update: (fields) => {
      if (!saver) return;
      const set = touched.get(saver.noteId) ?? new Set<string>();
      touched.set(saver.noteId, set);
      Object.keys(fields).forEach((k) => set.add(k));
      saver.update(JSON.stringify({ ...(JSON.parse(saver.content) as F), ...fields }));
    },
    flush: () => saver?.flush() ?? Promise.resolve(),
    retry: () => saver?.flush() ?? Promise.resolve(),
  };
}

export interface TaskFields {
  title: string;
  description: string;
  dueDate: string | null;
  dueTime: string | null;
  courseId: string | null;
  [key: string]: unknown;
}

const taskFields = (t: Task): TaskFields => ({
  title: t.title,
  description: t.description,
  dueDate: t.dueDate,
  dueTime: t.dueTime,
  courseId: t.courseId,
});

/**
 * Autosave of the details sheet's fields (title, description, due date/time, course). For a task
 * linked to an event only description and course may change (title and due follow the event).
 */
export function usePatchTask(task: TaskDetail | undefined): AutosaveHandle<TaskFields> {
  const qc = useQueryClient();
  const id = task?.id;
  return useFieldAutosave<TaskFields>(
    id ? taskSaverKey(id) : undefined,
    task ? { fields: taskFields(task), version: task.version } : undefined,
    {
      patch: async (body, version) => {
        const saved = await apiFetch<TaskDetail>(`/tasks/${enc(id!)}`, { method: "PATCH", version, body });
        storeTask(qc, saved);
        return saved;
      },
      latest: async () => {
        try {
          const fresh = await apiFetch<TaskDetail>(`/tasks/${enc(id!)}`);
          storeTask(qc, fresh);
          return { fields: taskFields(fresh), version: fresh.version };
        } catch (err) {
          if (err instanceof ApiError && err.status === 404) return null;
          throw err;
        }
      },
    },
  );
}

// ---- quick notes --------------------------------------------------------------------------------

export function useQuickNotes(taskId: string | undefined) {
  return useQuery({
    queryKey: taskKeys.notes(taskId ?? ""),
    queryFn: () => apiFetch<QuickNote[]>(`/tasks/${enc(taskId!)}/quick-notes`),
    enabled: !!taskId,
  });
}

function storeNote(qc: QueryClient, note: QuickNote) {
  qc.setQueryData<QuickNote[]>(taskKeys.notes(note.taskId), (list) =>
    list ? (list.some((n) => n.id === note.id) ? list.map((n) => (n.id === note.id ? note : n)) : [note, ...list]) : list,
  );
}

/** Notes change the card's quick-note count. */
function invalidateNotes(qc: QueryClient, taskId: string) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: taskKeys.notes(taskId) }),
    qc.invalidateQueries({ queryKey: taskKeys.all }),
  ]);
}

/** `onCreated` runs before the note enters the cached list, so a caller showing it as a draft can
 * claim it in the same render (otherwise it would be listed twice until the refetch ends). */
export function useCreateQuickNote(options: { onCreated?: (note: QuickNote) => void } = {}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, title, body }: { taskId: string; title?: string; body?: string }) =>
      apiFetch<QuickNote>(`/tasks/${enc(taskId)}/quick-notes`, { method: "POST", body: { title, body } }),
    onSuccess: (note) => {
      options.onCreated?.(note);
      storeNote(qc, note);
      return invalidateNotes(qc, note.taskId);
    },
  });
}

export interface QuickNoteFields {
  title: string;
  body: string;
  [key: string]: unknown;
}

/** Autosave of one quick note's title and text. */
export function usePatchQuickNote(note: QuickNote | undefined): AutosaveHandle<QuickNoteFields> {
  const qc = useQueryClient();
  const id = note?.id;
  const taskId = note?.taskId;
  return useFieldAutosave<QuickNoteFields>(
    id ? noteSaverKey(id) : undefined,
    note ? { fields: { title: note.title, body: note.body }, version: note.version } : undefined,
    {
      patch: async (body, version) => {
        const saved = await apiFetch<QuickNote>(`/quick-notes/${enc(id!)}`, { method: "PATCH", version, body });
        storeNote(qc, saved);
        return saved;
      },
      latest: async () => {
        const notes = await apiFetch<QuickNote[]>(`/tasks/${enc(taskId!)}/quick-notes`);
        qc.setQueryData(taskKeys.notes(taskId!), notes);
        const fresh = notes.find((n) => n.id === id);
        return fresh ? { fields: { title: fresh.title, body: fresh.body }, version: fresh.version } : null;
      },
    },
  );
}

/** Soft delete with a 10 s "Undo" toast. */
export function useDeleteQuickNote() {
  const qc = useQueryClient();
  const restore = async (note: QuickNote) => {
    try {
      await apiFetch<QuickNote>(`/quick-notes/${enc(note.id)}/restore`, { method: "POST" });
    } catch {
      toast.error("Couldn't restore the quick note");
    }
    await invalidateNotes(qc, note.taskId);
  };
  return useMutation({
    mutationFn: async (note: QuickNote) => {
      const key = noteSaverKey(note.id);
      const saver = getSaver(key);
      if (saver) await saver.flush();
      await apiFetch<void>(`/quick-notes/${enc(note.id)}`, { method: "DELETE", version: saver?.version ?? note.version });
      dropSaver(key);
    },
    onSuccess: (_data, note) => {
      qc.setQueryData<QuickNote[]>(taskKeys.notes(note.taskId), (list) => list?.filter((n) => n.id !== note.id));
      toast("Quick note deleted", {
        duration: UNDO_MS,
        action: { label: "Undo", onClick: () => void restore(note) },
      });
    },
    onSettled: (_data, _err, note) => invalidateNotes(qc, note.taskId),
  });
}
