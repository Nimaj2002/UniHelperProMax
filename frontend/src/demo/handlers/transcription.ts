/**
 * 024: simulated transcription (contracts/demo-mode.md §2 "Transcription"). A job goes
 * queued → uploading → transcribing → appending → completed over ~5 s, then the canned
 * transcript is APPENDED to the target note exactly as the real worker does (Principle I:
 * transcription only ever appends). Cancel stops it before anything is written.
 */
import { http, type HttpHandler } from "msw";
import type { Schemas } from "@/lib/api";
import { getSession } from "../calendar";
import { LECTURE_NOTE_ID, LECTURE_RECORDING_ID, transcriptSection } from "../canned/lecture";
import { API, json, noContent, notFound, problem, readJson, validation, type Body } from "../http";
import { getStore, newId, nowIso, registerSlice } from "../store";
import { appendToNote, attachedTo, createNote, findNote } from "./notes";
import { findRecording, guards } from "./recordings";

type Job = Schemas["TranscriptionJob"];

const PROVIDER = { id: "demo", name: "Demo transcriber" };
const ACTIVE: Job["status"][] = ["queued", "uploading", "transcribing", "appending"];

let jobs: Job[] = [];
const timers = new Map<string, ReturnType<typeof setTimeout>>();

const activeJob = () => jobs.find((j) => ACTIVE.includes(j.status)) ?? null;
const findJob = (id: string) => jobs.find((j) => j.id === id);
guards.transcribing = (recordingId) => jobs.some((j) => j.recordingId === recordingId && ACTIVE.includes(j.status));

function stop(job: Job) {
  clearTimeout(timers.get(job.id));
  timers.delete(job.id);
}

/** The job's view: the note's current name, like the real API. */
function view(job: Job): Job {
  const note = job.noteId ? findNote(job.noteId) : undefined;
  return { ...job, noteId: note ? note.id : null, noteName: note?.name ?? job.noteName };
}

async function finish(job: Job) {
  const rec = findRecording(job.recordingId);
  if (!rec) {
    Object.assign(job, { status: "failed", errorCategory: "file_rejected", errorMessage: "The audio file is missing.", finishedAt: nowIso(), progress: null });
    return;
  }
  let note = job.noteId ? findNote(job.noteId) : undefined;
  if (!note) {
    // the target note was deleted meanwhile: the transcript goes to a new note instead
    const base = `Transcript – ${rec.name}`.slice(0, 110);
    let created = createNote(rec.sessionKey, base);
    for (let n = 2; created instanceof Response; n++) created = createNote(rec.sessionKey, `${base} (${n})`);
    note = created;
    Object.assign(job, { noteId: note.id, noteName: note.name, fallbackNoteCreated: true });
  }
  const appended = await appendToNote(note, transcriptSection(rec.name, rec.startedAt, rec.durationMs));
  Object.assign(job, { status: "completed", progress: null, appended, finishedAt: nowIso(), stageStartedAt: nowIso() });
}

/** Run the stages on timers (fake timers in tests advance them). */
function run(job: Job) {
  const steps: [delay: number, apply: () => void | Promise<void>][] = [
    [500, () => void Object.assign(job, { status: "uploading", progress: 0, startedAt: nowIso(), stageStartedAt: nowIso() })],
    [500, () => void (job.progress = 0.35)],
    [500, () => void (job.progress = 0.7)],
    [500, () => void (job.progress = 1)],
    [500, () => void Object.assign(job, { status: "transcribing", progress: null, stageStartedAt: nowIso() })],
    [2000, () => void Object.assign(job, { status: "appending", stageStartedAt: nowIso() })],
    [500, () => finish(job)],
  ];
  const next = (i: number) => {
    if (i >= steps.length) return;
    const [delay, apply] = steps[i];
    timers.set(
      job.id,
      setTimeout(async () => {
        timers.delete(job.id);
        if (!ACTIVE.includes(job.status)) return; // cancelled meanwhile
        await apply();
        next(i + 1);
      }, delay),
    );
  };
  next(0);
}

function newJob(rec: Schemas["Recording"], noteId: string, noteName: string, language: string): Job {
  const session = getSession(rec.sessionKey);
  return {
    id: newId("tx"),
    recordingId: rec.id,
    recordingName: rec.name,
    sessionKey: rec.sessionKey,
    courseId: session?.courseId ?? null,
    noteId,
    noteName,
    language,
    providerId: PROVIDER.id,
    providerName: PROVIDER.name,
    status: "queued",
    partIndex: 0,
    partCount: 1,
    progress: null,
    stageStartedAt: null,
    errorCategory: null,
    errorMessage: null,
    settingsRelated: false,
    cancelRequested: false,
    fallbackNoteCreated: false,
    attempts: 1,
    seen: false,
    appended: null,
    createdAt: nowIso(),
    startedAt: null,
    finishedAt: null,
  };
}

function seed() {
  for (const j of jobs) stop(j);
  jobs = [];
  const rec = findRecording(LECTURE_RECORDING_ID);
  const note = findNote(LECTURE_NOTE_ID);
  if (!rec || !note) return;
  const done = rec.startedAt; // the transcript is already in the note (notes.ts seed)
  // `appended: null` — like a job finished before a restart: clients just reload the note
  jobs.push({ ...newJob(rec, note.id, note.name, "en"), status: "completed", seen: true, createdAt: done, startedAt: done, finishedAt: done });
}

registerSlice({
  name: "transcription",
  seed,
  removeSessions: (keys, lineageIds) => {
    for (const j of jobs) if (attachedTo(j.sessionKey, keys, lineageIds)) stop(j);
    jobs = jobs.filter((j) => !attachedTo(j.sessionKey, keys, lineageIds));
  },
  snapshot: (lineageIds) => {
    const kept = jobs.filter((j) => attachedTo(j.sessionKey, new Set(), lineageIds) && !ACTIVE.includes(j.status));
    return () => jobs.push(...kept.filter((j) => !jobs.includes(j)));
  },
});

const providerSpec: Schemas["ProviderSpec"] = { ...PROVIDER, fields: [], maxUploadBytes: null };

export const handlers: HttpHandler[] = [
  http.get(`${API}/transcription/providers`, () => json([providerSpec])),
  http.get(`${API}/transcription/status`, () =>
    json<Schemas["TranscriptionStatus"]>({ configured: true, providerId: PROVIDER.id, providerName: PROVIDER.name, defaultLanguage: "auto" }),
  ),
  http.get(`${API}/settings/transcription`, () =>
    json<Schemas["TranscriptionSettings"]>({
      activeProviderId: PROVIDER.id,
      defaultLanguage: "auto",
      providers: [
        {
          providerId: PROVIDER.id,
          values: {},
          secret: { configured: false, last4: null, readable: true },
          status: "connected",
          lastError: null,
          testedAt: getStore().now.toISOString(),
        },
      ],
      useProxy: false,
    }),
  ),
  http.get(`${API}/transcriptions`, ({ request }) => {
    if (new URL(request.url).searchParams.get("unseen") !== "true") return validation("unseen", "Only unseen=true is supported.", "unsupported");
    return json(
      jobs
        .filter((j) => (j.status === "completed" || j.status === "failed") && !j.seen)
        .sort((a, b) => (a.finishedAt ?? "").localeCompare(b.finishedAt ?? ""))
        .map(view),
    );
  }),
  http.get(`${API}/transcriptions/active`, () => {
    const j = activeJob();
    return json(j ? view(j) : null);
  }),
  http.get(`${API}/transcriptions/:id`, ({ params }) => {
    const j = findJob(String(params.id));
    return j ? json(view(j)) : notFound("Transcription");
  }),
  http.get(`${API}/sessions/:key/transcriptions`, ({ params }) => {
    const key = String(params.key);
    if (!getSession(key)) return notFound("Session");
    return json(
      jobs
        .filter((j) => j.sessionKey === key)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
        .map(view),
    );
  }),
  http.post(`${API}/recordings/:id/transcriptions`, async ({ request, params }) => {
    const rec = findRecording(String(params.id));
    if (!rec) return notFound("Recording");
    if (activeJob()) return problem(409, "transcription_in_progress", "A transcription is already running.");
    const body = await readJson<Body<"/api/v1/recordings/{recording_id}/transcriptions", "post">>(request);
    let noteId: string;
    let noteName: string;
    if (body.noteId) {
      const note = findNote(body.noteId);
      if (!note || note.sessionKey !== rec.sessionKey) return notFound("Note");
      [noteId, noteName] = [note.id, note.name];
    } else {
      const created = createNote(rec.sessionKey, body.newNoteName ?? "");
      if (created instanceof Response) return created;
      [noteId, noteName] = [created.id, created.name];
    }
    const job = newJob(rec, noteId, noteName, body.language || "auto");
    jobs.push(job);
    run(job);
    return json(view(job), 202);
  }),
  http.post(`${API}/transcriptions/:id/cancel`, ({ params }) => {
    const j = findJob(String(params.id));
    if (!j) return notFound("Transcription");
    if (!ACTIVE.includes(j.status)) return problem(409, "job_finished", "This transcription has already finished.");
    if (j.status !== "appending") {
      // the real worker stops at its next checkpoint; the demo stops at once (nothing written yet)
      stop(j);
      Object.assign(j, { status: "cancelled", cancelRequested: j.status !== "queued", seen: true, progress: null, finishedAt: nowIso() });
    }
    return json(view(j));
  }),
  http.post(`${API}/transcriptions/:id/retry`, ({ params }) => {
    const j = findJob(String(params.id));
    if (!j) return notFound("Transcription");
    if (j.status !== "failed" && j.status !== "cancelled") return problem(409, "job_not_retryable", "Only failed or cancelled transcriptions can be retried.");
    if (activeJob()) return problem(409, "transcription_in_progress", "A transcription is already running.");
    Object.assign(j, {
      status: "queued",
      attempts: j.attempts + 1,
      errorCategory: null,
      errorMessage: null,
      settingsRelated: false,
      cancelRequested: false,
      seen: false,
      progress: null,
      stageStartedAt: null,
      finishedAt: null,
    });
    run(j);
    return json(view(j), 202);
  }),
  http.post(`${API}/transcriptions/:id/seen`, ({ params }) => {
    const j = findJob(String(params.id));
    if (!j) return notFound("Transcription");
    j.seen = true;
    return noContent();
  }),
];
