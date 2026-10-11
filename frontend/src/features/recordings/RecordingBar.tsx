import { StopCircle } from "@phosphor-icons/react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { workspacePath } from "@/features/sessions/SessionTimeline";
import { formatDuration, spokenDuration } from "./format";
import { recorder, useRecorderState } from "./recorder";
import { useElapsed } from "./useElapsed";

/** Pill floating over the main card on every screen while recording (FR-006; 008 FR-023). */
export function RecordingBar() {
  const state = useRecorderState();
  const elapsed = useElapsed(state.status === "recording" ? state.startedAt : null);
  if (state.status !== "recording" && state.status !== "stopping") return null;
  return (
    <section
      aria-label="Recording"
      className="pointer-events-auto flex max-w-full min-w-0 items-center gap-2 rounded-full border border-strong-border bg-surface-elevated py-1 pr-1 pl-3 text-sm shadow-[0_6px_20px_var(--shadow-tint)]"
    >
      <span aria-hidden className="size-2.5 shrink-0 animate-pulse rounded-full bg-danger motion-reduce:animate-none" />
      <span className="shrink-0 font-medium">Recording</span>
      <span className="shrink-0 font-mono tabular-nums" aria-label={`Elapsed ${spokenDuration(elapsed)}`}>{formatDuration(elapsed)}</span>
      <span className="min-w-0 truncate text-muted-foreground">{state.label}</span>
      {state.sessionKey && (
        <Button asChild size="sm" variant="ghost" className="h-7 shrink-0 rounded-full">
          <Link to={workspacePath(state.courseId, state.sessionKey)}>Go to session</Link>
        </Button>
      )}
      <Button size="sm" variant="destructive" className="h-7 shrink-0 rounded-full" onClick={() => void recorder().stop()} disabled={state.status === "stopping"}>
        <StopCircle size={16} weight="fill" aria-hidden /> Stop
      </Button>
    </section>
  );
}
