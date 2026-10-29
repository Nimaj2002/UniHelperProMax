import { ArrowUUpLeft, StopCircle } from "@phosphor-icons/react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { usePreferences } from "@/features/sessions/api";
import { workspacePath } from "@/features/sessions/SessionTimeline";
import { formatDuration, spokenDuration } from "./format";
import { recorder, useRecorderState } from "./recorder";
import { useElapsed } from "./useElapsed";

const PILL = "pointer-events-auto flex max-w-full min-w-0 items-center rounded-full border border-strong-border bg-surface-elevated text-sm shadow-[0_6px_20px_var(--shadow-tint)]";
const DOT = <span aria-hidden className="size-2.5 shrink-0 animate-pulse rounded-full bg-danger motion-reduce:animate-none" />;

/** Pill floating over the main card on every screen while recording (FR-006; 008 FR-023); style set in Settings → Appearance. */
export function RecordingBar() {
  const state = useRecorderState();
  const style = usePreferences().data?.recordingBarStyle ?? "full";
  const elapsed = useElapsed(state.status === "recording" ? state.startedAt : null);
  if (state.status !== "recording" && state.status !== "stopping") return null;
  const back = state.sessionKey ? workspacePath(state.courseId, state.sessionKey) : null;
  const stop = () => void recorder().stop();

  if (style === "minimal" && back) {
    return (
      <Button asChild size="sm" variant="outline" className={`${PILL} h-8 gap-1.5 px-2.5`}>
        <Link to={back} aria-label={`Recording ${spokenDuration(elapsed)}. Go back to session`} title={state.label ?? undefined}>
          {DOT}
          <ArrowUUpLeft size={16} aria-hidden />
        </Link>
      </Button>
    );
  }

  if (style === "compact") {
    return (
      <section aria-label="Recording" className={`${PILL} gap-1.5 py-0.5 pr-0.5 pl-2.5`}>
        {DOT}
        <span className="shrink-0 font-mono text-xs tabular-nums" aria-label={`Elapsed ${spokenDuration(elapsed)}`}>{formatDuration(elapsed)}</span>
        {back && (
          <Button asChild size="icon" variant="ghost" className="size-7 rounded-full">
            <Link to={back} aria-label="Go to session" title="Go to session">
              <ArrowUUpLeft size={16} aria-hidden />
            </Link>
          </Button>
        )}
        <Button size="icon" variant="destructive" className="size-7 rounded-full" aria-label="Stop recording" title="Stop recording" onClick={stop} disabled={state.status === "stopping"}>
          <StopCircle size={16} weight="fill" aria-hidden />
        </Button>
      </section>
    );
  }

  return (
    <section aria-label="Recording" className={`${PILL} gap-2 py-1 pr-1 pl-3`}>
      {DOT}
      <span className="shrink-0 font-medium">Recording</span>
      <span className="shrink-0 font-mono tabular-nums" aria-label={`Elapsed ${spokenDuration(elapsed)}`}>{formatDuration(elapsed)}</span>
      <span className="min-w-0 truncate text-muted-foreground">{state.label}</span>
      {back && (
        <Button asChild size="sm" variant="ghost" className="h-7 shrink-0 rounded-full">
          <Link to={back}>Go to session</Link>
        </Button>
      )}
      <Button size="sm" variant="destructive" className="h-7 shrink-0 rounded-full" onClick={stop} disabled={state.status === "stopping"}>
        <StopCircle size={16} weight="fill" aria-hidden /> Stop
      </Button>
    </section>
  );
}
