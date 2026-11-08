import { describe, expect, it, vi } from "vitest";
import { ApiError, type Schemas } from "@/lib/api";
import { LECTURE_NOTE_ID, LECTURE_RECORDING_ID } from "@/demo/canned/lecture";
import { IDS, pastKeys } from "@/demo/seed";
import { api, raw, startDemoServer } from "./setup";

startDemoServer();

const enc = encodeURIComponent;
const latestAlgo = () => pastKeys(IDS.algoLineage)[0];

async function startJob(): Promise<Schemas["TranscriptionJob"]> {
  return api<Schemas["TranscriptionJob"]>(`/recordings/${LECTURE_RECORDING_ID}/transcriptions`, { method: "POST", body: { noteId: LECTURE_NOTE_ID } });
}

describe("demo notes, documents, recordings and transcription", () => {
  it("seeds notes, the PDF and the recording on the latest Algorithms session", async () => {
    const key = latestAlgo();
    const notes = await api<Schemas["NoteMeta"][]>(`/sessions/${enc(key)}/notes`);
    expect(notes.map((n) => n.id)).toContain(LECTURE_NOTE_ID);
    const note = await api<Schemas["Note"]>(`/notes/${LECTURE_NOTE_ID}`);
    expect(note.content).toContain("```mermaid");
    expect(note.content).toContain("## Transcript — ");
    expect(note.hash).toMatch(/^[0-9a-f]{64}$/);

    const docs = await api<Schemas["Document"][]>(`/sessions/${enc(key)}/documents`);
    expect(docs).toHaveLength(1);
    expect(docs[0].annotationCount).toBeGreaterThanOrEqual(2);
    const recs = await api<Schemas["Recording"][]>(`/sessions/${enc(key)}/recordings`);
    expect(recs.map((r) => r.id)).toEqual([LECTURE_RECORDING_ID]);

    // course PDFs are listed in the course's other sessions too
    const other = await api<Schemas["Document"][]>(`/sessions/${enc(pastKeys(IDS.algoLineage)[1])}/documents`);
    expect(other.map((d) => d.id)).toEqual([docs[0].id]);
    expect((await api<Schemas["NoteMeta"][]>("/general-notes")).length).toBe(1);
    const hits = await api<Schemas["NoteSearchHit"][]>("/notes/search", { query: { q: "EIGENVECTOR" } });
    expect(hits.map((h) => h.courseId)).toEqual([IDS.linalg]);
  });

  it("serves the PDF and the audio with Range support", async () => {
    const [doc] = await api<Schemas["Document"][]>(`/sessions/${enc(latestAlgo())}/documents`);
    const pdf = await raw(`/documents/${doc.id}/file`);
    expect(pdf.headers.get("Content-Type")).toBe("application/pdf");
    const head = new TextDecoder().decode((await pdf.arrayBuffer()).slice(0, 5));
    expect(head).toBe("%PDF-");

    const part = await raw(`/recordings/${LECTURE_RECORDING_ID}/audio`, { headers: { Range: "bytes=0-99" } });
    expect(part.status).toBe(206);
    expect(part.headers.get("Content-Range")).toMatch(/^bytes 0-99\/\d+$/);
    expect((await part.arrayBuffer()).byteLength).toBe(100);
    const whole = await raw(`/recordings/${LECTURE_RECORDING_ID}/audio`);
    expect(whole.status).toBe(200);
    expect(whole.headers.get("Accept-Ranges")).toBe("bytes");
  });

  it("saves note content with the current version and refuses a stale one", async () => {
    const note = await api<Schemas["Note"]>(`/notes/${LECTURE_NOTE_ID}`);
    const saved = await api<Schemas["SaveResult"]>(`/notes/${note.id}/content`, {
      method: "PUT",
      version: note.version,
      body: { content: "# Rewritten", baseHash: note.hash },
    });
    expect(saved.version).toBe(note.version + 1);
    expect(saved.hash).not.toBe(note.hash);
    const err = await api(`/notes/${note.id}/content`, { method: "PUT", version: note.version, body: { content: "x", baseHash: saved.hash } }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(412);
    expect((err as ApiError).code).toBe("version_conflict");
    expect((await api<Schemas["Note"]>(`/notes/${note.id}`)).content).toBe("# Rewritten");
  });

  it("completes a transcription by appending to the note", async () => {
    const before = await api<Schemas["Note"]>(`/notes/${LECTURE_NOTE_ID}`);
    const job = await startJob();
    expect(job.status).toBe("queued");
    await vi.advanceTimersByTimeAsync(6000);
    // the append hashes the note (WebCrypto, not a timer), so let it settle
    const done = await vi.waitFor(async () => {
      const j = await api<Schemas["TranscriptionJob"]>(`/transcriptions/${job.id}`);
      expect(j.status).toBe("completed");
      return j;
    });
    const after = await api<Schemas["Note"]>(`/notes/${LECTURE_NOTE_ID}`);
    expect(after.content.startsWith(before.content)).toBe(true);
    expect(after.content.length).toBeGreaterThan(before.content.length);
    expect(after.version).toBe(before.version + 1);
    expect(done.appended).toMatchObject({ previousHash: before.hash, hash: after.hash, version: after.version });
    expect(before.content + done.appended!.text).toBe(after.content);
    expect(await api(`/transcriptions/active`)).toBeNull();
  });

  it("leaves the note untouched when a running transcription is cancelled", async () => {
    const before = await api<Schemas["Note"]>(`/notes/${LECTURE_NOTE_ID}`);
    const job = await startJob();
    await vi.advanceTimersByTimeAsync(1200);
    expect((await api<Schemas["TranscriptionJob"]>(`/transcriptions/${job.id}`)).status).toBe("uploading");
    const cancelled = await api<Schemas["TranscriptionJob"]>(`/transcriptions/${job.id}/cancel`, { method: "POST" });
    expect(cancelled.status).toBe("cancelled");
    await vi.advanceTimersByTimeAsync(6000);
    const after = await api<Schemas["Note"]>(`/notes/${LECTURE_NOTE_ID}`);
    expect(after.content).toBe(before.content);
    expect(after.version).toBe(before.version);
  });

  it("removes a deleted course's notes, documents and recordings", async () => {
    const key = latestAlgo();
    const course = await api<Schemas["Course"]>(`/courses/${IDS.algo}`);
    const impact = await api<Schemas["DeletionImpact"]>(`/courses/${IDS.algo}/deletion-impact`);
    expect(impact).toMatchObject({ notes: 3, documents: 1, recordings: 1 });
    await api(`/courses/${IDS.algo}`, { method: "DELETE", version: course.version });
    await expect(api(`/notes/${LECTURE_NOTE_ID}`)).rejects.toMatchObject({ status: 404 });
    await expect(api(`/recordings/${LECTURE_RECORDING_ID}`)).rejects.toMatchObject({ status: 404 });
    await expect(api(`/sessions/${enc(key)}/documents`)).rejects.toMatchObject({ status: 404 });
    const hits = await api<Schemas["NoteSearchHit"][]>("/notes/search");
    expect(hits.some((h) => h.courseId === IDS.algo)).toBe(false);
  });
});
