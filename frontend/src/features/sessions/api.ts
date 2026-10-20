import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, type Schemas } from "@/lib/api";

export type NoteMeta = Schemas["NoteMeta"];
export type Note = Schemas["Note"];
export type SaveResult = Schemas["SaveResult"];
export type TimelineEntry = Schemas["TimelineEntry"];
export type Timeline = Schemas["Timeline"];
export type WorkspaceState = Schemas["WorkspaceState"];
export type Preferences = Schemas["Preferences"];

const enc = encodeURIComponent;

export const notesKey = (sessionKey: string) => ["notes", sessionKey] as const;
export const noteKey = (id: string) => ["note", id] as const;

export function useNotes(sessionKey: string) {
  return useQuery({
    queryKey: notesKey(sessionKey),
    queryFn: () => apiFetch<NoteMeta[]>(`/sessions/${enc(sessionKey)}/notes`),
    placeholderData: keepPreviousData,
  });
}

export function fetchNote(id: string) {
  return apiFetch<Note>(`/notes/${enc(id)}`);
}

export function saveNoteContent(id: string, content: string, version: number, baseHash: string, keepalive = false) {
  return apiFetch<SaveResult>(`/notes/${enc(id)}/content`, {
    method: "PUT",
    body: { content, baseHash },
    version,
    keepalive,
  });
}

/** Create a note from an imported file (006); errors such as 409 `name_taken` are the caller's. */
export function createNote(sessionKey: string, name: string, content: string) {
  return apiFetch<Note>(`/sessions/${enc(sessionKey)}/notes`, { method: "POST", body: { name, content } });
}

/** Replace a note's whole content with an imported file's text, after the user confirmed it (006). */
export function importReplaceNote(noteId: string, version: number, content: string) {
  return apiFetch<Note>(`/notes/${enc(noteId)}/import-replace`, { method: "PUT", body: { content }, version });
}

export function useCreateNote(sessionKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; content?: string }) =>
      apiFetch<Note>(`/sessions/${enc(sessionKey)}/notes`, { method: "POST", body }),
    onSuccess: (note) => {
      qc.setQueryData(noteKey(note.id), note);
      qc.invalidateQueries({ queryKey: notesKey(sessionKey) });
      qc.invalidateQueries({ queryKey: ["timeline"] });
    },
  });
}

export function useRenameNote(sessionKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name, version }: { id: string; name: string; version: number }) =>
      apiFetch<NoteMeta>(`/notes/${enc(id)}`, { method: "PATCH", body: { name }, version }),
    onSettled: () => qc.invalidateQueries({ queryKey: notesKey(sessionKey) }),
  });
}

export function useDeleteNote(sessionKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) =>
      apiFetch<void>(`/notes/${enc(id)}`, { method: "DELETE", version }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: notesKey(sessionKey) });
      qc.invalidateQueries({ queryKey: ["timeline"] });
    },
  });
}

export function useTimeline(courseId: string | undefined) {
  return useQuery({
    queryKey: ["timeline", courseId],
    queryFn: () => apiFetch<Timeline>(`/courses/${enc(courseId!)}/timeline`),
    enabled: !!courseId,
  });
}

export function fetchWorkspace(sessionKey: string) {
  return apiFetch<WorkspaceState>(`/workspace/${enc(sessionKey)}`);
}

export function putWorkspace(sessionKey: string, state: WorkspaceState, keepalive = false) {
  return apiFetch<WorkspaceState>(`/workspace/${enc(sessionKey)}`, { method: "PUT", body: state, keepalive });
}

export const preferencesKey = ["preferences"] as const;

export function usePreferences() {
  return useQuery({ queryKey: preferencesKey, queryFn: () => apiFetch<Preferences>("/preferences"), staleTime: Infinity });
}

export function useUpdatePreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Preferences) => apiFetch<Preferences>("/preferences", { method: "PATCH", body: patch }),
    onMutate: (patch) => {
      const prev = qc.getQueryData<Preferences>(preferencesKey);
      qc.setQueryData<Preferences>(preferencesKey, { ...prev, ...patch });
    },
    onSuccess: (p) => qc.setQueryData(preferencesKey, p),
  });
}
