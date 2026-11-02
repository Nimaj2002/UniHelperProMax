// Launches the desktop app for end-to-end tests (research R19). By default the unpacked
// development build (`electron .` over desktop/dist and ../backend/dist); set
// UNIHELPER_E2E_EXECUTABLE to a packaged app's executable to test a release build.
import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const DESKTOP = path.resolve(__dirname, "..", "..");
export const FIXTURES = path.join(__dirname, "fixtures");

export function fakeMicArgs(): string[] {
  if (!fs.existsSync(path.join(FIXTURES, "tone-125s.wav"))) {
    execFileSync(process.execPath, [path.join(FIXTURES, "make-tone.cjs")]); // generated, not committed
  }
  return ["--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${path.join(FIXTURES, "tone-125s.wav")}`];
}

function canBind(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.listen(port, "127.0.0.1", () => s.close(() => resolve(true)));
  });
}

/** A free port below the OS's ephemeral range, so DevTools and outgoing connections can't take
 * it between this check and the app's start. */
export async function freePort(): Promise<number> {
  for (let i = 0; i < 50; i++) {
    const port = 20000 + Math.floor(Math.random() * 10000);
    if (await canBind(port)) return port;
  }
  throw new Error("no free port found");
}

export interface Profile {
  dir: string;
  port: number;
  dataFolder: string;
  settingsFile: string;
}

/** A fresh per-test profile; `seed` lands in desktop.json (the default seed skips first run). */
export async function newProfile(seed: Record<string, unknown> = {}): Promise<Profile> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uh-e2e-"));
  const port = await freePort();
  const dataFolder = path.join(dir, "Documents", "UniHelperProMax");
  fs.mkdirSync(dataFolder, { recursive: true });
  const settingsFile = path.join(dir, "userData", "desktop.json");
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  fs.writeFileSync(
    settingsFile,
    JSON.stringify({ schemaVersion: 1, port, dataFolder, firstRunComplete: true, ...seed }, null, 2),
  );
  return { dir, port, dataFolder, settingsFile };
}

export async function launchApp(
  profile: Profile,
  opts: { env?: Record<string, string>; args?: string[] } = {},
): Promise<ElectronApplication> {
  const packaged = process.env.UNIHELPER_E2E_EXECUTABLE;
  return electron.launch({
    ...(packaged ? { executablePath: packaged } : {}),
    args: [...(packaged ? [] : [DESKTOP]), ...(opts.args ?? [])],
    env: {
      ...(process.env as Record<string, string>),
      UNIHELPER_DESKTOP_PROFILE: profile.dir,
      UNIHELPER_QUIET: "1",
      UNIHELPER_NO_UPDATE: "1",
      ...(opts.env ?? {}),
    },
    timeout: 60_000,
  });
}

/** The main window once it shows the app from the backend (not the startup page). */
export async function appWindow(app: ElectronApplication, profile: Profile): Promise<Page> {
  const page = await app.firstWindow();
  await page.waitForURL(`http://127.0.0.1:${profile.port}/**`, { timeout: 60_000 });
  return page;
}

export function backendPids(): number[] {
  const name = process.platform === "win32" ? "unihelper-backend.exe" : "unihelper-backend";
  try {
    if (process.platform === "win32") {
      const out = execFileSync("tasklist", ["/FI", `IMAGENAME eq ${name}`, "/FO", "CSV", "/NH"], { encoding: "utf8" });
      return out
        .split(/\r?\n/)
        .map((l) => l.split('","')[1])
        .filter(Boolean)
        .map(Number);
    }
    // -f: Linux truncates process names to 15 characters, so match the executable path
    const out = execFileSync("pgrep", ["-f", `${name}/${name}( |$)|^${name}( |$)|/${name}$`], { encoding: "utf8" });
    return out.split(/\s+/).filter(Boolean).map(Number);
  } catch {
    return [];
  }
}

export async function waitUntil(check: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return check();
}

/** Quit through the app's normal path (closing the window), like a user would. */
export async function quit(app: ElectronApplication): Promise<void> {
  const proc = app.process();
  const exited = new Promise<void>((resolve) => proc.once("exit", () => resolve()));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close()).catch(() => undefined);
  await Promise.race([exited, new Promise((r) => setTimeout(r, 15_000))]);
}
