/**
 * Always mounted (020): cross-window sync and the outbox (research R5, R12), the end-of-phase alert
 * scheduled in a worker (R4), the app's focus mode for "Hide panels while focusing" (FR-028), and
 * a polite live region that announces only phase changes and the end (FR-033).
 */
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLayout } from "@/app/shell/layout";
import { matches } from "@/lib/keymap";
import { readLocal, writeLocal } from "@/lib/storage";
import { clockOffset, startOutbox, startSync, useTimer, useTimerActions } from "./api";
import { alertUser, scheduleAlert } from "./alerts";
import { useOpenTime } from "./TimerPill";
import { useTimePrefs } from "./prefs";

const PHASE = { work: "Work", short_break: "Short break", long_break: "Long break" } as const;
const FOCUS_OWNED_KEY = "uh.time.focusOwned";

export function TimeHost() {
  const qc = useQueryClient();
  useEffect(() => {
    const stopSync = startSync(qc);
    const stopOutbox = startOutbox(qc);
    return () => {
      stopSync();
      stopOutbox();
    };
  }, [qc]);

  const timer = useTimer().data ?? null;
  const actions = useTimerActions();
  const prefs = useTimePrefs();
  const openTime = useOpenTime();
  const [message, setMessage] = useState("");
  const latest = useRef({ actions, prefs, openTime });
  useEffect(() => {
    latest.current = { actions, prefs, openTime };
  });

  // ---- the alert at the planned end ---------------------------------------------------------
  const due = timer?.state === "running" && timer.plannedEndAt ? Date.parse(timer.plannedEndAt) - clockOffset() : null;
  const key = timer ? `${timer.startedAt}|${timer.phase ?? "focus"}` : "";
  const phase = timer?.phase ?? null;
  const style = timer?.style;
  useEffect(() => {
    scheduleAlert(due, key, () => {
      const { actions: a, prefs: p, openTime: open } = latest.current;
      const title = style === "focus" ? "Focus session finished" : `${phase ? PHASE[phase] : "Phase"} finished`;
      const next = style === "focus" ? "The time is saved." : phase === "work" ? "Time for a break." : "Time to work.";
      alertUser(title, next, { sound: p.sound, system: p.systemNotifications, onClick: open });
      setMessage(`${title}. ${next}`);
      // another window may have advanced it already: a refetch then shows the new state
      a.advance().catch(() => void qc.invalidateQueries({ queryKey: ["time", "timer"] }));
    });
    return () => scheduleAlert(null, "", () => {});
  }, [due, key, phase, style, qc]);

  // ---- announce stops and phase changes from any window (compared with the last render) ------
  const stateKey = timer ? `${timer.style}|${timer.phase}|${timer.state}` : "none";
  const [lastKey, setLastKey] = useState(stateKey);
  if (lastKey !== stateKey) {
    setLastKey(stateKey);
    if (!timer) setMessage("Timer stopped.");
    else if (timer.state === "waiting") setMessage(`${timer.phase ? PHASE[timer.phase] : ""} next. Start it when you're ready.`);
    else if (timer.state === "running" && timer.phase) setMessage(`${PHASE[timer.phase]} started.`);
  }

  // ---- P3: one key to start a Track timer or stop the running one (editable, 019 keymap) ------
  const running = !!timer;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !matches(e, "time.toggleTimer")) return;
      e.preventDefault();
      const { actions: a } = latest.current;
      void (running ? a.stop() : a.start({ style: "track" }));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [running]);

  // ---- "Hide panels while focusing" (FR-028) -------------------------------------------------
  const layout = useLayout();
  const session = timer?.style === "focus" && timer.hidePanels ? timer.startedAt : null;
  const { focus, toggleFocus } = layout;
  useEffect(() => {
    const owned = readLocal<string | null>(FOCUS_OWNED_KEY, null);
    if (session && owned !== session) {
      // turn focus mode on for this session, once; a layout the user changes meanwhile is kept
      if (!focus) toggleFocus();
      writeLocal(FOCUS_OWNED_KEY, session);
    } else if (!session && owned) {
      if (focus) toggleFocus(); // restore the layout from before the session
      writeLocal(FOCUS_OWNED_KEY, null);
    }
    // only the session starting or ending matters, not later focus changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  return (
    <div role="status" aria-live="polite" className="sr-only" data-testid="time-announcer">
      {message}
    </div>
  );
}
