// Auto-update from GitHub Releases (electron-updater; publish config in electron-builder.yml).
// Windows (NSIS) and AppImage download in the background; the app shows the state in Settings →
// Version and a toast, and installs on "Restart and update" or when the app quits (after will-quit
// has stopped the backend). macOS (ad-hoc signed: Squirrel.Mac refuses the update) and .deb (would
// need a root password) can't update themselves, so "Download" opens the release page.
import { app, ipcMain, shell, type BrowserWindow } from "electron";
import { autoUpdater } from "electron-updater";
import { log } from "./logs";

const RELEASES = "https://github.com/Nimaj2002/UniHelperProMax/releases/latest";

export type UpdateStatus = "unsupported" | "idle" | "checking" | "none" | "available" | "downloading" | "ready" | "error";
export interface UpdateState {
  status: UpdateStatus;
  current: string;
  version: string | null;
  percent: number | null;
  error: string | null;
  selfInstall: boolean;
}

export function canSelfInstall(platform: string = process.platform, appImage = process.env.APPIMAGE): boolean {
  return platform === "win32" || (platform === "linux" && !!appImage);
}

// UNIHELPER_NO_UPDATE: e2e runs packaged builds and must not download or install a release
const enabled = () => app.isPackaged && process.env.UNIHELPER_NO_UPDATE !== "1";

let state: UpdateState;
let getWin: () => BrowserWindow | null = () => null;

function set(next: Partial<UpdateState>): void {
  state = { ...state, ...next };
  const win = getWin();
  if (win && !win.isDestroyed()) win.webContents.send("uh:update.state", state);
}

function check(): void {
  if (!enabled() || state.status === "checking" || state.status === "downloading") return;
  set({ status: "checking", error: null });
  autoUpdater.checkForUpdates().catch((err: unknown) => {
    log.warn(`update check failed: ${String(err)}`);
    set({ status: "error", error: String(err) });
  });
}

/**
 * IPC for Settings → Version. `confirmQuit` runs the close guard (unsaved notes, recording)
 * before the installer starts; it must also mark the quit approved.
 */
export function registerUpdates(
  win: () => BrowserWindow | null,
  isMain: (senderId: number) => boolean,
  confirmQuit: () => Promise<boolean>,
): void {
  getWin = win;
  const selfInstall = canSelfInstall();
  state = { status: enabled() ? "idle" : "unsupported", current: app.getVersion(), version: null, percent: null, error: null, selfInstall };

  ipcMain.handle("uh:update.state", (e) => (isMain(e.sender.id) ? state : null));
  ipcMain.handle("uh:update.check", (e) => void (isMain(e.sender.id) && check()));
  ipcMain.handle("uh:update.download", async (e) => {
    if (!isMain(e.sender.id) || !enabled()) return;
    if (!selfInstall) return void shell.openExternal(RELEASES);
    if (state.status !== "available" && state.status !== "error") return;
    set({ status: "downloading", percent: 0, error: null });
    await autoUpdater.downloadUpdate().catch((err: unknown) => set({ status: "error", error: String(err) }));
  });
  ipcMain.handle("uh:update.install", async (e) => {
    if (!isMain(e.sender.id) || state.status !== "ready") return;
    if (await confirmQuit()) autoUpdater.quitAndInstall();
  });

  if (!enabled()) return;
  autoUpdater.logger = log;
  autoUpdater.autoDownload = selfInstall;
  autoUpdater.autoInstallOnAppQuit = selfInstall;
  autoUpdater.on("update-available", (info) =>
    set({ status: selfInstall ? "downloading" : "available", version: info.version, percent: selfInstall ? 0 : null }),
  );
  autoUpdater.on("update-not-available", () => set({ status: "none" }));
  autoUpdater.on("download-progress", (p) => set({ status: "downloading", percent: Math.round(p.percent) }));
  autoUpdater.on("update-downloaded", (info) => set({ status: "ready", version: info.version, percent: 100 }));
  autoUpdater.on("error", (err) => set({ status: "error", error: err.message }));
}

/** The check at startup; the user can check again from Settings → Version. */
export function checkForUpdates(): void {
  check();
}
