/**
 * Settings → Time (020): Pomodoro lengths and automatic start, the long-running reminder, alert
 * sound and system notifications (the permission explained before asking), the indicator when a
 * recording and a timer run together, and the daily goal. Saved to the account.
 */
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { askNotificationPermission, notificationPermission } from "@/features/time/alerts";
import { useSetTimePrefs, useTimePrefs, type TimePrefs } from "@/features/time/prefs";

type NumberKey = "pomodoroWorkMin" | "pomodoroShortMin" | "pomodoroLongMin" | "pomodoroPeriods";
const NUMBERS: { key: NumberKey; label: string; min: number; max: number; unit: string }[] = [
  { key: "pomodoroWorkMin", label: "Work period", min: 1, max: 120, unit: "min" },
  { key: "pomodoroShortMin", label: "Short break", min: 1, max: 60, unit: "min" },
  { key: "pomodoroLongMin", label: "Long break", min: 1, max: 120, unit: "min" },
  { key: "pomodoroPeriods", label: "Work periods before the long break", min: 2, max: 8, unit: "" },
];

const COMBOS: { id: TimePrefs["indicatorCombo"]; name: string; hint: string }[] = [
  { id: "combined", name: "One combined indicator", hint: "The recording and the timer side by side, each with its own controls." },
  { id: "stacked", name: "Two indicators, stacked", hint: "The recording indicator above the timer's." },
  { id: "recording_first", name: "Recording first", hint: "Only the recording indicator, with a small badge for the timer's time." },
];

/** A number field saved on blur when it is in range; otherwise it says the range. */
function NumberField({ id, label, value, min, max, unit, onSave }: { id: string; label: string; value: number; min: number; max: number; unit: string; onSave: (n: number) => void }) {
  const [text, setText] = useState(String(value));
  const [last, setLast] = useState(value);
  if (last !== value) {
    setLast(value);
    setText(String(value));
  }
  const n = Number(text);
  const valid = Number.isInteger(n) && n >= min && n <= max;
  return (
    <div className="grid gap-1">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={text}
          aria-invalid={!valid}
          aria-describedby={`${id}-range`}
          className="h-8 w-24"
          onChange={(e) => setText(e.target.value)}
          onBlur={() => (valid && n !== value ? onSave(n) : !valid && setText(String(value)))}
        />
        {unit && <span className="text-sm text-muted-foreground">{unit}</span>}
      </div>
      <span id={`${id}-range`} className={valid ? "text-xs text-muted-foreground" : "text-xs text-danger"}>
        {min} to {max}
        {unit && ` ${unit}`}
      </span>
    </div>
  );
}

function Section({ id, title, hint, children }: { id: string; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="grid gap-4 rounded-xl border border-divider p-4 sm:p-6">
      <div className="grid gap-1">
        <h3 id={id} className="text-base font-semibold">{title}</h3>
        {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function SwitchRow({ id, label, hint, checked, onChange }: { id: string; label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <Label htmlFor={id} className="grid gap-1 font-normal">
        <span className="font-medium">{label}</span>
        {hint && <span className="text-sm text-muted-foreground">{hint}</span>}
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

export function TimeSettings() {
  const prefs = useTimePrefs();
  const save = useSetTimePrefs();
  const [permission, setPermission] = useState(notificationPermission);

  const setNotifications = async (on: boolean) => {
    if (!on) return save({ systemNotifications: false });
    const result = permission === "granted" ? "granted" : await askNotificationPermission();
    setPermission(result);
    save({ systemNotifications: result === "granted" });
  };

  return (
    <div className="grid gap-6">
      <header className="grid gap-1">
        <h2 className="text-lg font-semibold">Time</h2>
        <p className="text-sm text-muted-foreground">The study timer in the home page's right panel. Saved to your account and used on every device.</p>
      </header>

      <Section id="time-pomodoro" title="Pomodoro">
        <div className="grid gap-4 sm:grid-cols-2">
          {NUMBERS.map((f) => (
            <NumberField key={f.key} id={`time-${f.key}`} label={f.label} value={prefs[f.key]} min={f.min} max={f.max} unit={f.unit} onSave={(n) => save({ [f.key]: n })} />
          ))}
        </div>
        <SwitchRow id="time-auto-start" label="Start the next phase automatically" hint="Otherwise the timer waits for you after each work period and break." checked={prefs.pomodoroAutoStart} onChange={(v) => save({ pomodoroAutoStart: v })} />
      </Section>

      <Section id="time-reminder" title="Long-running reminder" hint="Asks “Still working?” when a timer has run this long, once each time it passes.">
        <SwitchRow id="time-reminder-on" label="Remind me" checked={prefs.longRunningHours !== null} onChange={(v) => save({ longRunningHours: v ? 3 : null })} />
        {prefs.longRunningHours !== null && (
          <NumberField id="time-reminder-hours" label="After" value={prefs.longRunningHours} min={1} max={12} unit="hours" onSave={(n) => save({ longRunningHours: n })} />
        )}
      </Section>

      <Section id="time-alerts" title="Alerts" hint="At the end of a Pomodoro phase or a Focus session.">
        <SwitchRow id="time-sound" label="Sound" checked={prefs.sound} onChange={(v) => save({ sound: v })} />
        <SwitchRow
          id="time-notifications"
          label="System notifications"
          hint="Shows a notification from your system when the app isn't in front, so you notice the end of a phase while working elsewhere. Your browser or system asks for permission the first time."
          checked={prefs.systemNotifications && permission === "granted"}
          onChange={(v) => void setNotifications(v)}
        />
        {permission === "denied" && (
          <p role="status" className="text-sm text-warning">
            Notifications are blocked for this app. Allow them in your browser or system settings; the sound and the message in the app still work.
          </p>
        )}
        {permission === "unsupported" && <p className="text-sm text-muted-foreground">System notifications aren't available here; the sound and the message in the app still work.</p>}
      </Section>

      <Section id="time-indicator" title="Indicator when recording and timer run together" hint="A recording is never hidden or stopped by a timer.">
        <RadioGroup value={prefs.indicatorCombo} onValueChange={(v) => save({ indicatorCombo: v as TimePrefs["indicatorCombo"] })} aria-labelledby="time-indicator" className="grid gap-3 sm:grid-cols-3">
          {COMBOS.map(({ id, name, hint }) => (
            <div key={id} className="flex items-start gap-2 rounded-lg border border-divider bg-surface-elevated p-3 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:ring-1 has-[[data-state=checked]]:ring-primary">
              <RadioGroupItem value={id} id={`time-combo-${id}`} className="mt-1" />
              <Label htmlFor={`time-combo-${id}`} className="grid cursor-pointer gap-1 font-normal">
                <span className="font-medium">{name}</span>
                <span className="text-sm text-muted-foreground">{hint}</span>
              </Label>
            </div>
          ))}
        </RadioGroup>
      </Section>

      <Section id="time-goal" title="Daily goal" hint="Today in Time mode shows your progress.">
        <SwitchRow id="time-goal-on" label="Set a daily goal" checked={prefs.dailyGoalMin !== null} onChange={(v) => save({ dailyGoalMin: v ? 240 : null })} />
        {prefs.dailyGoalMin !== null && (
          <NumberField id="time-goal-min" label="Goal" value={prefs.dailyGoalMin} min={1} max={1440} unit="min" onSave={(n) => save({ dailyGoalMin: n })} />
        )}
      </Section>
    </div>
  );
}
