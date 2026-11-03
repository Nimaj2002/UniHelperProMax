// UniHelperProMax desktop: main process (plan.md, research R5–R14).
import { BrowserWindow, app, clipboard, ipcMain, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { Backend, StartupError, appOrigin, checkPort, type StartupFailure } from "./backend";
import { CloseGuard, pending } from "./closeGuard";
import { log, openMainLog } from "./logs";
import { applyProfileOverride, resolvePaths, type Paths } from "./paths";
import { registerMicrophoneIpc, registerPermissions } from "./permissions";
import { SettingsStore } from "./settingsStore";
import { checkForUpdates } from "./updates";

import { appSession, createWindow, injectClientSecret, startupPage, titleBarColors } from "./window";

applyProfileOverride();

// One copy per user account (FR-004): a second launch only focuses the first copy's window.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  run();
}

type StartupState =
  | { state: "starting" }
  | { state: "error"; failure: StartupFailure; logsFolder: string };

function run(): void {
  let win: BrowserWindow | null = null;
  let paths: Paths;
  let store: SettingsStore;
  let backend: Backend;
  let guard: CloseGuard;
  let startupState: StartupState = { state: "starting" };
  let approved = false; // the user (or the absence of pending work) allowed this quit
  let backendStopped = false;
  let activePort = 0; // the port this run uses; part of the window's storage origin (research R7)
  const origin = () => appOrigin(activePort);

  const isMain = (senderId: number) => !!win && !win.isDestroyed() && win.webContents.id === senderId;

  app.on("second-instance", () => {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });

  app.on("window-all-closed", () => app.quit()); // on every system, macOS included (FR-015)

  // Logout or shutdown on macOS and Linux (and `kill`): quit through the normal path so the
  // backend is stopped gracefully; the backend's own stdin watchdog covers a hard kill.
  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
    process.on(signal, () => {
      log.info(`${signal}: quitting`);
      approved = true;
      app.quit();
    });
  }

  app.on("before-quit", (event) => {
    if (approved || !win || win.isDestroyed()) return;
    event.preventDefault();
    void guard.confirmQuit("quit").then((ok) => {
      if (!ok) return;
      approved = true;
      app.quit();
    });
  });

  app.on("will-quit", (event) => {
    if (backendStopped || !backend?.running()) return;
    event.preventDefault();
    void backend.stop().finally(() => {
      backendStopped = true;
      app.exit(0);
    });
  });

  function sendStartup(next: StartupState): void {
    startupState = next;
    if (win && !win.isDestroyed()) win.webContents.send("uh:startup.state", next);
  }

  async function showStartup(next: StartupState): Promise<void> {
    startupState = next;
    guard.setAppLoaded(false);
    if (!win || win.isDestroyed()) return;
    if (!win.webContents.getURL().startsWith("file:")) await win.loadFile(startupPage());
    sendStartup(next);
  }

  function ensureDataFolder(): string {
    const settings = store.get();
    if (settings.dataFolder) return settings.dataFolder;
    // Phase 2 (probe): the default folder; user story 1 replaces this with the first-run page
    fs.mkdirSync(paths.defaultDataFolder, { recursive: true });
    store.update({ dataFolder: paths.defaultDataFolder, firstRunComplete: true });
    return paths.defaultDataFolder;
  }

  function usePort(port: number): void {
    activePort = port;
    injectClientSecret(port, () => backend.clientSecret()); // replaces the previous port's hook
  }

  /** The saved port first; when it is taken, every port after it, unless the last run left
   * recording audio or drafts in the window's storage, which belongs to the saved port. */
  function portCandidates(saved: number, pendingWork: boolean): number[] {
    if (pendingWork) return [saved];
    const out = [saved];
    for (let p = saved + 1; p <= 65535; p++) out.push(p);
    return out;
  }

  async function startOnFirstFreePort(dataFolder: string): Promise<void> {
    const settings = store.get();
    const saved = settings.port;
    const pendingWork = settings.lastGuardState?.pending === true;
    const candidates = portCandidates(saved, pendingWork);
    const tried: string[] = [];
    for (const port of candidates) {
      const check = await checkPort(port);
      if (!check.free) {
        log.warn(`port ${port} can't be used (${check.code})`);
        tried.push(`${port} (${check.code})`);
        continue;
      }
      usePort(port);
      try {
        await backend.start({ port, dataFolder, appVersion: app.getVersion() });
      } catch (err) {
        if (err instanceof StartupError && err.failure.code === "port_in_use") {
          tried.push(`${port} (taken while starting)`);
          continue;
        }
        throw err;
      }
      if (port !== saved) {
        log.warn(`port ${saved} was not available; using ${port} from now on`);
        store.update({ port });
      }
      return;
    }
    const last = candidates[candidates.length - 1];
    throw new StartupError({
      code: "port_in_use",
      message: pendingWork
        ? `Port ${saved} is in use by another program. Unsent recording audio or unsaved notes are ` +
          `waiting under this port, so the app won't switch to another one. Close the other program and retry.`
        : candidates.length > 1
          ? `Ports ${saved}–${last} are all in use by other programs.`
          : `Port ${saved} is in use by another program.`,
      details: { port: saved, tried },
      logFile: path.join(paths.logs, "main.log"),
    });
  }

  async function launch(): Promise<void> {
    await showStartup({ state: "starting" });
    try {
      const dataFolder = ensureDataFolder();
      await backend.replaceStale();
      await startOnFirstFreePort(dataFolder);
      if (!win || win.isDestroyed()) return;
      await win.loadURL(`${origin()}/`);
      guard.setAppLoaded(true);
    } catch (err) {
      const failure: StartupFailure =
        err instanceof StartupError
          ? err.failure
          : { code: "unexpected", message: String(err), details: {}, logFile: path.join(paths.logs, "main.log") };
      log.error(`startup failed: ${failure.code} ${failure.message}`);
      await showStartup({ state: "error", failure, logsFolder: paths.logs });
    }
  }

  function registerIpc(): void {
    ipcMain.on("uh:startup.ready", (e) => {
      if (isMain(e.sender.id)) e.sender.send("uh:startup.state", startupState);
    });
    ipcMain.handle("uh:startup.action", async (e, name: unknown) => {
      if (!isMain(e.sender.id) || !e.sender.getURL().startsWith("file:")) return;
      switch (name) {
        case "retry":
          await launch();
          break;
        case "quit":
          approved = true;
          app.quit();
          break;
        case "openLogs":
          await shell.openPath(paths.logs);
          break;
        case "copyError":
          if (startupState.state === "error") {
            const f = startupState.failure;
            clipboard.writeText(`${f.code}: ${f.message}\n${JSON.stringify(f.details)}\nLog: ${f.logFile ?? ""}`);
          }
          break;
      }
    });
    ipcMain.handle("uh:info", (e) => {
      if (!isMain(e.sender.id)) return null;
      const s = store.get();
      return {
        version: app.getVersion(),
        platform: process.platform,
        arch: process.arch,
        port: activePort || s.port,
        dataFolder: s.dataFolder,
        logsFolder: paths.logs,
        backendDataFolder: paths.backendData,
      };
    });
    ipcMain.handle("uh:open.logs", (e) => (isMain(e.sender.id) ? shell.openPath(paths.logs) : undefined));
    ipcMain.handle("uh:open.dataFolder", (e) => {
      const folder = store.get().dataFolder;
      return isMain(e.sender.id) && folder ? shell.openPath(folder) : undefined;
    });
    // 016: "Show in folder" for the safety backup; nothing outside backups/safety is revealed
    ipcMain.handle("uh:reveal.path", (e, target: unknown) => {
      if (!isMain(e.sender.id) || typeof target !== "string") return undefined;
      const safety = path.resolve(paths.backendData, "backups", "safety");
      const resolved = path.resolve(target);
      if (!resolved.startsWith(safety + path.sep) || !fs.existsSync(resolved)) return undefined;
      shell.showItemInFolder(resolved);
      return undefined;
    });
    // the caption buttons follow the app's own theme, which may differ from the OS one
    ipcMain.on("uh:titlebar.theme", (e, theme: unknown) => {
      if (!isMain(e.sender.id) || (theme !== "light" && theme !== "dark") || process.platform === "darwin") return;
      win?.setTitleBarOverlay(titleBarColors(theme));
    });
    registerMicrophoneIpc(isMain, () => store.update({ micExplained: true }));
  }

  void app.whenReady().then(async () => {
    paths = resolvePaths();
    openMainLog(paths.logs);
    log.info(`UniHelperProMax ${app.getVersion()} starting (${process.platform}/${process.arch})`);
    store = new SettingsStore(path.join(paths.userData, "desktop.json"));
    store.load();
    backend = new Backend(paths);
    win = createWindow();
    guard = new CloseGuard(
      () => win,
      (g) => store.update({ lastGuardState: { pending: pending(g), recording: g.recording, at: new Date().toISOString() } }),
      () => (approved = false),
    );
    guard.attach(win);
    win.on("close", (event) => {
      if (approved) return;
      event.preventDefault();
      void guard.confirmQuit("window").then((ok) => {
        if (!ok || !win || win.isDestroyed()) return;
        approved = true;
        win.close();
      });
    });
    win.on("closed", () => (win = null));
    usePort(store.get().port);
    registerPermissions(appSession(), origin, () => win);
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (event, url) => {
      if (!url.startsWith(`${origin()}/`)) event.preventDefault();
    });
    registerIpc();
    await launch();
    checkForUpdates();
  });
}
