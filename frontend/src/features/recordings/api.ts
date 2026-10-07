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

/**
 * Import one audio file (006). XMLHttpRequest because fetch has no upload progress; aborting the
 * signal aborts the request, and the server then keeps nothing (research I5).
 */
export function importAudio(
  sessionKey: string,
  file: Blob & { name: string },
  durationMs: number | undefined,
  onProgress: (loaded: number, total: number) => void,
  signal: AbortSignal,
): Promise<Recording> {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({ fileName: file.name });
    if (durationMs !== undefined) params.set("durationMs", String(durationMs));
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/sessions/${enc(sessionKey)}/recordings/import?${params}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.setRequestHeader("Accept", "application/json");
    xhr.setRequestHeader("X-CSRF-Token", decodeURIComponent(readCookie("uh_csrf") ?? ""));
    xhr.upload.onprogress = (e) => onProgress(e.loaded, e.lengthComputable ? e.total : file.size);
    xhr.onload = () => {
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(xhr.responseText || "{}") as Record<string, unknown>;
      } catch {
        /* not JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as unknown as Recording);
      else reject(new ApiError(xhr.status, String(data.code ?? "http_error"), String(data.title ?? xhr.statusText), undefined, [], data));
    };
    xhr.onerror = () => reject(new ApiError(0, "network_error", "Can't reach the server."));
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    if (signal.aborted) {
      reject(new DOMException("Upload cancelled", "AbortError"));
      return;
    }
    signal.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}
