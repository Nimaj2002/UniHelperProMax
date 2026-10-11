/**
 * Settings → Import and export (feature 010): upload an .ics file for a preview, apply the plan,
 * discard, undo a run, and download the calendar. Applying or undoing changes the calendar,
 * course tree and timelines, so those are refreshed.
 */
import { useQueryClient } from "@tanstack/react-query";
import { invalidateSchedule } from "@/features/classes/api";
import { API_BASE, ApiError, apiFetch, isApiError, type Schemas } from "@/lib/api";
import { uploadFile } from "@/lib/api/upload";

export type ImportPreview = Schemas["ImportPreview"];
export type ImportGroup = Schemas["ImportGroup"];
export type ImportPlan = Schemas["ImportPlan"];
export type GroupPlan = Schemas["GroupPlan"];
export type ImportResult = Schemas["ImportResult"];
export type UndoResult = Schemas["UndoResult"];
export type SkippedItem = Schemas["SkippedItem"];

export const MAX_ICS_BYTES = 5 * 1024 * 1024;

/** contracts/ui-import-export.md § Error message map */
const MESSAGES: Record<string, string> = {
  file_empty: "This file is empty.",
  file_too_large: "This file is larger than 5 MB.",
  not_icalendar: "This isn't a valid calendar (.ics) file.",
  too_many_events: "This file has more than 5,000 events.",
  upload_expired: "This preview expired. Choose the file again.",
  import_failed: "The import failed and nothing was changed. Try again.",
  undo_unavailable: "This import was already undone.",
  network_error: "Can't reach the server. Check your connection and retry.",
};

export function problemMessage(err: unknown, fallback = "Something went wrong. Please retry."): string {
  if (isApiError(err)) return MESSAGES[err.code] ?? err.errors[0]?.message ?? err.title ?? fallback;
  return fallback;
}

export function uploadIcs(file: File, onProgress: (loaded: number, total: number) => void, signal: AbortSignal) {
  return uploadFile<ImportPreview>("/calendar-imports", { fileName: file.name }, file, onProgress, signal);
}

export function discardUpload(uploadId: string) {
  return apiFetch<void>(`/calendar-imports/${encodeURIComponent(uploadId)}`, { method: "DELETE" });
}

export function applyImport(uploadId: string, plan: ImportPlan) {
  return apiFetch<ImportResult>(`/calendar-imports/${encodeURIComponent(uploadId)}/apply`, { method: "POST", body: plan });
}

export function undoImport(runId: string) {
  return apiFetch<UndoResult>(`/calendar-imports/runs/${encodeURIComponent(runId)}/undo`, { method: "POST" });
}

export function useRefreshSchedule() {
  const qc = useQueryClient();
  return () => Promise.all([invalidateSchedule(qc), qc.invalidateQueries({ queryKey: ["timeline"] })]);
}

export interface ExportedFile {
  blob: Blob;
  fileName: string;
  classes: number;
  events: number;
}

function fileNameOf(disposition: string | null): string {
  const match = /filename="([^"]+)"/.exec(disposition ?? "");
  return match?.[1] ?? "UniHelperProMax-calendar.ics";
}

/** `GET /calendar-export` as a file (not JSON); 409 `nothing_to_export` when the scope is empty. */
export async function exportCalendar(semesterId?: string): Promise<ExportedFile> {
  const qs = semesterId ? `?${new URLSearchParams({ semesterId })}` : "";
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/calendar-export${qs}`, { credentials: "same-origin" });
  } catch {
    throw new ApiError(0, "network_error", MESSAGES.network_error);
  }
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { code?: string; title?: string };
    throw new ApiError(response.status, data.code ?? "http_error", data.title ?? response.statusText, undefined, [], data);
  }
  const counts = /classes=(\d+);\s*events=(\d+)/.exec(response.headers.get("X-Export-Counts") ?? "");
  return {
    blob: await response.blob(),
    fileName: fileNameOf(response.headers.get("Content-Disposition")),
    classes: Number(counts?.[1] ?? 0),
    events: Number(counts?.[2] ?? 0),
  };
}

export function saveFile(file: ExportedFile) {
  const url = URL.createObjectURL(file.blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
