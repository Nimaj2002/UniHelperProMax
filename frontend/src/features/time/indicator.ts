/** Which floating indicator shows the running timer (020 FR-032, FR-034). */
import { useRecorderState } from "@/features/recordings/recorder";
import { useTimer, type Timer } from "./api";
import { useTimerCardVisible } from "./cardVisible";
import { useTimePrefs } from "./prefs";

/** The running timer, if its pill should show (not while its card is visible). */
export function useShownTimer(): Timer | null {
  const timer = useTimer().data ?? null;
  const cardVisible = useTimerCardVisible();
  return timer && !cardVisible ? timer : null;
}

/** Whether the timer's indicator takes over the recording pill (combined / recording first). */
export function useTimerOwnsRecordingPill(): boolean {
  const timer = useShownTimer();
  const { status } = useRecorderState();
  const combo = useTimePrefs().indicatorCombo;
  return !!timer && (status === "recording" || status === "stopping") && combo !== "stacked";
}

