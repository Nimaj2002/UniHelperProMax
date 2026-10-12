/**
 * Saves what the user does with EmbedPDF's annotation tools and puts it back when the PDF opens
 * again, on any device. The PDF on the server is never changed: the annotations live next to it
 * (`<Name>.annotations.json`, key "viewer").
 *
 * - `items`: every annotation made or changed in the app, as EmbedPDF exports it.
 * - `removed`: the PDF's own annotations that were deleted or changed (a changed one is saved
 *   as an item). They are found again by page, type and position: PDFs often don't give their
 *   annotations ids, and EmbedPDF then makes up new ones on every load.
 */
import { AnnotationPlugin, type AnnotationTransferItem, type PdfAnnotationObject, type PluginRegistry } from "@embedpdf/react-pdf-viewer";
import { fetchViewerAnnotations, saveViewerAnnotations, type ViewerAnnotations } from "../api";

const SAVE_DELAY = 800;
const RETRY_DELAY = 5000;

/** The last save of each document, so a reopened viewer reads what was just saved. */
const pendingSaves = new Map<string, Promise<unknown>>();

// ---- JSON-safe encoding (dates and binary data, e.g. stamp images) ------------------------------

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string): ArrayBuffer {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes.buffer;
}

function encode(v: unknown): unknown {
  if (v instanceof Date) return { $date: v.toISOString() };
  if (v instanceof ArrayBuffer) return { $bytes: toBase64(new Uint8Array(v)) };
  if (ArrayBuffer.isView(v)) return { $bytes: toBase64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
  if (Array.isArray(v)) return v.map(encode);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)]));
  return v;
}

function decode(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(decode);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.$date === "string" && Object.keys(o).length === 1) return new Date(o.$date);
    if (typeof o.$bytes === "string" && Object.keys(o).length === 1) return fromBase64(o.$bytes);
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, decode(x)]));
  }
  return v;
}

/** One of the PDF's own annotations, recognisable on the next load. */
function fingerprint(a: PdfAnnotationObject): string {
  const r = a.rect;
  const n = (x: number) => Math.round(x * 10) / 10;
  return `${a.pageIndex}|${a.type}|${n(r.origin.x)},${n(r.origin.y)},${n(r.size.width)},${n(r.size.height)}`;
}

/**
 * Keeps the viewer's annotations of `documentId` (our document id) saved. Returns a function that
 * stops it, sending a pending change first.
 */
export function syncViewerAnnotations(registry: PluginRegistry, documentId: string): () => void {
  const plugin = registry.getPlugin<AnnotationPlugin>(AnnotationPlugin.id);
  const cap = plugin?.provides();
  if (!plugin || !cap) return () => {};

  const saved = (pendingSaves.get(documentId) ?? Promise.resolve())
    .catch(() => {})
    .then(() => fetchViewerAnnotations(documentId));
  /** The PDF's own annotations still as they came: id → fingerprint. */
  const originals = new Map<string, string>();
  const removed = new Set<string>();
  let viewerDoc: string | null = null;
  /** loading: waiting for the saved set; restoring: putting it back; ready: saving changes. */
  let phase: "loading" | "restoring" | "ready" | "off" = "loading";
  /** The user changed something before saving started: saved once it does. */
  let dirty = false;
  let stopped = false;
  let timer = 0;

  const save = async () => {
    window.clearTimeout(timer);
    timer = 0;
    if (phase !== "ready" || !viewerDoc) return;
    const exported = await cap.forDocument(viewerDoc).exportAnnotations().toPromise();
    const body: ViewerAnnotations = {
      items: exported.filter((it) => !originals.has(it.annotation.id)).map((it) => encode(it) as Record<string, unknown>),
      removed: [...removed],
    };
    const request = saveViewerAnnotations(documentId, body);
    pendingSaves.set(documentId, request);
    try {
      await request;
    } catch {
      if (!stopped) timer = window.setTimeout(() => void save(), RETRY_DELAY); // offline: try again
    }
  };
  const schedule = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void save(), SAVE_DELAY);
  };

  const restore = async (docId: string) => {
    viewerDoc = docId;
    const scope = cap.forDocument(docId);
    // the PDF's own annotations, taken now: anything made from here on is the user's
    const byPrint = new Map<string, PdfAnnotationObject[]>();
    for (const t of scope.getAnnotations()) {
      const fp = fingerprint(t.object);
      byPrint.set(fp, [...(byPrint.get(fp) ?? []), t.object]);
      originals.set(t.object.id, fp);
    }
    let data: ViewerAnnotations;
    try {
      data = await saved;
    } catch {
      // without the saved set, saving would overwrite it with this partial one
      phase = "off";
      console.warn("The PDF's saved annotations couldn't be loaded; changes won't be saved this time.");
      return;
    }
    if (stopped) return;
    phase = "restoring";
    const gone: { pageIndex: number; id: string }[] = [];
    for (const fp of data.removed) {
      removed.add(fp);
      const a = byPrint.get(fp)?.shift();
      if (a && originals.has(a.id)) {
        originals.delete(a.id);
        gone.push({ pageIndex: a.pageIndex, id: a.id });
      }
    }
    if (gone.length) scope.deleteAnnotations(gone);
    const goneIds = new Set(gone.map((g) => g.id));
    const items = data.items.map((raw) => {
      const it = decode(raw) as AnnotationTransferItem;
      // a changed original that keeps its id in the PDF: the saved copy gets its own
      if (goneIds.has(it.annotation.id) || originals.has(it.annotation.id)) it.annotation = { ...it.annotation, id: crypto.randomUUID() };
      return it;
    });
    if (items.length) scope.importAnnotations(items);
    // events from restoring settle first; only the user's changes are saved
    window.setTimeout(() => {
      if (stopped) return;
      phase = "ready";
      if (dirty) schedule();
    }, 0);
  };

  const off = cap.onAnnotationEvent((e) => {
    if (e.type === "loaded") {
      if (!viewerDoc) void restore(e.documentId);
      return;
    }
    if (e.documentId !== viewerDoc || phase === "restoring" || phase === "off") return;
    const fp = originals.get(e.annotation.id);
    if (fp) {
      originals.delete(e.annotation.id);
      removed.add(fp);
    }
    dirty = true;
    if (phase === "ready") schedule();
  });
  // a small PDF can finish loading its annotations before this listens: catch up
  const loaded = (plugin as unknown as { isInitialLoadComplete?: Map<string, boolean> }).isInitialLoadComplete;
  for (const [docId, done] of loaded ?? []) if (done && !viewerDoc) void restore(docId);
  const onHide = () => {
    if (timer) void save();
  };
  window.addEventListener("pagehide", onHide);

  return () => {
    off();
    window.removeEventListener("pagehide", onHide);
    if (timer) void save();
    stopped = true;
  };
}
