/**
 * The timer card at the top of Time mode (020 US1, US4, US5): a Track / Pomodoro / Focus switch,
 * the running timer or the form to start one. Time shown is computed from the server's stored
 * times (research R2); the card publishes its visibility so the floating pill hides (FR-032).
 */
import { ArrowClockwise, Clock, Hourglass, Pause, Play, Plus, SkipForward, Stop, Target, Timer as TimerIcon } from "@phosphor-icons/react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useMe } from "@/features/auth/api";
import { cn } from "@/lib/utils";
import { clockOffset, serverNow, usePendingWrites, useTimer, useTimerActions, type Timer } from "./api";
import { useWatchTimerCard } from "./cardVisible";
import { elapsedMs, formatClock, formatCountdown, remainingMs } from "./clock";
import { fromLocalInput, toLocalInput } from "./days";
import { EntryForm } from "./EntryForm";
import { TIMER_CARD_ID } from "./openTime";
import { useTimePrefs } from "./prefs";
import { TagPicker } from "./TagPicker";
import { useTick } from "./useTick";

export type Style = Timer["style"];
const STYLE_LABEL: Record<Style, string> = { track: "Track", pomodoro: "Pomodoro", focus: "Focus" };
export const STYLE_ICON = { track: TimerIcon, pomodoro: Hourglass, focus: Target } as const;
const PHASE_LABEL = { work: "Work", short_break: "Short break", long_break: "Long break" } as const;
const PRESETS = [25, 45, 60, 90];

/** "Work 2 of 4", "Short break", "Focus" … */
export function phaseLabel(t: Timer, periods: number): string {
  if (t.style === "pomodoro" && t.phase) return t.phase === "work" ? `Work ${t.period} of ${periods}` : PHASE_LABEL[t.phase];
  return STYLE_LABEL[t.style];
}

/** Elapsed for Track, remaining for Pomodoro and Focus (FR-030). */
export function timerDisplay(t: Timer, now: number): string {
  const off = clockOffset();
  if (t.state === "waiting") return "0:00";
  return t.style === "track" ? formatClock(elapsedMs(t, now, off)) : formatCountdown(remainingMs(t, now, off));
}

/** The long-running reminder is due (FR-013): past the next multiple of the threshold. */
export function reminderDue(t: Timer, hours: number | null, now: number): number | null {
  if (!hours || t.state !== "running") return null;
  const passed = Math.floor(elapsedMs(t, now, clockOffset()) / (hours * 3_600_000));
  return passed > t.reminderAck ? passed : null;
}

export function TimerCard() {
  const timer = useTimer().data ?? null;
  const actions = useTimerActions();
  const prefs = useTimePrefs();
  const pending = usePendingWrites();
  const now = useTick(!!timer);
  const [el, setEl] = useState<HTMLElement | null>(null);
  useWatchTimerCard(timer ? el : null);
  const [tab, setTab] = useState<Style>(timer?.style ?? "track");
  const [adding, setAdding] = useState(false);
  // follow the running timer's style when it changes (another window, Start again)
  const runningStyle = timer?.style;
  const [lastStyle, setLastStyle] = useState(runningStyle);
  if (lastStyle !== runningStyle) {
    setLastStyle(runningStyle);
    if (runningStyle) setTab(runningStyle);
  }

  const showRunning = timer && timer.style === tab;
  const reminder = timer ? reminderDue(timer, prefs.longRunningHours, now) : null;

  return (
    <section ref={setEl} id={TIMER_CARD_ID} tabIndex={-1} aria-label="Timer" className="flex flex-col gap-2 rounded-xl border border-strong-border bg-surface-elevated p-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <div className="flex items-center gap-2">
        <ToggleGroup type="single" variant="outline" size="sm" value={tab} onValueChange={(v) => v && setTab(v as Style)} aria-label="Timer style" className="h-7">
          {(Object.keys(STYLE_LABEL) as Style[]).map((s) => (
            <ToggleGroupItem key={s} value={s} className="h-7 px-2 text-xs">
              {STYLE_LABEL[s]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Button variant="ghost" size="sm" className="ml-auto h-7 gap-1 px-2 text-xs" onClick={() => setAdding(true)}>
          <Plus size={14} aria-hidden /> Add time
        </Button>
      </div>

      {timer && !showRunning && (
        <p className="flex items-center gap-1.5 text-xs text-text-muted">
          <Clock size={12} aria-hidden /> Running: {STYLE_LABEL[timer.style]} {timerDisplay(timer, now)} — starting another stops it.
        </p>
      )}

      {reminder !== null && timer && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-strong-border bg-surface-sunken px-2 py-1.5 text-sm">
          <span className="font-medium">Still working?</span>
          <Button size="sm" variant="outline" className="h-7" onClick={() => void actions.patch({ reminderAck: reminder })}>
            Keep running
          </Button>
          <Button size="sm" variant="destructive" className="h-7" onClick={() => void actions.stop()}>
            Stop
          </Button>
        </div>
      )}

      {showRunning ? (
        <Running timer={timer} now={now} periods={prefs.pomodoroPeriods} />
      ) : tab === "focus" ? (
        <FocusStart hideDefault={prefs.focusHidePanels} />
      ) : (
        <SimpleStart style={tab} />
      )}

      {pending > 0 && (
        <p role="status" className="flex items-center gap-2 text-xs text-warning">
          Not saved yet — retrying.
        </p>
      )}
      {adding && <EntryForm onClose={() => setAdding(false)} />}
    </section>
  );
}

// ---- starting -------------------------------------------------------------------------------

function DescriptionTag({ description, setDescription, tagId, setTagId, placeholder }: {
  description: string;
  setDescription: (v: string) => void;
  tagId: string | null;
  setTagId: (v: string | null) => void;
  placeholder: string;
}) {
  return (
    <div className="flex min-w-0 gap-1.5">
      <Input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder={placeholder}
        aria-label="Description"
        maxLength={500}
        className="h-8 min-w-0 flex-1"
      />
      <TagPicker value={tagId} onChange={setTagId} className="max-w-[40%]" />
    </div>
  );
}

function SimpleStart({ style }: { style: Style }) {
  const actions = useTimerActions();
  const [description, setDescription] = useState("");
  const [tagId, setTagId] = useState<string | null>(null);
  const start = () => {
    void actions.start({ style, description, tagId });
    setDescription("");
  };
  return (
    <form className="flex flex-col gap-2" onSubmit={(e) => (e.preventDefault(), start())}>
      <DescriptionTag description={description} setDescription={setDescription} tagId={tagId} setTagId={setTagId} placeholder="What are you working on?" />
      <Button type="submit" size="sm" className="h-8 gap-1.5 self-start">
        <Play size={14} weight="fill" aria-hidden /> Start {style === "pomodoro" ? "Pomodoro" : "timer"}
      </Button>
    </form>
  );
}

function FocusStart({ hideDefault }: { hideDefault: boolean }) {
  const actions = useTimerActions();
  const [minutes, setMinutes] = useState(25);
  const [custom, setCustom] = useState("");
  const [goal, setGoal] = useState("");
  const [tagId, setTagId] = useState<string | null>(null);
  const [hide, setHide] = useState(hideDefault);
  const customN = Number(custom);
  const length = custom ? customN : minutes;
  const valid = Number.isInteger(length) && length >= 1 && length <= 480;
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) void actions.start({ style: "focus", focusMinutes: length, goal, tagId, hidePanels: hide });
      }}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <ToggleGroup type="single" variant="outline" size="sm" value={custom ? "" : String(minutes)} onValueChange={(v) => v && (setMinutes(Number(v)), setCustom(""))} aria-label="Length in minutes" className="h-7">
          {PRESETS.map((m) => (
            <ToggleGroupItem key={m} value={String(m)} className="h-7 px-2 text-xs" aria-label={`${m} minutes`}>
              {m}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Input
          type="number"
          inputMode="numeric"
          min={1}
          max={480}
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="Custom"
          aria-label="Custom length in minutes (1 to 480)"
          aria-invalid={!!custom && !valid}
          className="h-7 w-20 text-xs"
        />
        <span className="text-xs text-text-muted">min</span>
      </div>
      {!!custom && !valid && <p className="text-xs text-danger">Choose 1 to 480 minutes.</p>}
      <div className="flex min-w-0 gap-1.5">
        <Input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Goal (optional)" aria-label="Goal" maxLength={200} className="h-8 min-w-0 flex-1" />
        <TagPicker value={tagId} onChange={setTagId} className="max-w-[40%]" />
      </div>
      <Label className="flex items-center gap-2 text-xs font-normal">
        <Checkbox checked={hide} onCheckedChange={(v) => setHide(v === true)} /> Hide panels while focusing
      </Label>
      <Button type="submit" size="sm" className="h-8 gap-1.5 self-start" disabled={!valid}>
        <Play size={14} weight="fill" aria-hidden /> Start focus session
      </Button>
      <p className="text-xs text-text-muted">The app can't block other apps or websites.</p>
    </form>
  );
}

// ---- running --------------------------------------------------------------------------------

function Running({ timer, now, periods }: { timer: Timer; now: number; periods: number }) {
  const actions = useTimerActions();
  const [description, setDescription] = useState(timer.description);
  const [savedDescription, setSavedDescription] = useState(timer.description);
  if (savedDescription !== timer.description) {
    // changed elsewhere (another window, the pill): show the saved value
    setSavedDescription(timer.description);
    setDescription(timer.description);
  }
  const Icon = STYLE_ICON[timer.style];
  const paused = timer.state === "paused";
  const waiting = timer.state === "waiting";
  const saveDescription = () => {
    if (description.trim() !== timer.description) void actions.patch({ description });
  };
  const nextName = timer.phase ? PHASE_LABEL[timer.phase].toLowerCase() : "";

  const buttons: ReactNode[] = [];
  if (waiting) {
    buttons.push(
      <Button key="next" size="sm" className="h-8 gap-1.5" onClick={() => void actions.advance()}>
        <Play size={14} weight="fill" aria-hidden /> Start {nextName}
      </Button>,
    );
  } else if (timer.style !== "track") {
    buttons.push(
      paused ? (
        <Button key="resume" size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => void actions.resume()}>
          <Play size={14} aria-hidden /> Resume
        </Button>
      ) : (
        <Button key="pause" size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => void actions.pause()}>
          <Pause size={14} aria-hidden /> Pause
        </Button>
      ),
    );
  }
  if (timer.style === "pomodoro") {
    buttons.push(
      <Button key="skip" size="sm" variant="ghost" className="h-8 gap-1.5" onClick={() => void actions.skip()}>
        <SkipForward size={14} aria-hidden /> Skip
      </Button>,
      <Button key="reset" size="sm" variant="ghost" className="h-8 gap-1.5" onClick={() => void actions.reset()}>
        <ArrowClockwise size={14} aria-hidden /> Reset
      </Button>,
    );
  }
  if (timer.style === "focus") {
    buttons.push(
      <Button key="extend" size="sm" variant="ghost" className="h-8" onClick={() => void actions.extend()} disabled={(timer.focusMinutes ?? 0) + 5 > 480}>
        +5 min
      </Button>,
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Icon size={18} aria-hidden className="shrink-0 text-text-muted" />
        <div className="min-w-0">
          <p className="text-xs text-text-muted">{phaseLabel(timer, periods)}{paused && " · Paused"}{waiting && " · Done"}</p>
          <p className={cn("font-mono text-2xl tabular-nums", paused && "text-text-muted")} aria-hidden>
            {timerDisplay(timer, now)}
          </p>
        </div>
        {timer.linkTitle && <span className="ml-auto truncate text-xs text-text-muted">{timer.linkTitle}</span>}
      </div>
      {timer.goal && <p className="text-sm">Goal: {timer.goal}</p>}
      <div className="flex min-w-0 gap-1.5">
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={saveDescription}
          onKeyDown={(e) => e.key === "Enter" && saveDescription()}
          placeholder="What are you working on?"
          aria-label="Description"
          maxLength={500}
          className="h-8 min-w-0 flex-1"
        />
        <TagPicker value={timer.tagId ?? null} onChange={(tagId) => void actions.patch({ tagId })} className="max-w-[40%]" />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {buttons}
        <Button size="sm" variant="destructive" className="h-8 gap-1.5" onClick={() => void actions.stop()}>
          <Stop size={14} weight="fill" aria-hidden /> {timer.style === "focus" ? "Finish" : "Stop"}
        </Button>
        <SetEnd timer={timer} />
      </div>
    </div>
  );
}

/** "Stop and set end time" (FR-008): for a timer left running, e.g. found when the app opens. */
function SetEnd({ timer }: { timer: Timer }) {
  const actions = useTimerActions();
  const tz = useMe().data?.timezone ?? "UTC";
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [openedAt, setOpenedAt] = useState(0); // server time when the pop-up opened
  const start = Date.parse(timer.startedAt);
  const end = fromLocalInput(value, tz);
  // the minute picked can't be later than the minute the pop-up opened in
  const error = !value ? null : Number.isNaN(end) ? "Enter a time." : end <= start ? "The end must be after the start." : end > openedAt + 60_000 ? "The end can't be in the future." : null;
  const onOpenChange = (o: boolean) => {
    setOpen(o);
    if (!o) return;
    const now = serverNow();
    setOpenedAt(now);
    setValue(toLocalInput(now, tz));
  };
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="h-8 text-xs">
          Stop and set end time
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64" align="start">
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!error && value) void actions.setEnd(new Date(Math.min(end, serverNow())).toISOString()).then(() => setOpen(false));
          }}
        >
          <Label htmlFor="time-set-end">End time</Label>
          <Input id="time-set-end" type="datetime-local" value={value} min={toLocalInput(start, tz)} onChange={(e) => setValue(e.target.value)} aria-invalid={!!error} />
          {error && <p className="text-xs text-danger">{error}</p>}
          <Button type="submit" size="sm" disabled={!!error || !value}>
            Stop at this time
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
