import { StopCircle } from "@phosphor-icons/react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { workspacePath } from "@/features/sessions/SessionTimeline";
import { formatDuration, spokenDuration } from "./format";
import { recorder, useRecorderState } from "./recorder";
import { useElapsed } from "./useElapsed";

/** Global recording bar on every screen while recording (FR-006, clarified A). */
export function RecordingBar() {
  const state = useRecorderState();
  const elapsed = useElapsed(state.status === "recording" ? state.startedAt : null);
  if (state.status !== "recording" && state.status !== "stopping") return null;
  return (
    <section aria-label="Recording" className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
      <span aria-hidden className="size-2.5 animate-pulse rounded-full bg-danger motion-reduce:animate-none" />
      <span className="font-medium">Recording</span>
      <span className="font-mono tabular-nums" aria-label={`Elapsed ${spokenDuration(elapsed)}`}>{formatDuration(elapsed)}</span>
      <span className="min-w-0 truncate text-muted-foreground">{state.label}</span>
      <span className="ml-auto flex gap-2">
        {state.courseId && state.sessionKey && (
          <Button asChild size="sm" variant="outline">
            <Link to={workspacePath(state.courseId, state.sessionKey)}>Go to session</Link>
          </Button>
        )}
        <Button size="sm" variant="destructive" onClick={() => void recorder().stop()} disabled={state.status === "stopping"}>
          <StopCircle size={16} weight="fill" aria-hidden /> Stop
        </Button>
      </span>
    </section>
  );
}
