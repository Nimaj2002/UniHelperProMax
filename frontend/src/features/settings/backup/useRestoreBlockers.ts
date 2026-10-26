/**
 * 016 FR-017: what on this device keeps a restore from starting — the same signals the close
 * guards use. The server refuses too (`restore_blocked`), for work it can see.
 */
import { createElement, Fragment, useEffect, useState, useSyncExternalStore } from "react";
import { useActivitySignals, type ActivitySignal } from "@/app/shell/registry";
import { recorder, useRecorderState } from "@/features/recordings/recorder";
import { hasUnsaved } from "@/features/sessions/autosave";

export interface Blocker {
  key: string;
  message: string;
}

export const BLOCKER_MESSAGES = {
  recording: "Stop the recording first.",
  audio: "Wait until your recording audio is saved.",
  notes: "Wait until your notes are saved.",
  work: "Wait until it finishes or stop it.",
} as const;

// activity signals are hooks: each one runs in its own probe component
const running = new Map<string, boolean>();
const listeners = new Set<() => void>();
let version = 0;
function report(id: string, active: boolean) {
  if (running.get(id) === active) return;
  running.set(id, active);
  version += 1;
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

function Probe({ signal }: { signal: ActivitySignal }) {
  const active = signal.useActive();
  useEffect(() => {
    report(signal.id, active);
    return () => report(signal.id, false);
  }, [signal.id, active]);
  return null;
}

/** Render once where the blockers are needed: it feeds transcription signals to the hook. */
export function RestoreBlockerProbes() {
  const signals = useActivitySignals().filter((s) => s.kind === "transcription" || s.kind === "answer");
  return createElement(Fragment, null, ...signals.map((s) => createElement(Probe, { key: s.id, signal: s })));
}

export function useRestoreBlockers(): Blocker[] {
  const rec = recorder();
  const { status } = useRecorderState(rec);
  const audioPending = useSyncExternalStore(rec.uploader.subscribe, () => rec.uploader.anyPending, () => false);
  useSyncExternalStore(subscribe, () => version, () => version);
  const [unsaved, setUnsaved] = useState(hasUnsaved);
  useEffect(() => {
    const id = window.setInterval(() => setUnsaved(hasUnsaved()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const blockers: Blocker[] = [];
  if (status === "recording" || status === "starting" || status === "stopping") {
    blockers.push({ key: "recording", message: BLOCKER_MESSAGES.recording });
  }
  if (audioPending) blockers.push({ key: "audio", message: BLOCKER_MESSAGES.audio });
  if (unsaved) blockers.push({ key: "notes", message: BLOCKER_MESSAGES.notes });
  if ([...running.values()].some(Boolean)) blockers.push({ key: "work", message: BLOCKER_MESSAGES.work });
  return blockers;
}

/** Server `restore_blocked` reasons, shown the same way. */
export function serverBlockers(reasons: unknown): Blocker[] {
  const list = Array.isArray(reasons) ? reasons : [];
  const out: Blocker[] = [];
  if (list.includes("recording_in_progress")) out.push({ key: "recording", message: BLOCKER_MESSAGES.recording });
  if (list.some((r) => r === "transcription_running" || r === "chat_answer_running")) {
    out.push({ key: "work", message: BLOCKER_MESSAGES.work });
  }
  if (list.includes("job_running")) out.push({ key: "job", message: "Wait until your backup has finished." });
  return out;
}
