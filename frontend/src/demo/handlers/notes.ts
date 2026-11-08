/**
 * 024: notes, general notes, note search and the per-session workspace (contracts/demo-mode.md
 * §2 "Notes"). Saves follow the real API: `If-Match` version check, then the `baseHash` check,
 * then the version is bumped and the new SHA-256 returned.
 */
import { http, type HttpHandler } from "msw";
import type { Schemas } from "@/lib/api";
import { getSession, parseKey } from "../calendar";
import { LECTURE_DURATION_MS, LECTURE_NOTE_ID, LECTURE_RECORDING_NAME, transcriptSection } from "../canned/lecture";
import { API, checkIfMatch, json, noContent, notFound, problem, readJson, validation, type Body, type Res } from "../http";
import { IDS, pastKeys } from "../seed";
import { bump, getStore, newId, nowIso, registerSlice } from "../store";

export interface DemoNote {
  id: string;
  sessionKey: string | null; // null = a general note
  name: string;
  fileName: string;
  version: number;
  content: string;
  createdAt: string;
  updatedAt: string;
}

let notes: DemoNote[] = [];
let workspaces: Record<string, Schemas["WorkspaceState"]> = {};

const utf8 = new TextEncoder();

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", utf8.encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const findNote = (id: string) => notes.find((n) => n.id === id);

/** Whether an item on session `key` belongs to these sessions or lineages (cascades, counts). */
export function attachedTo(key: string | null, keys: Set<string>, lineageIds: Set<string>): boolean {
  return !!key && (keys.has(key) || lineageIds.has(parseKey(key)?.lineageId ?? ""));
}

export function noteMeta(n: DemoNote): Schemas["NoteMeta"] {
  const { id, sessionKey, name, fileName, version, createdAt, updatedAt } = n;
  return { id, sessionKey, name, fileName, version, size: utf8.encode(n.content).length, createdAt, updatedAt };
}

async function noteOut(n: DemoNote): Promise<Schemas["Note"]> {
  return { ...noteMeta(n), content: n.content, hash: await sha256(n.content), missing: false };
}

export function cleanName(raw: unknown, what = "note"): string | Response {
  const name = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  if (!name) return validation("name", `Enter a name for the ${what}.`, "name_required");
  if (name.length > 120) return validation("name", "Use at most 120 characters.", "name_too_long");
  return name;
}

export function nameTaken(message: string): Response {
  return problem(409, "name_taken", message, undefined, [{ field: "/name", code: "name_taken", message }]);
}

/** `<safe name><ext>`, made unique among the siblings like the backend's unique_sibling. */
export function uniqueFileName(name: string, ext: string, siblings: string[]): string {
  const safe = name.replace(/[\\/:*?"<>|]/g, "-").trim() || "Untitled";
  const taken = new Set(siblings.map((s) => s.toLowerCase()));
  let file = `${safe}${ext}`;
  for (let i = 2; taken.has(file.toLowerCase()); i++) file = `${safe} (${i})${ext}`;
  return file;
}

/** Create a note on a session (or a general note); a Response when the name is refused. */
export function createNote(sessionKey: string | null, rawName: unknown, content = ""): DemoNote | Response {
  const name = cleanName(rawName);
  if (name instanceof Response) return name;
  const siblings = notes.filter((n) => n.sessionKey === sessionKey);
  if (siblings.some((n) => n.name.toLowerCase() === name.toLowerCase())) {
    return nameTaken(sessionKey ? "A note with this name already exists in this session." : "A general note with this name already exists.");
  }
  const now = nowIso();
  const note: DemoNote = {
    id: newId("note"),
    sessionKey,
    name,
    fileName: uniqueFileName(name, ".md", siblings.map((n) => n.fileName)),
    version: 1,
    content,
    createdAt: now,
    updatedAt: now,
  };
  notes.push(note);
  return note;
}

/** Separator so the existing last character is never changed (backend domain/transcript.py). */
function separatorFor(existing: string): string {
  if (!existing || existing.endsWith("\n\n")) return "";
  return existing.endsWith("\n") ? "\n" : "\n\n";
}

/** Append a section after the note's last character — the only way text is added (Principle I). */
export async function appendToNote(n: DemoNote, section: string): Promise<Schemas["unihelper__schemas__transcription__AppendResult"]> {
  const previousHash = await sha256(n.content);
  const text = separatorFor(n.content) + section;
  n.content += text;
  n.updatedAt = nowIso();
  bump(n);
  return { text, previousHash, hash: await sha256(n.content), version: n.version };
}

function conflictBody(n: DemoNote, hash: string) {
  return { current: { version: n.version, hash, content: n.content } };
}

function sessionLabel(key: string): string {
  const s = getSession(key);
  if (!s) return key;
  const day = new Date(`${s.date}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" });
  return `${s.kind === "event" ? (s.title ?? "Event") : (s.courseName ?? "Class")} · ${day.replace(",", "")}`;
}

function workspaceView(key: string): Schemas["WorkspaceState"] {
  const st = workspaces[key];
  const tabs = (st?.tabs ?? []).filter((t) => t.kind !== "note" || findNote(t.id)?.sessionKey === key);
  const has = (t: Schemas["TabRef"] | null | undefined) => (t && tabs.some((x) => x.kind === t.kind && x.id === t.id) ? t : null);
  const active = has(st?.active) ?? tabs[0] ?? null;
  let split = st?.split ?? null;
  if (split) split = { ...split, enabled: split.enabled && !!has(split.left) && !!has(split.right), left: has(split.left), right: has(split.right) };
  return {
    openNoteIds: tabs.filter((t) => t.kind === "note").map((t) => t.id),
    activeNoteId: active?.kind === "note" ? active.id : null,
    tabs,
    active,
    split,
  };
}

// ---------- seed ----------

const ALGO_LATEST = `# Divide and Conquer

Week 3 — slides: *Intro to Algorithms, Week 3* (PDF in this session).

## The pattern

1. **Divide** the problem into smaller instances of the same problem
2. **Conquer** each one recursively
3. **Combine** the partial answers

\`\`\`mermaid
flowchart TD
  A["sort 8 items"] --> B["sort 4"]
  A --> C["sort 4"]
  B --> D["merge"]
  C --> D
  D --> E["sorted 8 items"]
\`\`\`

## Merge sort

- Merge walks both halves once: $\\Theta(n)$
- Recurrence: $T(n) = 2\\,T(n/2) + \\Theta(n)$
- Stable, but needs $\\Theta(n)$ extra memory

$$
T(n) = \\sum_{i=0}^{\\log_2 n} c\\,n = \\Theta(n \\log n)
$$

## Master theorem cheat sheet

| Recurrence | $a$ | $b$ | Case | Result |
| --- | --- | --- | --- | --- |
| Merge sort | 2 | 2 | 2 | $\\Theta(n \\log n)$ |
| Binary search | 1 | 2 | 2 | $\\Theta(\\log n)$ |
| Strassen | 7 | 2 | 1 | $\\Theta(n^{2.81})$ |

> Exercise for next time: $T(n) = 4T(n/2) + n^2$ and $T(n) = T(n/3) + T(2n/3) + n$.
`;

const ALGO_PREVIOUS = `# Sorting basics

## Insertion sort

- In place, stable
- Worst case $\\Theta(n^2)$ (reverse-sorted input), best case $\\Theta(n)$
- Good for small or nearly sorted arrays

## Loop invariants

To prove an algorithm correct, show the invariant holds at:

1. **Initialization** — before the first iteration
2. **Maintenance** — each iteration keeps it true
3. **Termination** — when the loop ends it gives us correctness

- [x] Read chapter 2
- [ ] Problem set 1, questions 3–5
`;

const ALGO_FIRST = `# Course intro

- Grading: 3 problem sets (30%), midterm (30%), final (40%)
- Office hours: Tuesdays 14:00–15:00
- Asymptotic notation: $O$, $\\Omega$, $\\Theta$

$$
f(n) = O(g(n)) \\iff \\exists\\, c, n_0 : f(n) \\le c\\,g(n) \\;\\; \\forall n \\ge n_0
$$
`;

const LINALG_LATEST = `# Eigenvalues and eigenvectors

A non-zero vector $v$ is an **eigenvector** of $A$ when $Av = \\lambda v$.

## Finding them

1. Solve the characteristic equation $\\det(A - \\lambda I) = 0$
2. For each $\\lambda$, find the null space of $A - \\lambda I$

$$
A = \\begin{pmatrix} 2 & 1 \\\\ 1 & 2 \\end{pmatrix}
\\quad\\Rightarrow\\quad \\lambda_1 = 3,\\; \\lambda_2 = 1
$$

## Facts to remember

- $\\operatorname{tr}(A) = \\sum \\lambda_i$ and $\\det(A) = \\prod \\lambda_i$
- Symmetric matrices have real eigenvalues and orthogonal eigenvectors
`;

const LINALG_PREVIOUS = `# Determinants

- $\\det(AB) = \\det(A)\\det(B)$
- Swapping two rows flips the sign
- $A$ is invertible $\\iff \\det(A) \\neq 0$

| Operation | Effect on $\\det$ |
| --- | --- |
| Swap rows | $\\times(-1)$ |
| Scale a row by $k$ | $\\times k$ |
| Add a multiple of a row | none |
`;

const WRITING_LATEST = `# Writing a literature review

## Structure

1. Introduction — scope and why it matters
2. Themes, not a list of summaries
3. Gaps the review reveals
4. Conclusion

## Tips from today

- Synthesize: *how do the sources talk to each other?*
- Keep your own voice in topic sentences
- Cite as you write; don't leave it to the end

**Draft due:** next Friday, 1500 words.
`;

const GENERAL = `# Exam plan

| Course | Exam | Topics |
| --- | --- | --- |
| Algorithms | Midterm | Sorting, recurrences, divide and conquer |
| Linear Algebra | Quiz 2 | Determinants, eigenvalues |
| Academic Writing | Draft | Literature review |

- [ ] Redo the master theorem exercises
- [ ] Practice $2\\times2$ and $3\\times3$ eigenvalue problems
- [x] Pick three sources for the literature review
`;

function seed() {
  notes = [];
  workspaces = {};
  const add = (key: string | undefined, name: string, content: string) => {
    if (key === undefined) return;
    const s = getSession(key);
    const n = createNote(key, name, content) as DemoNote;
    n.createdAt = n.updatedAt = s ? s.end : n.createdAt;
    return n;
  };
  const algo = pastKeys(IDS.algoLineage);
  const linalg = pastKeys(IDS.linalgLineage);
  const writing = pastKeys(IDS.writingLineage);
  // the latest lecture's note already holds the seeded transcription of its recording
  const start = algo[0] ? getSession(algo[0])?.start : undefined;
  const lecture = add(algo[0], "Lecture notes", start ? `${ALGO_LATEST}\n${transcriptSection(LECTURE_RECORDING_NAME, start, LECTURE_DURATION_MS)}` : ALGO_LATEST);
  if (lecture) lecture.id = LECTURE_NOTE_ID;
  add(algo[1], "Lecture notes", ALGO_PREVIOUS);
  add(algo.at(-1), "Course intro", ALGO_FIRST);
  add(linalg[0], "Lecture notes", LINALG_LATEST);
  add(linalg[1], "Lecture notes", LINALG_PREVIOUS);
  add(writing[0], "Lecture notes", WRITING_LATEST);
  const general = createNote(null, "Exam plan", GENERAL) as DemoNote;
  general.createdAt = general.updatedAt = getStore().now.toISOString();
}

registerSlice({
  name: "notes",
  seed,
  removeSessions: (keys, lineageIds) => {
    notes = notes.filter((n) => !attachedTo(n.sessionKey, keys, lineageIds));
    for (const k of Object.keys(workspaces)) if (attachedTo(k, keys, lineageIds)) delete workspaces[k];
  },
  count: (keys, lineageIds) => ({ notes: notes.filter((n) => attachedTo(n.sessionKey, keys, lineageIds)).length }),
  snapshot: (lineageIds) => {
    const kept = notes.filter((n) => attachedTo(n.sessionKey, new Set(), lineageIds));
    return () => notes.push(...kept.filter((n) => !notes.includes(n)));
  },
});

// ---------- handlers ----------

const sessionOr404 = (key: string) => (getSession(key) ? null : notFound("Session"));

export const handlers: HttpHandler[] = [
  http.get(`${API}/sessions/:key/notes`, ({ params }) => {
    const key = String(params.key);
    return (
      sessionOr404(key) ??
      json(
        notes
          .filter((n) => n.sessionKey === key)
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
          .map(noteMeta),
      )
    );
  }),
  http.post(`${API}/sessions/:key/notes`, async ({ request, params }) => {
    const key = String(params.key);
    const missing = sessionOr404(key);
    if (missing) return missing;
    const body = await readJson<Body<"/api/v1/sessions/{session_key}/notes", "post">>(request);
    const n = createNote(key, body.name, body.content ?? "");
    return n instanceof Response ? n : json(await noteOut(n), 201);
  }),
  http.get(`${API}/general-notes`, () =>
    json(
      notes
        .filter((n) => n.sessionKey === null)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map(noteMeta),
    ),
  ),
  http.post(`${API}/general-notes`, async ({ request }) => {
    const body = await readJson<Body<"/api/v1/general-notes", "post">>(request);
    const n = createNote(null, body.name, body.content ?? "");
    return n instanceof Response ? n : json(await noteOut(n), 201);
  }),
  http.get(`${API}/notes/search`, ({ request }) => {
    const q = new URL(request.url).searchParams;
    const text = (q.get("q") ?? "").trim().toLowerCase();
    const courseId = q.get("courseId");
    const sessionKey = q.get("sessionKey");
    const limit = Math.max(1, Math.min(Number(q.get("limit") ?? 50) || 50, 200));
    if (sessionKey && !parseKey(sessionKey)) return validation("sessionKey", "Not a session key.");
    const hits: Res<"/api/v1/notes/search", "get"> = [];
    for (const n of [...notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
      if (!n.sessionKey) continue; // like the real search: session notes only
      const s = getSession(n.sessionKey);
      if (!s) continue;
      if (text && !n.name.toLowerCase().includes(text) && !n.content.toLowerCase().includes(text)) continue;
      if (courseId && s.courseId !== courseId) continue;
      if (sessionKey && n.sessionKey !== sessionKey) continue;
      hits.push({
        id: n.id,
        title: n.name,
        sessionKey: n.sessionKey,
        sessionLabel: sessionLabel(n.sessionKey),
        courseId: s.courseId,
        courseName: s.courseName,
        updatedAt: n.updatedAt,
      });
      if (hits.length >= limit) break;
    }
    return json(hits);
  }),
  http.get(`${API}/notes/:id`, async ({ params }) => {
    const n = findNote(String(params.id));
    return n ? json(await noteOut(n)) : notFound("Note");
  }),
  http.patch(`${API}/notes/:id`, async ({ request, params }) => {
    const n = findNote(String(params.id));
    if (!n) return notFound("Note");
    const stale = checkIfMatch(request, n);
    if (stale) return stale;
    const body = await readJson<Body<"/api/v1/notes/{note_id}", "patch">>(request);
    const name = cleanName(body.name);
    if (name instanceof Response) return name;
    if (notes.some((x) => x !== n && x.sessionKey === n.sessionKey && x.name.toLowerCase() === name.toLowerCase())) {
      return nameTaken(n.sessionKey ? "A note with this name already exists in this session." : "A general note with this name already exists.");
    }
    const siblings = notes.filter((x) => x !== n && x.sessionKey === n.sessionKey).map((x) => x.fileName);
    n.name = name;
    n.fileName = uniqueFileName(name, ".md", siblings);
    n.updatedAt = nowIso();
    bump(n);
    return json(noteMeta(n));
  }),
  http.delete(`${API}/notes/:id`, ({ request, params }) => {
    const n = findNote(String(params.id));
    if (!n) return notFound("Note");
    const stale = checkIfMatch(request, n);
    if (stale) return stale;
    notes = notes.filter((x) => x !== n);
    return noContent();
  }),
  http.put(`${API}/notes/:id/content`, async ({ request, params }) => {
    const n = findNote(String(params.id));
    if (!n) return notFound("Note");
    const body = await readJson<Body<"/api/v1/notes/{note_id}/content", "put">>(request);
    if (typeof body.content !== "string") return validation("content", "Content is required.", "required");
    const hash = await sha256(n.content);
    if (checkIfMatch(request, n)) {
      return problem(412, "version_conflict", "This note was saved from another window.", undefined, undefined, conflictBody(n, hash));
    }
    if (body.baseHash !== hash) {
      return problem(409, "file_changed_on_disk", "This note was changed outside the app.", undefined, undefined, conflictBody(n, hash));
    }
    n.content = body.content;
    n.updatedAt = nowIso();
    bump(n);
    const out: Res<"/api/v1/notes/{note_id}/content", "put"> = {
      version: n.version,
      hash: await sha256(n.content),
      size: utf8.encode(n.content).length,
      updatedAt: n.updatedAt,
    };
    return json(out);
  }),
  http.get(`${API}/workspace/:key`, ({ params }) => {
    const key = String(params.key);
    return sessionOr404(key) ?? json(workspaceView(key));
  }),
  http.put(`${API}/workspace/:key`, async ({ request, params }) => {
    const key = String(params.key);
    const missing = sessionOr404(key);
    if (missing) return missing;
    const body = await readJson<Body<"/api/v1/workspace/{session_key}", "put">>(request);
    const prev = workspaceView(key);
    if (body.tabs) {
      workspaces[key] = { tabs: body.tabs, active: body.active ?? null, split: body.split ?? null };
    } else {
      const open = body.openNoteIds ?? [];
      if (body.activeNoteId && !open.includes(body.activeNoteId)) return validation("activeNoteId", "The active note must be open.", "invalid_active");
      const others = (prev.tabs ?? []).filter((t) => t.kind !== "note");
      workspaces[key] = {
        tabs: [...open.map((id) => ({ kind: "note" as const, id })), ...others],
        active: body.activeNoteId ? { kind: "note", id: body.activeNoteId } : null,
        split: prev.split,
      };
    }
    return json(workspaceView(key));
  }),
];
