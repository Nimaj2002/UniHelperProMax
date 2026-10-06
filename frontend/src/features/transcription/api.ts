import { useQuery } from "@tanstack/react-query";
import { apiFetch, type Schemas } from "@/lib/api";

export type TranscriptionJob = Schemas["TranscriptionJob"];
export type TranscriptionStatus = Schemas["TranscriptionStatus"];
const enc = encodeURIComponent;

export const ACTIVE_STATUSES = ["queued", "uploading", "transcribing", "appending"] as const;
export const isActive = (j: TranscriptionJob) => (ACTIVE_STATUSES as readonly string[]).includes(j.status);

export const activeKey = ["transcriptions", "active"] as const;
export const statusKey = ["transcription", "status"] as const;
export const historyKey = (sessionKey: string) => ["transcriptions", "session", sessionKey] as const;

/** Polled every 2 s while a job runs (SC-005); refreshed on window focus otherwise. */
export function useActiveTranscription() {
  return useQuery({
    queryKey: activeKey,
    queryFn: () => apiFetch<TranscriptionJob | null>("/transcriptions/active"),
    refetchInterval: (q) => (q.state.data ? 2000 : false),
    refetchOnWindowFocus: true,
  });
}

export function useTranscriptionStatus(enabled = true) {
  return useQuery({ queryKey: statusKey, queryFn: () => apiFetch<TranscriptionStatus>("/transcription/status"), enabled });
}

export function useSessionTranscriptions(sessionKey: string) {
  return useQuery({
    queryKey: historyKey(sessionKey),
    queryFn: () => apiFetch<TranscriptionJob[]>(`/sessions/${enc(sessionKey)}/transcriptions`),
  });
}

export function startTranscription(recordingId: string, body: { noteId?: string; newNoteName?: string; language?: string }) {
  return apiFetch<TranscriptionJob>(`/recordings/${enc(recordingId)}/transcriptions`, { method: "POST", body });
}

export const fetchJob = (id: string) => apiFetch<TranscriptionJob>(`/transcriptions/${enc(id)}`);
export const fetchUnseen = () => apiFetch<TranscriptionJob[]>("/transcriptions?unseen=true");
export const cancelTranscription = (id: string) => apiFetch<TranscriptionJob>(`/transcriptions/${enc(id)}/cancel`, { method: "POST" });
export const retryTranscription = (id: string) => apiFetch<TranscriptionJob>(`/transcriptions/${enc(id)}/retry`, { method: "POST" });
export const markSeen = (id: string) => apiFetch<void>(`/transcriptions/${enc(id)}/seen`, { method: "POST" });

export const SETTINGS_PATH = "/settings/transcription";
