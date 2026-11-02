/**
 * The floating timer indicator (020 FR-030–FR-035): same look and place as the recording pill, on
 * every page while a timer runs, hidden only while the timer card is on screen. With a recording
 * running too, the user's setting decides: one combined indicator, two stacked, or recording first
 * with a small badge for the timer. A recording is never hidden by a timer.
 */
import { Pause, Play, Stop } from "@phosphor-icons/react";
import { useNavigate, useLocation } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { RecordingBar } from "@/features/recordings/RecordingBar";
import { useTags, useTimerActions, type Timer } from "./api";
import { useShownTimer, useTimerOwnsRecordingPill } from "./indicator";
import { TIME_HREF, requestTimePanel } from "./openTime";
import { useTimePrefs, type TimePrefs } from "./prefs";
import { phaseLabel, reminderDue, STYLE_ICON, timerDisplay } from "./TimerCard";
import { useTick } from "./useTick";

export const PILL = "pointer-events-auto flex max-w-full min-w-0 items-center rounded-full border border-strong-border bg-surface-elevated text-sm shadow-[0_6px_20px_var(--shadow-tint)]";

/** Go to Time mode in the home page's right panel (FR-031). */
export function useOpenTime(): () => void {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  return () => {
    requestTimePanel();
    if (pathname !== "/") navigate(TIME_HREF);
  };
}

export type TimerBarStyle = TimePrefs["timerBarStyle"];

/** The timer part of the pill; `style` overrides the setting (Settings → Time preview). */
export function TimerPart({ timer, style: forced }: { timer: Timer; style?: TimerBarStyle }) {
  const actions = useTimerActions();
  const prefs = useTimePrefs();
  const tags = useTags().data ?? [];
  const now = useTick(true);
  const open = useOpenTime();
  const Icon = STYLE_ICON[timer.style];
  const tag = tags.find((t) => t.id === timer.tagId);
  const label = timer.description || timer.linkTitle || tag?.name || phaseLabel(timer, prefs.pomodoroPeriods);
  const paused = timer.state === "paused";
  const reminder = reminderDue(timer, prefs.longRunningHours, now);
  const style = forced ?? prefs.timerBarStyle;

  const pause = () => {
    if (timer.style !== "track") return void (paused ? actions.resume() : actions.pause());
    // research R7: a Track pause saves the entry; Resume starts again with the same fields
    const again = { style: "track" as const, description: timer.description, tagId: timer.tagId, taskId: timer.taskId, sessionKey: timer.sessionKey, courseId: timer.taskId || timer.sessionKey ? null : timer.courseId };
    void actions.pause().then(() => toast("Paused. The time so far is saved.", { duration: 600_000, action: { label: "Resume", onClick: () => void actions.start(again) } }));
  };

  return (
    <>
      <button
        type="button"
        onClick={open}
        className={`flex min-w-0 items-center gap-2 rounded-full py-1 pl-3 ${style === "minimal" && reminder === null ? "pr-3" : "pr-1"} text-left outline-none focus-visible:ring-2 focus-visible:ring-ring`}
        aria-label={`${phaseLabel(timer, prefs.pomodoroPeriods)} timer${paused ? ", paused" : ""}: ${label}. Open Time`}
      >
        <Icon size={16} aria-hidden className="shrink-0" />
        <span className="shrink-0 font-mono tabular-nums" aria-hidden>
          {timerDisplay(timer, now)}
        </span>
        {style === "full" && (
          <span className="min-w-0 max-w-[14rem] truncate text-muted-foreground" aria-hidden>
            {label}
          </span>
        )}
      </button>
      {reminder !== null ? (
        <span className="flex shrink-0 items-center gap-1 pr-1" role="group" aria-label="Still working?">
          {style === "full" && <span className="text-xs font-medium">Still working?</span>}
          <Button size="sm" variant="outline" className="h-7 rounded-full" onClick={() => void actions.patch({ reminderAck: reminder })}>
            Keep running
          </Button>
        </span>
      ) : (
        style !== "minimal" && timer.state !== "waiting" && (
          <Button size="icon" variant="ghost" className="size-7 shrink-0 rounded-full" aria-label={paused ? "Resume timer" : "Pause timer"} title={paused ? "Resume" : "Pause"} onClick={pause}>
            {paused ? <Play size={16} aria-hidden /> : <Pause size={16} aria-hidden />}
          </Button>
        )
      )}
      {style !== "minimal" && (
        <Button size="icon" variant="destructive" className="mr-0.5 size-7 shrink-0 rounded-full" aria-label="Stop timer" title="Stop timer" onClick={() => void actions.stop()}>
          <Stop size={16} weight="fill" aria-hidden />
        </Button>
      )}
    </>
  );
}

export function Badge({ timer }: { timer: Timer }) {
  const now = useTick(true);
  const Icon = STYLE_ICON[timer.style];
  return (
    <span className="flex items-center gap-1 rounded-full bg-surface-sunken px-1.5 py-0.5 font-mono text-xs tabular-nums">
      <Icon size={12} aria-hidden />
      <span aria-hidden>{timerDisplay(timer, now)}</span>
      <span className="sr-only">Timer running</span>
    </span>
  );
}

/** The activity registered next to the recording pill. */
export function TimeBar() {
  const timer = useShownTimer();
  const owns = useTimerOwnsRecordingPill();
  const combo = useTimePrefs().indicatorCombo;
  if (!timer) return null;
  if (owns && combo === "recording_first") return <RecordingBar embedded badge={<Badge timer={timer} />} />;
  if (owns) {
    return (
      <section aria-label="Recording and timer" className="pointer-events-auto flex max-w-full min-w-0 flex-wrap items-center justify-center gap-2">
        <RecordingBar embedded />
        <section aria-label="Timer" className={PILL}>
          <TimerPart timer={timer} />
        </section>
      </section>
    );
  }
  return (
    <section aria-label="Timer" className={PILL}>
      <TimerPart timer={timer} />
    </section>
  );
}
