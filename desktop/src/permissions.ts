// The microphone is the only permission the window grants, and only to the app's own address
// (FR-041, research R13). Both the request and the check handler are set: Chromium asks each.
import { BrowserWindow, ipcMain, systemPreferences, type Session } from "electron";
import { log } from "./logs";

let loggedKinds = new Set<string>();

function denyMic(): boolean {
  return process.env.UNIHELPER_E2E_DENY_MIC === "1"; // tests only; can only remove a permission
}

function probeLog(kind: string, details: unknown): void {
  if (process.env.UNIHELPER_PROBE !== "1" || loggedKinds.has(kind)) return;
  loggedKinds.add(kind);
  log.info(`permission ${kind} details: ${JSON.stringify(details)}`);
}

function originOf(url: string | undefined): string | null {
  try {
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
}

export function registerPermissions(ses: Session, origin: () => string, mainWindow: () => BrowserWindow | null): void {
  loggedKinds = new Set();
  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    probeLog(`request:${permission}`, details);
    const d = details as Electron.MediaAccessPermissionRequest & { isMainFrame?: boolean };
    const types = d.mediaTypes ?? [];
    const allowed =
      !denyMic() &&
      permission === "media" &&
      types.includes("audio") &&
      !types.includes("video") &&
      originOf(d.requestingUrl) === origin() &&
      webContents.id === mainWindow()?.webContents.id &&
      d.isMainFrame !== false;
    if (!allowed && permission === "media") log.info(`denied media request ${JSON.stringify(types)}`);
    callback(allowed);
  });
  ses.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) => {
    probeLog(`check:${permission}`, details);
    return (
      !denyMic() &&
      permission === "media" &&
      (details as { mediaType?: string }).mediaType === "audio" &&
      originOf(requestingOrigin) === origin()
    );
  });
  ses.setDevicePermissionHandler(() => false);
}

export type MicStatus = "granted" | "denied" | "restricted" | "not-determined" | "unknown";

export function micStatus(): MicStatus {
  if (denyMic()) return "denied";
  if (process.platform === "darwin" || process.platform === "win32") {
    return systemPreferences.getMediaAccessStatus("microphone") as MicStatus;
  }
  return "unknown";
}

export async function micRequest(): Promise<"granted" | "denied" | "unknown"> {
  const status = micStatus();
  if (process.platform === "darwin" && status === "not-determined") {
    return (await systemPreferences.askForMediaAccess("microphone")) ? "granted" : "denied";
  }
  if (status === "granted") return "granted";
  if (status === "denied" || status === "restricted") return "denied";
  return "unknown";
}

export function registerMicrophoneIpc(isMainSender: (id: number) => boolean, markExplained: () => void): void {
  ipcMain.handle("uh:microphone.status", (e) => (isMainSender(e.sender.id) ? micStatus() : "unknown"));
  ipcMain.handle("uh:microphone.request", (e) => (isMainSender(e.sender.id) ? micRequest() : "unknown"));
  ipcMain.handle("uh:microphone.markExplained", (e) => {
    if (isMainSender(e.sender.id)) markExplained();
  });
}
