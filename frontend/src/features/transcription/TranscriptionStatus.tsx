import { CheckCircle, WarningCircle, XCircle } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { formatDuration } from "@/features/recordings/format";
import type { RecordingExtensionProps } from "@/features/recordings/extensions";
import { useElapsed } from "@/features/recordings/useElapsed";
import { formatDay } from "@/lib/dates";
import {
  activeKey, cancelTranscription, historyKey, isActive, retryTranscription, SETTINGS_PATH, useActiveTranscription,
  useSessionTranscriptions, type TranscriptionJob,
} from "./api";
import { notePath } from "./mergeIntoEditor";
import { announcement, stageLabel } from "./progress";

function day(iso: string | null) {
  return iso ? formatDay(iso.slice(0, 10), "d MMM") : "";
}

/** Cancels a running job (FR-014); the active job's state refreshes either way. */
export function useCancelTranscription(job: TranscriptionJob) {
  const qc = useQueryClient();
  return async () => {
    try {
      qc.setQueryData(activeKey, await cancelTranscription(job.id));
    } finally {
      void qc.invalidateQueries({ queryKey: activeKey });
    }
  };
}

export function RunningJob({ job, compact = false }: { job: TranscriptionJob; compact?: boolean }) {
  const since = job.stageStartedAt ? Date.parse(job.stageStartedAt) : null;
  const elapsed = useElapsed(job.status === "transcribing" ? since : null);
  const label = stageLabel(job);
  const cancel = useCancelTranscription(job);
  return (
    <div className="grid min-w-0 gap-1">
      <div className="flex min-w-0 items-center gap-2 text-xs">
        <span className="min-w-0 truncate font-medium">{label}</span>
        {job.status === "transcribing" && <span className="font-mono tabular-nums text-muted-foreground">{formatDuration(elapsed)}</span>}
        {!compact && (
          <Button size="sm" variant="ghost" className="ml-auto h-7" onClick={() => void cancel()} disabled={job.cancelRequested || job.status === "appending"}>
            {job.cancelRequested ? "Cancelling…" : "Cancel"}
          </Button>
        )}
      </div>
      <Progress value={Math.round((job.progress ?? 0) * 100)} aria-label="Transcription progress" aria-valuetext={label} className="h-1.5" />
      <span className="sr-only" aria-live="polite">{announcement(job)}</span>
    </div>
  );
}

/** Under each recording: the latest transcription's state and history (FR-013, FR-016, FR-023). */
export function TranscriptionStatus({ recording, sessionKey }: RecordingExtensionProps) {
  const qc = useQueryClient();
  const active = useActiveTranscription();
  const history = useSessionTranscriptions(sessionKey);
  const [showEarlier, setShowEarlier] = useState(false);
  const [retryError, setRetryError] = useState<string>();
  const mine = (history.data ?? []).filter((j) => j.recordingId === recording.id);
  const running = active.data && active.data.recordingId === recording.id ? active.data : null;
  if (running) return <RunningJob job={running} />;
  const latest = mine.find((j) => !isActive(j));
  if (!latest) return null;

  const retry = async () => {
    setRetryError(undefined);
    try {
      qc.setQueryData(activeKey, await retryTranscription(latest.id));
      void qc.invalidateQueries({ queryKey: historyKey(sessionKey) });
    } catch {
      setRetryError("Couldn't retry. Another transcription may be running.");
    }
  };

  if (latest.status === "failed" || latest.status === "cancelled") {
    return (
      <div className="grid gap-1 text-xs">
        <p className="flex items-start gap-1.5">
          {latest.status === "failed" ? <WarningCircle size={14} className="mt-0.5 shrink-0 text-danger" aria-hidden /> : <XCircle size={14} className="mt-0.5 shrink-0" aria-hidden />}
          <span>{latest.status === "failed" ? `Transcription failed: ${latest.errorMessage ?? "Unknown error."}` : "Transcription cancelled."}</span>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" className="h-7" onClick={() => void retry()} disabled={Boolean(active.data)}>
            Retry
          </Button>
          {latest.settingsRelated && (
            <Link to={SETTINGS_PATH} className="text-primary underline underline-offset-4">Open Settings → Transcription</Link>
          )}
        </div>
        {retryError && <p role="alert" className="text-danger">{retryError}</p>}
      </div>
    );
  }

  const completed = mine.filter((j) => j.status === "completed");
  const [first, ...earlier] = completed;
  if (!first) return null;
  const item = (j: TranscriptionJob) => (
    <span className="flex min-w-0 items-center gap-1.5">
      <CheckCircle size={14} className="shrink-0 text-success" aria-hidden />
      <span className="shrink-0">Transcribed →</span>
      <Link to={notePath(j)} className="min-w-0 truncate text-primary underline underline-offset-4" title={j.noteName}>{j.noteName}</Link>
      <span className="shrink-0 text-muted-foreground">· {day(j.finishedAt)}</span>
    </span>
  );
  return (
    <div className="grid gap-1 text-xs">
      {item(first)}
      {earlier.length > 0 && (
        <>
          <button type="button" className="justify-self-start text-muted-foreground underline underline-offset-4" aria-expanded={showEarlier} onClick={() => setShowEarlier((v) => !v)}>
            {showEarlier ? "Hide earlier" : `+${earlier.length} earlier`}
          </button>
          {showEarlier && <div className="grid gap-1">{earlier.map((j) => <div key={j.id}>{item(j)}</div>)}</div>}
        </>
      )}
    </div>
  );
}
