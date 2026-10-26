// Closing never fails silently (FR-012–FR-014, research R12). The renderer reports what is
// pending; closing asks it to confirm; a renderer that does not answer within 3 s gets a native
// "not responding" box; and once the user has chosen to quit, the page's beforeunload handlers
// (which would make Electron cancel the close without a word) are overridden.
import { BrowserWindow, dialog, ipcMain } from "electron";
import { log } from "./logs";

const ANSWER_TIMEOUT_MS = 3000;

export interface GuardState {
  recording: boolean;
  pendingUploads: number;
  unsavedNotes: number;
  other: number;
}

export function pending(s: GuardState | null): boolean {
  return !!s && (s.recording || s.pendingUploads + s.unsavedNotes + s.other > 0);
}

function validGuardState(v: unknown): v is GuardState {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  const count = (n: unknown) => typeof n === "number" && Number.isInteger(n) && n >= 0;
  return typeof s.recording === "boolean" && count(s.pendingUploads) && count(s.unsavedNotes) && count(s.other);
}

export class CloseGuard {
  quitConfirmed = false;
  private state: GuardState | null = null;
  private appLoaded = false;
  private waiting: ((decision: "quit" | "stay") => void) | null = null;

  constructor(
    private readonly win: () => BrowserWindow | null,
    private readonly onGuardState: (s: GuardState) => void,
    private readonly onCloseCancelled: () => void,
  ) {
    ipcMain.on("uh:guard", (e, value: unknown) => {
      if (e.sender.id !== this.win()?.webContents.id || !validGuardState(value)) return;
      this.state = value;
      this.onGuardState(value);
    });
    ipcMain.on("uh:close.respond", (e, decision: unknown) => {
      if (e.sender.id !== this.win()?.webContents.id) return;
      if (decision === "quit" || decision === "stay") this.waiting?.(decision);
    });
  }

  current(): GuardState | null {
    return this.state;
  }

  setAppLoaded(loaded: boolean): void {
    this.appLoaded = loaded;
  }

  attach(win: BrowserWindow): void {
    win.webContents.on("will-prevent-unload", (event) => {
      if (this.quitConfirmed) {
        event.preventDefault(); // the user already chose to quit: ignore beforeunload
        return;
      }
      const choice = dialog.showMessageBoxSync(win, {
        type: "warning",
        buttons: ["Stay", "Leave"],
        defaultId: 0,
        cancelId: 0,
        title: "Unsaved changes",
        message: "Leave and lose unsaved changes?",
        detail: "Some of your work is still being saved.",
      });
      if (choice === 1) event.preventDefault();
      else this.onCloseCancelled();
    });
  }

  /** Ask before quitting; resolves true when the app may close. */
  async confirmQuit(reason: "window" | "quit" | "relaunch"): Promise<boolean> {
    const win = this.win();
    if (this.quitConfirmed || !win || win.isDestroyed()) return true;
    // A page that never reported its guard state (the startup page, or an app build without the
    // desktop close guard) is closed normally; its beforeunload still gets the native box above.
    if (!this.appLoaded || this.state === null) return true;
    const decision = await new Promise<"quit" | "stay" | "timeout">((resolve) => {
      const timer = setTimeout(() => resolve("timeout"), ANSWER_TIMEOUT_MS);
      this.waiting = (d) => {
        clearTimeout(timer);
        resolve(d);
      };
      win.webContents.send("uh:close.requested", { reason });
    });
    this.waiting = null;
    if (decision === "timeout") {
      log.warn("the window did not answer the close request in time");
      const choice = await dialog.showMessageBox(win, {
        type: "warning",
        buttons: ["Wait", "Quit anyway"],
        defaultId: 0,
        cancelId: 0,
        title: "UniHelperProMax isn't responding",
        message: "UniHelperProMax isn't responding. Quit anyway?",
        detail: "Unsaved work stays on this computer and is saved next time you open the app.",
      });
      if (choice.response !== 1) return false;
    } else if (decision === "stay") {
      return false;
    }
    this.quitConfirmed = true;
    return true;
  }
}
