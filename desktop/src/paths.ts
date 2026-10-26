// Where everything lives on each system (research R10). Per-user paths can be rooted in one
// test folder with UNIHELPER_DESKTOP_PROFILE (end-to-end tests only).
import { app } from "electron";
import os from "node:os";
import path from "node:path";

export const APP_DIR = "UniHelperProMax";
const exeName = process.platform === "win32" ? "unihelper-backend.exe" : "unihelper-backend";

/** How to start the backend: the bundled executable, or (dev mode) Python from source. */
export interface BackendCommand {
  exe: string;
  args: string[];
  cwd?: string;
  /** Shown when `exe` is missing. */
  missingHint: string;
}

export interface Paths {
  userData: string;
  backendData: string;
  keyFile: string;
  logs: string;
  backend: BackendCommand;
  frontendDir: string;
  defaultDataFolder: string;
  appFilesRoots: string[];
}

/** Call before `app.whenReady()` and before the single-instance lock (it is keyed to userData). */
export function applyProfileOverride(): void {
  const profile = process.env.UNIHELPER_DESKTOP_PROFILE;
  if (!profile) return;
  app.setPath("userData", path.join(profile, "userData"));
  app.setPath("documents", path.join(profile, "Documents"));
  app.setPath("downloads", path.join(profile, "Downloads"));
  app.setAppLogsPath(path.join(profile, "logs"));
}

function backendDataDir(): string {
  const profile = process.env.UNIHELPER_DESKTOP_PROFILE;
  if (profile) return path.join(profile, "backend");
  switch (process.platform) {
    case "win32": // Local, not roaming: a large database must not roam with domain profiles
      return path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"), APP_DIR, "backend");
    case "darwin":
      return path.join(app.getPath("userData"), "backend");
    default:
      return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), APP_DIR, "backend");
  }
}

function appBundle(exe: string): string | null {
  const marker = exe.indexOf(".app/");
  return marker >= 0 ? exe.slice(0, marker + 4) : null;
}

/** `npm run dev`: run the backend from source with its own virtual environment, so backend
 * changes need a restart, not a PyInstaller build. Never in a packaged app. */
export function devMode(): boolean {
  return !app.isPackaged && process.env.UNIHELPER_DESKTOP_DEV === "1";
}

function backendCommand(resources: string): BackendCommand {
  if (devMode()) {
    const backendDir = path.join(resources, "backend");
    const python =
      process.platform === "win32"
        ? path.join(backendDir, ".venv", "Scripts", "python.exe")
        : path.join(backendDir, ".venv", "bin", "python");
    return {
      exe: python,
      args: ["-m", "unihelper.desktop.serve"],
      cwd: backendDir,
      missingHint: `No backend environment at ${python}. Run "uv sync" in the backend folder.`,
    };
  }
  const exe = app.isPackaged
    ? path.join(resources, "backend", exeName)
    : path.join(resources, "backend", "dist", "unihelper-backend", exeName);
  return {
    exe,
    args: [],
    missingHint: app.isPackaged
      ? `The app's server is missing (${exe}). Reinstall UniHelperProMax.`
      : `No built backend at ${exe}. Build it with PyInstaller, or use "npm run dev".`,
  };
}

export function resolvePaths(): Paths {
  const backendData = backendDataDir();
  const resources = app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), "..");
  const exe = app.getPath("exe");
  const roots = [path.dirname(exe), process.resourcesPath, appBundle(exe), process.env.APPDIR ?? null];
  return {
    userData: app.getPath("userData"),
    backendData,
    keyFile: path.join(path.dirname(backendData), "keys", "master.key"),
    logs: app.getPath("logs"),
    backend: backendCommand(resources),
    frontendDir: app.isPackaged ? path.join(resources, "frontend") : path.join(resources, "frontend", "dist"),
    defaultDataFolder: path.join(app.getPath("documents"), APP_DIR),
    appFilesRoots: roots.filter((r): r is string => !!r).map((r) => path.resolve(r)),
  };
}

/** True when `candidate` is one of `roots` or inside one (FR-027). */
export function isInside(candidate: string, roots: string[]): boolean {
  const c = path.resolve(candidate);
  const norm = (p: string) => (process.platform === "linux" ? p : p.toLowerCase());
  return roots.some((root) => {
    const rel = path.relative(norm(root), norm(c));
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  });
}
