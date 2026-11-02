/**
 * End-of-phase alerts (020 FR-036–FR-038): a sound, a message in the app and, when the app isn't in
 * the foreground and the user allowed it, a system notification. Scheduled in a worker (R4).
 */
import { toast } from "sonner";

let worker: Worker | null = null;
let onFire: ((key: string) => void) | null = null;
let fallback: number | undefined;

/** Fire `fire(key)` at `at` (local ms); null cancels. One schedule at a time. */
export function scheduleAlert(at: number | null, key: string, fire: (key: string) => void) {
  onFire = fire;
  if (typeof Worker !== "undefined") {
    try {
      worker ??= new Worker(new URL("./alerts.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (e: MessageEvent<string>) => onFire?.(e.data);
      worker.postMessage({ at, key });
      return;
    } catch {
      worker = null; // no worker support: fall back to a page timer
    }
  }
  window.clearTimeout(fallback);
  if (at !== null) fallback = window.setTimeout(() => onFire?.(key), Math.max(0, at - Date.now()));
}

// ---- sound: an AudioContext unlocked by the Start click, so it may play later in the background

let audio: AudioContext | null = null;

/** Call from a user gesture (Start) so later sounds are allowed. */
export function unlockSound() {
  try {
    audio ??= new AudioContext();
    void audio.resume();
  } catch {
    audio = null;
  }
}

function chime() {
  if (!audio) return;
  const t = audio.currentTime;
  for (const [i, freq] of [880, 660].entries()) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t + i * 0.25);
    gain.gain.exponentialRampToValueAtTime(0.2, t + i * 0.25 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.25 + 0.4);
    osc.connect(gain).connect(audio.destination);
    osc.start(t + i * 0.25);
    osc.stop(t + i * 0.25 + 0.45);
  }
}

// ---- notification permission (explained in Settings before asking, FR-038) ----------------

export const notificationsSupported = () => typeof Notification !== "undefined";
export const notificationPermission = (): NotificationPermission | "unsupported" => (notificationsSupported() ? Notification.permission : "unsupported");
export async function askNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  return notificationsSupported() ? Notification.requestPermission() : "unsupported";
}

/** Play the alert: sound, in-app message, and a system notification when in the background. */
export function alertUser(title: string, body: string, opts: { sound: boolean; system: boolean; onClick: () => void }) {
  if (opts.sound) chime();
  toast(title, { description: body, duration: 15_000 });
  const background = document.visibilityState !== "visible" || !document.hasFocus();
  if (opts.system && background && notificationPermission() === "granted") {
    const n = new Notification(title, { body, tag: "uh-time" });
    n.onclick = () => {
      window.focus();
      opts.onClick();
      n.close();
    };
  }
}
