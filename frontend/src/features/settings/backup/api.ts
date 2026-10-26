/** 016: /api/v1/backup/* (contracts/backup-api.md). */
import { useQuery } from "@tanstack/react-query";
import { API_BASE, ApiError, apiFetch, isApiError, type Schemas } from "@/lib/api";
import { uploadFile } from "@/lib/api/upload";

export type BackupJob = Schemas["BackupJob"];
export type RestoreSummary = Schemas["RestoreSummary"];
export type SafetyBackup = Schemas["SafetyBackup"];
export type Phase = BackupJob["phase"];

const TERMINAL: ReadonlySet<Phase> = new Set(["ready", "done", "rolled_back", "failed", "cancelled", "expired"]);
export const isTerminal = (phase: Phase) => TERMINAL.has(phase);

export const startExport = () => apiFetch<BackupJob>("/backup/exports", { method: "POST" });
export const getJob = (id: string) => apiFetch<BackupJob>(`/backup/jobs/${encodeURIComponent(id)}`);
export const cancelJob = (id: string) => apiFetch<void>(`/backup/jobs/${encodeURIComponent(id)}`, { method: "DELETE" });
export const confirmRestore = (id: string) =>
  apiFetch<BackupJob>(`/backup/restores/${encodeURIComponent(id)}/confirm`, { method: "POST", body: { confirm: true } });
/** null when there is no safety backup yet (204). */
export const getSafety = async () => (await apiFetch<SafetyBackup | undefined>("/backup/safety")) ?? null;

export const exportFileUrl = (id: string) => `${API_BASE}/backup/exports/${encodeURIComponent(id)}/file`;
export const safetyFileUrl = () => `${API_BASE}/backup/safety/file`;

export function uploadBackup(file: File, onProgress: (loaded: number, total: number) => void, signal: AbortSignal) {
  return uploadFile<BackupJob>("/backup/restores", {}, file, onProgress, signal);
}

/**
 * A plain link, not a blob: the browser streams the file to disk (it can be gigabytes) and the
 * desktop app shows its save dialog (015).
 */
export function download(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Polls a job every 500 ms until it reaches a terminal phase (or waits for confirmation). */
export function useJob(id: string | undefined) {
  return useQuery({
    queryKey: ["backup-job", id],
    queryFn: () => getJob(id as string),
    enabled: !!id,
    refetchInterval: (q) => {
      const phase = q.state.data?.phase;
      return phase && (isTerminal(phase) || phase === "awaiting_confirmation") ? false : 500;
    },
  });
}

export const safetyKey = ["backup-safety"] as const;
export function useSafety() {
  return useQuery({ queryKey: safetyKey, queryFn: getSafety });
}

export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return "";
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} bytes`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** The message for a failed job or request (contracts/backup-api.md error codes). */
export function errorMessage(err: unknown): string {
  const e = err instanceof ApiError ? { code: err.code, title: err.title, detail: err.detail, ...err.problem } : (err as {
    code?: string;
    title?: string;
    detail?: string | null;
    appVersion?: string;
  } | null);
  if (!e) return "Something went wrong. Try again.";
  if (e.code === "backup_too_new") {
    const version = (e as { appVersion?: string }).appVersion;
    return `This backup was made with a newer version${version ? ` (${version})` : ""}. Update UniHelperProMax first.`;
  }
  if (e.code === "not_a_backup") return "This file isn't a UniHelperProMax backup.";
  if (e.code === "backup_damaged") return `This backup is damaged or was modified. ${e.detail ?? "Use another copy of the backup."}`;
  if (isApiError(err, "network_error")) return err.title;
  return [e.title, e.detail].filter(Boolean).join(" ") || "Something went wrong. Try again.";
}
