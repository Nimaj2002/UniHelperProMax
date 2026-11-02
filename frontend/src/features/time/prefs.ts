/** The user's time settings (020), with the server defaults until preferences load. */
import { usePreferences, useUpdatePreferences } from "@/features/sessions/api";
import type { Schemas } from "@/lib/api";

type Raw = Schemas["TimePreferences"];
type Nullable = "longRunningHours" | "dailyGoalMin"; // null turns these off
export type TimePrefs = { [K in keyof Raw]-?: K extends Nullable ? number | null : NonNullable<Raw[K]> };

export const TIME_DEFAULTS: TimePrefs = {
  pomodoroWorkMin: 25,
  pomodoroShortMin: 5,
  pomodoroLongMin: 15,
  pomodoroPeriods: 4,
  pomodoroAutoStart: false,
  focusHidePanels: false,
  longRunningHours: 3,
  sound: true,
  systemNotifications: false,
  indicatorCombo: "combined",
  timerBarStyle: "full",
  dailyGoalMin: null,
};

export function useTimePrefs(): TimePrefs {
  const time = usePreferences().data?.time;
  return { ...TIME_DEFAULTS, ...(time ?? {}) } as TimePrefs;
}

export function useSetTimePrefs() {
  const update = useUpdatePreferences();
  const current = useTimePrefs();
  // the whole object, so the optimistic cache update keeps the other settings
  return (patch: Partial<TimePrefs>) => update.mutate({ time: { ...current, ...patch } });
}
