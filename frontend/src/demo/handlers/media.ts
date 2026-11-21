/**
 * 025: the Media Editor in the demo — the recordings tree, waveform peaks and trim. The audio
 * stays the bundled sample clip; trimming only changes the listed length (in-memory, like the rest).
 */
import { http, type HttpHandler } from "msw";
import type { Schemas } from "@/lib/api";
import { getSession } from "../calendar";
import { API, checkIfMatch, json, notFound, problem, readJson, type Body } from "../http";
import { bump } from "../store";
import { addRecording, allRecordings, findRecording } from "./recordings";
import { cleanName, nameTaken } from "./notes";

const view = (r: Schemas["Recording"]): Schemas["MediaRecording"] => ({
  id: r.id,
  name: r.name,
  durationMs: r.durationMs,
  version: r.version,
  hasTranscript: false,
  missing: r.missing,
  mimeType: r.mimeType,
});

export const handlers: HttpHandler[] = [
  http.get(`${API}/media/recordings`, () => {
    const groups = new Map<string, Schemas["MediaClassGroup"]>();
    for (const r of allRecordings()) {
      const session = getSession(r.sessionKey);
      if (!session || r.status === "recording") continue;
      const id = session.courseId ?? "events";
      let group = groups.get(id);
      if (!group) {
        group = { id: session.courseId, name: session.courseName ?? "Events", context: "", sessions: [] };
        groups.set(id, group);
      }
      let s = group.sessions.find((x) => x.sessionKey === r.sessionKey);
      if (!s) {
        s = { sessionKey: r.sessionKey, title: session.title ?? session.date, date: session.date, recordings: [] };
        group.sessions.push(s);
      }
      s.recordings.push(view(r));
    }
    return json([...groups.values()].sort((a, b) => a.name.localeCompare(b.name)));
  }),
  http.get(`${API}/recordings/:id/peaks`, ({ request, params }) => {
    const r = findRecording(String(params.id));
    if (!r) return notFound("Recording");
    const buckets = Number(new URL(request.url).searchParams.get("buckets") ?? 2000);
    const peaks = Array.from({ length: buckets }, (_v, i) => 0.15 + 0.7 * Math.abs(Math.sin(i / 23) * Math.cos(i / 91)));
    return json<Schemas["Peaks"]>({ durationMs: r.durationMs, peaks });
  }),
  http.post(`${API}/recordings/:id/trim`, async ({ request, params }) => {
    const r = findRecording(String(params.id));
    if (!r) return notFound("Recording");
    const body = await readJson<Body<"/api/v1/recordings/{recording_id}/trim", "post">>(request);
    const windows = (body.ranges ?? (body.startMs != null && body.endMs != null ? [{ startMs: body.startMs, endMs: body.endMs }] : []))
      .map((w) => ({ ...w }))
      .sort((a, b) => a.startMs - b.startMs);
    const bad =
      windows.length === 0 ||
      windows.some((w, i) => w.startMs < 0 || w.endMs > r.durationMs || w.endMs - w.startMs < 100 || (i > 0 && w.startMs < windows[i - 1].endMs)) ||
      (windows.length === 1 && windows[0].startMs === 0 && windows[0].endMs === r.durationMs);
    if (bad) return problem(422, "invalid_range", "The selected windows aren't a valid trim.");
    const separate = body.combine === "separate" && windows.length > 1;
    if (body.mode === "overwrite") {
      if (separate) return problem(422, "overwrite_needs_merge", "Overwriting needs the windows merged into one.");
      const stale = checkIfMatch(request, r);
      if (stale) return stale;
      r.durationMs = windows.reduce((n, w) => n + w.endMs - w.startMs, 0);
      bump(r);
      return json<Schemas["TrimResult"]>({ mode: "overwrite", recording: view(r), recordings: [view(r)], transcriptStale: false });
    }
    const base = cleanName(body.name ?? "", "recording");
    if (base instanceof Response) return base;
    const outputs = separate
      ? windows.map((w, i) => ({ name: `${base} ${i + 1}`, ms: w.endMs - w.startMs }))
      : [{ name: base, ms: windows.reduce((n, w) => n + w.endMs - w.startMs, 0) }];
    const taken = (n: string) => allRecordings().some((x) => x.sessionKey === r.sessionKey && x.name.toLowerCase() === n.toLowerCase());
    if (outputs.some((o) => taken(o.name))) return nameTaken("A recording with this name already exists in this session.");
    const made = outputs.map((o, i) => {
      const copy: Schemas["Recording"] = {
        ...r,
        id: `${r.id}-trim-${allRecordings().length + i}`,
        name: o.name,
        fileName: `${o.name}${r.fileName.slice(r.fileName.lastIndexOf("."))}`,
        durationMs: o.ms,
        origin: "imported",
        originalFileName: r.fileName,
        version: 1,
      };
      addRecording(copy);
      return copy;
    });
    return json<Schemas["TrimResult"]>({ mode: "new", recording: view(made[0]), recordings: made.map(view), transcriptStale: false }, 201);
  }),
];
