/**
 * Raw file upload with progress and cancel (006 audio, 007 PDFs). XMLHttpRequest because fetch
 * has no upload progress; aborting the signal aborts the request, and the server then keeps
 * nothing (006 research I5).
 */
import { API_BASE, ApiError, readCookie } from "./client";

export function uploadFile<T>(
  path: string,
  query: Record<string, string>,
  file: Blob & { name?: string },
  onProgress: (loaded: number, total: number) => void,
  signal: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}${path}?${new URLSearchParams(query)}`);
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
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as T);
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
