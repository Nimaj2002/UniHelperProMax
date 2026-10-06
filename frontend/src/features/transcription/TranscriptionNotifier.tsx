/** Global host: notices when a job finishes (in this window, another window, or while the user
 * was away — FR-015), merges the transcript into an open note, and tells the user once. */
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { onAppendSuspected } from "@/features/sessions/autosave";
import { activeKey, fetchJob, fetchUnseen, markSeen, retryTranscription, SETTINGS_PATH, useActiveTranscription, type TranscriptionJob } from "./api";
import { applyFinishedJob, notePath } from "./mergeIntoEditor";

export function TranscriptionNotifier() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const active = useActiveTranscription();
  const handled = useRef(new Set<string>());
  const lastActive = useRef<string | null>(null);

  const finish = useRef((job: TranscriptionJob) => {
    const key = `${job.id}:${job.attempts}:${job.status}`; // a retried job finishes again
    if (handled.current.has(key)) return;
    handled.current.add(key);
    applyFinishedJob(qc, job);
    if (job.status === "completed") {
      const msg = job.fallbackNoteCreated
        ? `The target note was deleted — the transcript was saved as “${job.noteName}”.`
        : `Transcript added to “${job.noteName}”.`;
      toast.success(msg, { action: { label: "Open note", onClick: () => navigate(notePath(job)) } });
    } else if (job.status === "failed") {
      toast.error(`Transcription failed: ${job.errorMessage ?? "Unknown error."}`, {
        duration: 15_000,
        action: job.settingsRelated
          ? { label: "Settings", onClick: () => navigate(SETTINGS_PATH) }
          : {
              label: "Retry",
              onClick: () =>
                void retryTranscription(job.id).then(() => qc.invalidateQueries({ queryKey: activeKey }), () => toast.error("Couldn't retry. Is another transcription running?")),
            },
      });
    }
    if (job.status !== "cancelled") void markSeen(job.id).catch(() => {});
  });

  // finished while the user was away
  useEffect(() => {
    void fetchUnseen().then((jobs) => jobs.forEach((j) => finish.current(j)), () => {});
  }, []);

  // the active job ended (or was replaced): load its final state
  const activeId = active.data?.id ?? null;
  useEffect(() => {
    const prev = lastActive.current;
    lastActive.current = activeId;
    if (prev && prev !== activeId) {
      void fetchJob(prev).then((j) => finish.current(j), () => {});
    }
  }, [activeId]);

  // a save found text appended to a note the running job targets: check now instead of in 2 s
  useEffect(
    () =>
      onAppendSuspected((noteId) => {
        const job = qc.getQueryData<TranscriptionJob | null>(activeKey);
        if (!job || job.noteId !== noteId) return false;
        void qc.invalidateQueries({ queryKey: activeKey });
        return true;
      }),
    [qc],
  );
  return null;
}
