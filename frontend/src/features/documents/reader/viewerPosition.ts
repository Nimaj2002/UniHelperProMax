/**
 * Reading position (007 FR-019, research R12): the viewer opens at the user's last page
 * (`min(page, totalPages)`) once its pages are laid out, and saves the page while the user reads
 * (1 s after it settles) and when the viewer closes or the browser leaves.
 */
import { ScrollPlugin, type PluginRegistry } from "@embedpdf/react-pdf-viewer";
import { fetchPosition, savePosition } from "../api";
import { DOC_ATTACH, DOC_DETACH } from "./events";

const SAVE_DELAY = 1000;

/** The last page seen per document, so a rebuilt viewer (theme change) doesn't race its own save. */
const lastSeen = new Map<string, number>();

/**
 * Keeps the viewer's page of `documentId` (our document id) saved. `host` is the tab's
 * `[data-doc-host]` element: moving it between panes resets its scroll, so the page is put back
 * on DOC_ATTACH. Returns a function that stops it.
 */
export function syncViewerPosition(registry: PluginRegistry, documentId: string, host: EventTarget | null): () => void {
  const cap = registry.getPlugin<ScrollPlugin>(ScrollPlugin.id)?.provides();
  if (!cap) return () => {};

  const remembered = lastSeen.has(documentId)
    ? Promise.resolve(lastSeen.get(documentId) ?? null)
    : fetchPosition(documentId).then(
        (p) => p.page,
        () => null,
      );
  let viewerDoc: string | null = null;
  let lastSaved: number | null = null;
  let pending: number | null = null;
  let stopped = false;
  let parked = false;
  let current: number | null = null;
  let timer = 0;

  const flush = (keepalive = false) => {
    window.clearTimeout(timer);
    const p = pending;
    pending = null;
    if (p === null || p === lastSaved) return;
    lastSaved = p;
    void savePosition(documentId, p, keepalive).catch(() => {});
  };

  const restore = async (docId: string, totalPages: number) => {
    viewerDoc = docId;
    const page = await remembered;
    if (stopped) return;
    lastSaved = page;
    current = page;
    if (page && page > 1) cap.forDocument(docId).scrollToPage({ pageNumber: Math.min(page, totalPages), behavior: "instant" });
  };

  const offReady = cap.onLayoutReady((e) => {
    if (e.isInitial && !viewerDoc) void restore(e.documentId, e.totalPages);
  });
  const offPage = cap.onPageChange((e) => {
    // while parked the reset scroll reports page 1; ignore it
    if (e.documentId !== viewerDoc || stopped || parked) return;
    current = e.pageNumber;
    lastSeen.set(documentId, e.pageNumber);
    pending = e.pageNumber;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => flush(), SAVE_DELAY);
  });
  const onHide = () => flush(true);
  window.addEventListener("pagehide", onHide);
  const onDetach = () => {
    parked = true;
  };
  let frame = 0;
  const onAttach = () => {
    // wait a frame so the viewport has its size again before scrolling
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (viewerDoc && current && current > 1) cap.forDocument(viewerDoc).scrollToPage({ pageNumber: current, behavior: "instant" });
      parked = false;
    });
  };
  host?.addEventListener(DOC_DETACH, onDetach);
  host?.addEventListener(DOC_ATTACH, onAttach);

  return () => {
    stopped = true;
    offReady();
    offPage();
    window.removeEventListener("pagehide", onHide);
    host?.removeEventListener(DOC_DETACH, onDetach);
    host?.removeEventListener(DOC_ATTACH, onAttach);
    cancelAnimationFrame(frame);
    flush(true);
  };
}
