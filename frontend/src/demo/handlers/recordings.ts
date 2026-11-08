/**
 * 024: recordings — list, play, rename, delete (contracts/demo-mode.md §2 "Recordings").
 * Recording, chunk upload and import are answered by unavailable.ts. The audio is the bundled
 * sample clip, loaded lazily; `Range` requests get `206` so `<audio>` can seek.
 */
import { http, type HttpHandler } from "msw";
import type { Schemas } from "@/lib/api";
import { getSession } from "../calendar";
import { LECTURE_DURATION_MS, LECTURE_RECORDING_ID, LECTURE_RECORDING_NAME } from "../canned/lecture";
import { API, checkIfMatch, json, noContent, notFound, problem, readJson, type Body } from "../http";
import { IDS, pastKeys } from "../seed";
import { bump, registerSlice } from "../store";
import { loadAsset } from "./documents";
import { attachedTo, cleanName, nameTaken, uniqueFileName } from "./notes";

let recordings: Schemas["Recording"][] = [];

export const findRecording = (id: string) => recordings.find((r) => r.id === id);

/** Set by transcription.ts (kept out of this module's imports to avoid a cycle). */
export const guards = { transcribing: (_recordingId: string): boolean => false };

let audio: Promise<Uint8Array<ArrayBuffer>> | null = null;
const audioBytes = () => (audio ??= loadAsset(() => import("../assets/lecture-week3.wav?inline")));

const AUDIO_SIZE = 240_044; // bytes of assets/lecture-week3.wav

function seed() {
  recordings = [];
  const key = pastKeys(IDS.algoLineage)[0];
  const session = key ? getSession(key) : null;
  if (!key || !session) return;
  recordings.push({
    id: LECTURE_RECORDING_ID,
    sessionKey: key,
    name: LECTURE_RECORDING_NAME,
    fileName: "Lecture - Divide and Conquer.wav",
    mimeType: "audio/wav",
    status: "complete",
    startedAt: session.start,
    durationMs: LECTURE_DURATION_MS,
    size: AUDIO_SIZE,
    nextSeq: 0,
    active: false,
    missing: false,
    version: 1,
    origin: "recorded",
    originalFileName: null,
  });
}

registerSlice({
  name: "recordings",
  seed,
  removeSessions: (keys, lineageIds) => {
    recordings = recordings.filter((r) => !attachedTo(r.sessionKey, keys, lineageIds));
  },
  count: (keys, lineageIds) => ({ recordings: recordings.filter((r) => attachedTo(r.sessionKey, keys, lineageIds)).length }),
  snapshot: (lineageIds) => {
    const kept = recordings.filter((r) => attachedTo(r.sessionKey, new Set(), lineageIds));
    return () => recordings.push(...kept.filter((r) => !recordings.includes(r)));
  },
});

/** `bytes=a-b`, `bytes=a-` or `bytes=-n` → [start, end] inclusive; null when unsatisfiable. */
export function parseRange(header: string, size: number): [number, number] | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  let start: number;
  let end: number;
  if (m[1] === "") {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  return start <= end && start < size ? [start, end] : null;
}

export const handlers: HttpHandler[] = [
  http.get(`${API}/sessions/:key/recordings`, ({ params }) => {
    const key = String(params.key);
    if (!getSession(key)) return notFound("Session");
    return json(recordings.filter((r) => r.sessionKey === key).sort((a, b) => a.startedAt.localeCompare(b.startedAt)));
  }),
  http.get(`${API}/recordings/active`, () => json(null)),
  http.get(`${API}/recordings/:id`, ({ params }) => {
    const r = findRecording(String(params.id));
    return r ? json(r) : notFound("Recording");
  }),
  http.patch(`${API}/recordings/:id`, async ({ request, params }) => {
    const r = findRecording(String(params.id));
    if (!r) return notFound("Recording");
    const stale = checkIfMatch(request, r);
    if (stale) return stale;
    const body = await readJson<Body<"/api/v1/recordings/{recording_id}", "patch">>(request);
    const name = cleanName(body.name, "recording");
    if (name instanceof Response) return name;
    const siblings = recordings.filter((x) => x !== r && x.sessionKey === r.sessionKey);
    if (siblings.some((x) => x.name.toLowerCase() === name.toLowerCase())) return nameTaken("A recording with this name already exists in this session.");
    r.name = name;
    r.fileName = uniqueFileName(name, r.fileName.slice(r.fileName.lastIndexOf(".")), siblings.map((x) => x.fileName));
    bump(r);
    return json(r);
  }),
  http.delete(`${API}/recordings/:id`, ({ request, params }) => {
    const r = findRecording(String(params.id));
    if (!r) return notFound("Recording");
    const stale = checkIfMatch(request, r);
    if (stale) return stale;
    if (guards.transcribing(r.id)) {
      return problem(409, "recording_transcribing", "This recording is being transcribed. Cancel or wait for the transcription first.");
    }
    recordings = recordings.filter((x) => x !== r);
    return noContent();
  }),
  http.get(`${API}/recordings/:id/audio`, async ({ request, params }) => {
    const r = findRecording(String(params.id));
    if (!r) return notFound("Recording");
    const bytes = await audioBytes();
    const size = bytes.byteLength;
    const headers = { "Content-Type": r.mimeType, "Accept-Ranges": "bytes" };
    const header = request.headers.get("Range");
    if (header === null) return new Response(bytes, { headers: { ...headers, "Content-Length": String(size) } });
    const range = parseRange(header, size);
    if (!range) return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
    const [start, end] = range;
    return new Response(bytes.slice(start, end + 1), {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }),
];
