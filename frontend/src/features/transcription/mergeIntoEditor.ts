/** A finished transcription reaches the note: an open note merges the appended text at the end
 * (keeping unsaved typing, 004 FR-009); otherwise its cached copy is refreshed. */
import type { QueryClient } from "@tanstack/react-query";
import { notesKey, noteKey } from "@/features/sessions/api";
import { getSaver } from "@/features/sessions/autosave";
import { workspacePath } from "@/features/sessions/SessionTimeline";
import { historyKey, type TranscriptionJob } from "./api";

export function applyFinishedJob(qc: QueryClient, job: TranscriptionJob) {
  if (job.status === "completed" && job.noteId) {
    const saver = getSaver(job.noteId);
    if (saver && job.appended) saver.applyServerAppend(job.appended);
    else void qc.invalidateQueries({ queryKey: noteKey(job.noteId) });
    void qc.invalidateQueries({ queryKey: notesKey(job.sessionKey) });
    void qc.invalidateQueries({ queryKey: ["timeline"] });
  }
  void qc.invalidateQueries({ queryKey: historyKey(job.sessionKey) });
}

export function notePath(job: Pick<TranscriptionJob, "courseId" | "sessionKey" | "noteId">) {
  const base = workspacePath(job.courseId, job.sessionKey);
  return job.noteId ? `${base}?note=${encodeURIComponent(job.noteId)}` : base;
}
