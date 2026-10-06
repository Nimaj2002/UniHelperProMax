import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { workspacePath } from "@/features/sessions/SessionTimeline";
import { useActiveTranscription } from "./api";
import { RunningJob } from "./TranscriptionStatus";

/** Activity-bar item on every screen while a transcription runs (FR-013, FR-014). */
export function TranscriptionBar() {
  const { data: job } = useActiveTranscription();
  if (!job) return null;
  return (
    <section aria-label="Transcription" className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
      <span className="font-medium">Transcribing</span>
      <span className="min-w-0 truncate text-muted-foreground">
        {job.recordingName} → {job.noteName}
      </span>
      <div className="w-48 max-w-full">
        <RunningJob job={job} compact />
      </div>
      <span className="ml-auto flex gap-2">
        <Button asChild size="sm" variant="outline">
          <Link to={workspacePath(job.courseId, job.sessionKey)}>Go to session</Link>
        </Button>
      </span>
    </section>
  );
}
