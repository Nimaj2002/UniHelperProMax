/**
 * 024: PDFs — read and annotate (contracts/demo-mode.md §2 "Documents"). A session lists the PDFs
 * of its course (or event series), minus those hidden in it or an earlier session, like the real
 * API (017). The file is the bundled sample PDF, loaded lazily so it stays out of the startup chunk.
 */
import { http, type HttpHandler } from "msw";
import type { Schemas } from "@/lib/api";
import { getSession, parseKey } from "../calendar";
import { API, checkIfMatch, json, noContent, notFound, problem, readJson, type Body, type Res } from "../http";
import { IDS, pastKeys } from "../seed";
import { bump, newId, nowIso, registerSlice } from "../store";
import { attachedTo, cleanName, nameTaken, uniqueFileName } from "./notes";

type Annotation = Schemas["Annotation"];
type ViewerAnnotations = Res<"/api/v1/documents/{document_id}/viewer-annotations", "get">;

interface DemoDocument {
  doc: Omit<Schemas["Document"], "annotationCount">;
  annotations: Annotation[];
  viewer: { items: Record<string, unknown>[]; removed: string[] };
  page: number | null;
}

let docs: DemoDocument[] = [];
/** "Remove from this session": `{ key, docId }` hides it there and in later sessions of the scope. */
let hides: { key: string; docId: string }[] = [];

/** Bytes of the bundled PDF, decoded from the lazily imported data URL (works in Node too). */
export async function loadAsset(load: () => Promise<{ default: string }>): Promise<Uint8Array<ArrayBuffer>> {
  const { default: url } = await load();
  const bin = atob(url.slice(url.indexOf(",") + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
let pdf: Promise<Uint8Array<ArrayBuffer>> | null = null;
const pdfBytes = () => (pdf ??= loadAsset(() => import("../assets/lecture-week3.pdf?inline")));

/** A course's sessions share PDFs; an event series' sessions share theirs. */
function scopeOf(key: string): string | null {
  const s = getSession(key);
  return s ? (s.courseId ?? `lineage:${s.lineageId}`) : null;
}

const dateOf = (key: string) => parseKey(key)?.date ?? "";

function hiddenIn(d: DemoDocument, key: string): boolean {
  if (d.doc.sessionKey === key) return false; // never the PDFs uploaded to this session
  const scope = scopeOf(key);
  return hides.some((h) => h.docId === d.doc.id && scopeOf(h.key) === scope && dateOf(h.key) <= dateOf(key));
}

const inScope = (key: string) => {
  const scope = scopeOf(key);
  return docs.filter((d) => scope !== null && scopeOf(d.doc.sessionKey) === scope);
};

function view(d: DemoDocument): Schemas["Document"] {
  return { ...d.doc, annotationCount: d.annotations.length + d.viewer.items.length };
}

const newest = (a: DemoDocument, b: DemoDocument) => b.doc.uploadedAt.localeCompare(a.doc.uploadedAt);
const find = (id: string) => docs.find((d) => d.doc.id === id);

function notOwning(d: DemoDocument, request: Request, message: string): Response | null {
  const from = new URL(request.url).searchParams.get("fromSession");
  return from !== null && from !== d.doc.sessionKey ? problem(409, "not_owning_session", message) : null;
}

/** An annotation as stored: server fields set (backend domain/annotations.py `_stamp`). */
function stamp(a: Annotation, rev: number, createdAt: string, now: string): Annotation {
  return { ...a, rev, createdAt, updatedAt: now };
}

/** As the API returns it: no nulls. */
function apiView(a: Annotation | undefined): Annotation | undefined {
  if (!a) return undefined;
  const out = Object.fromEntries(Object.entries(a).filter(([, v]) => v !== null && v !== undefined));
  return out as Annotation;
}

// ---------- seed ----------

const PDF_SIZE = 3729; // bytes of assets/lecture-week3.pdf

/** Stored sample data, not UI styling: EmbedPDF's default highlight colour, as the reader saves it. */
const HIGHLIGHT = "#FFCD45";

/** EmbedPDF highlight items (as viewerAnnotations.ts saves them) over lines of the sample PDF. */
function highlight(id: string, pageIndex: number, x: number, y: number, width: number, contents: string, at: string): Record<string, unknown> {
  const rect = { origin: { x, y }, size: { width, height: 15 } };
  return {
    annotation: {
      id,
      type: 9, // PdfAnnotationSubtype.HIGHLIGHT
      pageIndex,
      rect,
      segmentRects: [rect],
      color: HIGHLIGHT,
      strokeColor: HIGHLIGHT,
      opacity: 1,
      blendMode: 1, // PdfBlendMode.Multiply
      author: "demo-student",
      contents,
      created: { $date: at },
      modified: { $date: at },
    },
  };
}

function seed() {
  docs = [];
  hides = [];
  const key = pastKeys(IDS.algoLineage)[0];
  const session = key ? getSession(key) : null;
  if (!key || !session) return;
  const at = session.start;
  const atUtc = new Date(at).toISOString();
  docs.push({
    doc: {
      id: "doc-week3",
      sessionKey: key,
      name: "Week 3 – Divide and Conquer",
      fileName: "Week 3 - Divide and Conquer.pdf",
      originalFileName: "lecture-week3.pdf",
      size: PDF_SIZE,
      encrypted: false,
      pageCount: 4,
      uploadedAt: at,
      missing: false,
      version: 1,
    },
    annotations: [],
    viewer: {
      items: [
        highlight("hl-combine", 0, 63, 369, 351.48, "The step people forget: combining is where the real work happens in merge sort.", atUtc),
        highlight("hl-recurrence", 1, 63, 252, 282.1, "Memorise this recurrence.", atUtc),
        highlight("hl-case2", 3, 63, 167, 370.75, "Case 2 — merge sort and binary search both land here.", atUtc),
      ],
      removed: [],
    },
    page: null,
  });
}

registerSlice({
  name: "documents",
  seed,
  removeSessions: (keys, lineageIds) => {
    docs = docs.filter((d) => !attachedTo(d.doc.sessionKey, keys, lineageIds));
    hides = hides.filter((h) => !attachedTo(h.key, keys, lineageIds));
  },
  count: (keys, lineageIds) => ({ documents: docs.filter((d) => attachedTo(d.doc.sessionKey, keys, lineageIds)).length }),
  snapshot: (lineageIds) => {
    const keptDocs = docs.filter((d) => attachedTo(d.doc.sessionKey, new Set(), lineageIds));
    const keptHides = hides.filter((h) => attachedTo(h.key, new Set(), lineageIds));
    return () => {
      docs.push(...keptDocs.filter((d) => !docs.includes(d)));
      hides.push(...keptHides.filter((h) => !hides.includes(h)));
    };
  },
});

// ---------- handlers ----------

export const handlers: HttpHandler[] = [
  http.get(`${API}/sessions/:key/documents`, ({ params }) => {
    const key = String(params.key);
    if (!getSession(key)) return notFound("Session");
    return json(inScope(key).filter((d) => !hiddenIn(d, key)).sort(newest).map(view));
  }),
  http.get(`${API}/sessions/:key/documents/hidden`, ({ params }) => {
    const key = String(params.key);
    if (!getSession(key)) return notFound("Session");
    return json(inScope(key).filter((d) => hiddenIn(d, key)).sort(newest).map(view));
  }),
  http.put(`${API}/sessions/:key/documents/:id/hidden`, ({ params }) => {
    const key = String(params.key);
    const d = inScope(key).find((x) => x.doc.id === params.id);
    if (!d) return notFound("Document");
    if (d.doc.sessionKey === key) return problem(409, "own_session", "This PDF was uploaded to this session; delete it instead.");
    if (!hides.some((h) => h.key === key && h.docId === d.doc.id)) hides.push({ key, docId: d.doc.id });
    return noContent();
  }),
  http.delete(`${API}/sessions/:key/documents/:id/hidden`, ({ params }) => {
    const key = String(params.key);
    const d = inScope(key).find((x) => x.doc.id === params.id);
    if (!d) return notFound("Document");
    const scope = scopeOf(key);
    hides = hides.filter((h) => !(h.docId === d.doc.id && scopeOf(h.key) === scope && dateOf(h.key) <= dateOf(key)));
    return noContent();
  }),
  http.get(`${API}/documents/:id`, ({ params }) => {
    const d = find(String(params.id));
    return d ? json(view(d)) : notFound("Document");
  }),
  http.patch(`${API}/documents/:id`, async ({ request, params }) => {
    const d = find(String(params.id));
    if (!d) return notFound("Document");
    const body = await readJson<Body<"/api/v1/documents/{document_id}", "patch">>(request);
    if (body.name !== undefined && body.name !== null) {
      const refused = notOwning(d, request, "Rename this PDF in the session it was uploaded to.") ?? checkIfMatch(request, d.doc);
      if (refused) return refused;
      const name = cleanName(body.name, "PDF");
      if (name instanceof Response) return name;
      const scope = scopeOf(d.doc.sessionKey);
      if (docs.some((x) => x !== d && scopeOf(x.doc.sessionKey) === scope && x.doc.name.toLowerCase() === name.toLowerCase())) {
        return nameTaken("A PDF with this name already exists in this course.");
      }
      const siblings = docs.filter((x) => x !== d && x.doc.sessionKey === d.doc.sessionKey).map((x) => x.doc.fileName);
      d.doc.name = name;
      d.doc.fileName = uniqueFileName(name, ".pdf", siblings);
      bump(d.doc);
    } else if (typeof body.pageCount === "number") {
      const stale = checkIfMatch(request, d.doc);
      if (stale) return stale;
      d.doc.pageCount = body.pageCount; // no version bump: nothing the user did (backend set_page_count)
    }
    return json(view(d));
  }),
  http.delete(`${API}/documents/:id`, ({ request, params }) => {
    const d = find(String(params.id));
    if (!d) return notFound("Document");
    const refused =
      notOwning(d, request, "This PDF belongs to another session. Remove it from this session instead, or delete it in the session it was uploaded to.") ??
      checkIfMatch(request, d.doc);
    if (refused) return refused;
    docs = docs.filter((x) => x !== d);
    hides = hides.filter((h) => h.docId !== d.doc.id);
    return noContent();
  }),
  http.get(`${API}/documents/:id/file`, async ({ params }) => {
    const d = find(String(params.id));
    if (!d) return notFound("Document");
    return new Response(await pdfBytes(), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${encodeURIComponent(d.doc.fileName)}"` },
    });
  }),
  http.get(`${API}/documents/:id/position`, ({ params }) => {
    const d = find(String(params.id));
    return d ? json({ page: d.page }) : notFound("Document");
  }),
  http.put(`${API}/documents/:id/position`, async ({ request, params }) => {
    const d = find(String(params.id));
    if (!d) return notFound("Document");
    const body = await readJson<Body<"/api/v1/documents/{document_id}/position", "put">>(request);
    d.page = Math.max(1, Math.trunc(Number(body.page) || 1));
    return json({ page: d.page });
  }),
  http.get(`${API}/documents/:id/annotations`, ({ params }) => {
    const d = find(String(params.id));
    return d ? json({ annotations: d.annotations.map(apiView) }) : notFound("Document");
  }),
  // per-annotation merge, port of backend domain/annotations.py `apply_ops`
  http.post(`${API}/documents/:id/annotations/ops`, async ({ request, params }) => {
    const d = find(String(params.id));
    if (!d) return notFound("Document");
    const body = await readJson<Body<"/api/v1/documents/{document_id}/annotations/ops", "post">>(request);
    const now = nowIso();
    const results: Res<"/api/v1/documents/{document_id}/annotations/ops", "post">["results"] = [];
    for (const op of body.ops ?? []) {
      if (op.kind === "upsert" && op.annotation) {
        const incoming = op.annotation;
        const i = d.annotations.findIndex((a) => a.id === incoming.id);
        if (i < 0) {
          const created = stamp(incoming, 1, now, now);
          d.annotations.push(created);
          results.push({ opId: op.opId, status: "ok", annotation: apiView(created) });
        } else if ((op.baseRev ?? null) === (d.annotations[i].rev ?? null)) {
          const stored = d.annotations[i];
          const merged = { ...stored, ...stamp(incoming, (stored.rev ?? 0) + 1, stored.createdAt ?? now, now) };
          d.annotations[i] = merged;
          results.push({ opId: op.opId, status: "ok", annotation: apiView(merged) });
        } else {
          const copy = stamp({ ...incoming, id: newId("ann"), conflictOf: incoming.id }, 1, now, now);
          d.annotations.push(copy);
          results.push({ opId: op.opId, status: "kept_both", annotation: apiView(d.annotations[i]), copy: apiView(copy) });
        }
      } else if (op.kind === "delete") {
        const i = d.annotations.findIndex((a) => a.id === op.id);
        if (i < 0) results.push({ opId: op.opId, status: "ok" });
        else if ((op.baseRev ?? null) === (d.annotations[i].rev ?? null)) {
          d.annotations.splice(i, 1);
          results.push({ opId: op.opId, status: "ok" });
        } else results.push({ opId: op.opId, status: "kept_changed", annotation: apiView(d.annotations[i]) });
      }
    }
    return json({ results, notice: null });
  }),
  http.get(`${API}/documents/:id/viewer-annotations`, ({ params }) => {
    const d = find(String(params.id));
    return d ? json<ViewerAnnotations>(d.viewer) : notFound("Document");
  }),
  http.put(`${API}/documents/:id/viewer-annotations`, async ({ request, params }) => {
    const d = find(String(params.id));
    if (!d) return notFound("Document");
    const body = await readJson<Body<"/api/v1/documents/{document_id}/viewer-annotations", "put">>(request);
    d.viewer = { items: body.items ?? [], removed: body.removed ?? [] };
    return json<ViewerAnnotations>(d.viewer);
  }),
];
