import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { API_BASE, apiFetch, type Schemas } from "@/lib/api";
import { uploadFile } from "@/lib/api/upload";
import type { Annotation, AnnotationOp, OpResult } from "./reader/annotations/types";

export type Document = Schemas["Document"];
const enc = encodeURIComponent;

export const documentsKey = (sessionKey: string) => ["documents", sessionKey] as const;
/** Every session's document list: a document is listed by all sessions of its course. */
export const allDocumentsKey = ["documents"] as const;
export const documentKey = (id: string) => ["document", id] as const;

export function useDocuments(sessionKey: string) {
  return useQuery({
    queryKey: documentsKey(sessionKey),
    queryFn: () => apiFetch<Document[]>(`/sessions/${enc(sessionKey)}/documents`),
    placeholderData: keepPreviousData,
  });
}

export function useDocument(id: string) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: documentKey(id),
    queryFn: () => apiFetch<Document>(`/documents/${enc(id)}`),
    // the session's list usually has it already: open the reader without waiting for a request
    initialData: () =>
      qc
        .getQueriesData<Document[]>({ queryKey: ["documents"] })
        .flatMap(([, list]) => list ?? [])
        .find((d) => d.id === id),
    initialDataUpdatedAt: 0,
  });
}

/** Load the reader's code ahead of the first document tab (research R14: it stays a lazy chunk). */
export function prefetchReader() {
  const load = () => {
    void import("./reader/PdfReader");
  };
  if ("requestIdleCallback" in window) window.requestIdleCallback(load, { timeout: 1000 });
  else setTimeout(load, 500);
}

/** Upload one PDF (007 FR-002–FR-008): stored unchanged in the session's documents/ folder and
 * listed by every session of the course. */
export function importDocument(
  sessionKey: string,
  file: Blob & { name: string },
  _durationMs: number | undefined,
  onProgress: (loaded: number, total: number) => void,
  signal: AbortSignal,
): Promise<Document> {
  return uploadFile<Document>(`/sessions/${enc(sessionKey)}/documents/import`, { fileName: file.name }, file, onProgress, signal);
}

export function documentFileUrl(id: string) {
  return `${API_BASE}/documents/${enc(id)}/file`;
}

/** The reader reports the page count on first open (007 data-model: `pageCount`). */
export function setPageCount(id: string, version: number, pageCount: number) {
  return apiFetch<Document>(`/documents/${enc(id)}`, { method: "PATCH", body: { pageCount }, version });
}

/** The user's last page in a document (007 FR-019); `null` when never opened. */
export function fetchPosition(id: string) {
  return apiFetch<{ page: number | null }>(`/documents/${enc(id)}/position`);
}

export function savePosition(id: string, page: number, keepalive = false) {
  return apiFetch<{ page: number }>(`/documents/${enc(id)}/position`, { method: "PUT", body: { page }, keepalive });
}

/** The PDF viewer's (EmbedPDF) annotations, as the viewer exports them (JSON-safe encoded). */
export interface ViewerAnnotations {
  items: Record<string, unknown>[];
  /** The PDF's own annotations taken away, by page, type and position. */
  removed: string[];
}

export function fetchViewerAnnotations(id: string) {
  return apiFetch<ViewerAnnotations>(`/documents/${enc(id)}/viewer-annotations`);
}

export function saveViewerAnnotations(id: string, body: ViewerAnnotations) {
  return apiFetch<ViewerAnnotations>(`/documents/${enc(id)}/viewer-annotations`, { method: "PUT", body });
}

export function fetchAnnotations(id: string) {
  return apiFetch<{ annotations: Annotation[] }>(`/documents/${enc(id)}/annotations`);
}

/** One batch of annotation operations (007 research R7): merged per annotation, idempotent by opId. */
export function postAnnotationOps(id: string, ops: AnnotationOp[], keepalive = false) {
  return apiFetch<{ results: OpResult[]; notice: string | null }>(`/documents/${enc(id)}/annotations/ops`, {
    method: "POST",
    body: { ops },
    keepalive,
  });
}

export function renameDocument(id: string, version: number, name: string) {
  return apiFetch<Document>(`/documents/${enc(id)}`, { method: "PATCH", body: { name }, version });
}

/** Deletes the PDF and its annotation sidecar (007 FR-010). */
export function deleteDocument(id: string, version: number) {
  return apiFetch<void>(`/documents/${enc(id)}`, { method: "DELETE", version });
}
