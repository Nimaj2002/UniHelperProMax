import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { API_BASE, ApiError, apiFetch, readCookie, type Schemas } from "@/lib/api";

export type Recording = Schemas["Recording"];
const enc = encodeURIComponent;

export const recordingsKey = (sessionKey: string) => ["recordings", sessionKey] as const;

export function useRecordings(sessionKey: string) {
  return useQuery({
    queryKey: recordingsKey(sessionKey),
    queryFn: () => apiFetch<Recording[]>(`/sessions/${enc(sessionKey)}/recordings`),
    placeholderData: keepPreviousData,
  });
}

export function startRecording(sessionKey: string, mimeType: "audio/webm" | "audio/mp4") {
  return apiFetch<Recording>(`/sessions/${enc(sessionKey)}/recordings`, { method: "POST", body: { mimeType } });
}

export function fetchActiveRecording() {
  return apiFetch<Recording | null>("/recordings/active");
}

/** Raw upload of one chunk (binary body; apiFetch only sends JSON). */
export async function putChunk(recordingId: string, seq: number, blob: Blob): Promise<{ nextSeq: number; size: number }> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/recordings/${enc(recordingId)}/chunks/${seq}`, {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/octet-stream", "X-CSRF-Token": decodeURIComponent(readCookie("uh_csrf") ?? "") },
      body: blob,
    });
  } catch {
    throw new ApiError(0, "network_error", "Can't reach the server.");
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new ApiError(res.status, String(data.code ?? "http_error"), String(data.title ?? res.statusText), undefined, [], data);
  }
  return data as { nextSeq: number; size: number };
}

export function stopRecording(recordingId: string, body: { interrupted?: boolean; durationMs?: number }) {
  return apiFetch<Recording>(`/recordings/${enc(recordingId)}/stop`, { method: "POST", body });
}

export function renameRecording(id: string, name: string, version: number) {
  return apiFetch<Recording>(`/recordings/${enc(id)}`, { method: "PATCH", body: { name }, version });
}

export function deleteRecording(id: string, version: number) {
  return apiFetch<void>(`/recordings/${enc(id)}`, { method: "DELETE", version });
}

export function audioUrl(id: string, version: number) {
  return `${API_BASE}/recordings/${enc(id)}/audio?v=${version}`;
}
