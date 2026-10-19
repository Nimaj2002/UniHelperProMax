/**
 * Settings → Trash (feature 009 US4): deleted classes and events, restore and permanent
 * delete. Restoring changes the calendar, course tree and timelines, so those are refreshed.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invalidateSchedule } from "@/features/classes/api";
import { apiFetch, type Schemas } from "@/lib/api";

export type TrashEntry = Schemas["TrashEntryOut"];
export type RestoreResult = Schemas["RestoreResult"];

export const trashKey = ["trash"] as const;

export function useTrash() {
  return useQuery({ queryKey: trashKey, queryFn: () => apiFetch<TrashEntry[]>("/trash") });
}

function refresh(qc: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: trashKey }),
    qc.invalidateQueries({ queryKey: ["timeline"] }),
    invalidateSchedule(qc),
  ]);
}

export function useRestoreEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (e: TrashEntry) => apiFetch<RestoreResult>(`/trash/${encodeURIComponent(e.id)}/restore`, { method: "POST", version: e.version }),
    onSettled: () => refresh(qc),
  });
}

export function usePurgeEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (e: TrashEntry) => apiFetch<void>(`/trash/${encodeURIComponent(e.id)}`, { method: "DELETE", version: e.version }),
    onSettled: () =>
      Promise.all([qc.invalidateQueries({ queryKey: trashKey }), qc.invalidateQueries({ queryKey: ["tasks"] })]),
  });
}
