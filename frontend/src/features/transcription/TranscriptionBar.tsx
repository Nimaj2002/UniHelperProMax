import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { workspacePath } from "@/features/sessions/SessionTimeline";
import { useActiveTranscription } from "./api";
import { RunningJob, useCancelTranscription } from "./TranscriptionStatus";
import type { TranscriptionJob } from "./api";

function Pill({ job }: { job: TranscriptionJob }) {
  const cancel = useCancelTranscription(job);
  return (
    <section
      aria-label="Transcription"
      className="pointer-events-auto flex max-w-full min-w-0 items-center gap-2 rounded-full border border-strong-border bg-surface-elevated py-1 pr-1 pl-3 text-sm shadow-[0_6px_20px_var(--shadow-tint)]"
    >
      <span className="shrink-0 font-medium">Transcribing</span>
      <span className="min-w-0 truncate text-muted-foreground">
        {job.recordingName} → {job.noteName}
      </span>
      <div className="w-24 shrink-0">
        <RunningJob job={job} compact />
      </div>
      <Button asChild size="sm" variant="ghost" className="h-7 shrink-0 rounded-full">
        <Link to={workspacePath(job.courseId, job.sessionKey)}>Go to session</Link>
      </Button>
      <Button size="sm" variant="outline" className="h-7 shrink-0 rounded-full" onClick={() => void cancel()} disabled={job.cancelRequested || job.status === "appending"}>
        {job.cancelRequested ? "Cancelling…" : "Cancel"}
      </Button>
    </section>
  );
}

/** Pill floating over the main card on every screen while a transcription runs (FR-013, FR-014; 008 FR-023). */
export function TranscriptionBar() {
  const { data: job } = useActiveTranscription();
  return job ? <Pill job={job} /> : null;
}
