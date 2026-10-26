// Owns the bundled backend's life (research R5, R6; contracts/backend-desktop-mode.md):
// spawn with the desktop environment, hand over the per-launch secrets on stdin, verify the
// backend's identity before the window loads it, stop it gracefully then by force, and
// recognise a stale backend left by a crash. Never kills a process it did not start or
// recognise as its own backend.
import { ChildProcess, execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { LogFile, log } from "./logs";
import { devMode, type Paths } from "./paths";
import * as winJob from "./winJob";

export const HOST = "127.0.0.1";
// A first start can be slow: antivirus scanning a fresh install, or (dev mode) Python compiling
// the backend from source on a slow drive.
const IDENTITY_TIMEOUT_MS = 60_000;
const DEV_IDENTITY_TIMEOUT_MS = 180_000;
const STOP_GRACE_MS = 5_000;
const POLL_MS = 200;

export interface StartupFailure {
  code: string;
  message: string;
  details: Record<string, unknown>;
  logFile: string | null;
}

export class StartupError extends Error {
  constructor(readonly failure: StartupFailure) {
    super(failure.message);
  }
}

export function appOrigin(port: number): string {
  return `http://${HOST}:${port}`;
}

interface RunMarker {
  pid: number;
  port: number;
  exe: string;
  launchId: string;
  startedAt: string;
}

function writeJsonAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeSync(fd, JSON.stringify(value, null, 2));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The executable of a running process, or null (research R6). */
export function executableOf(pid: number): string | null {
  try {
    if (process.platform === "win32") return winJob.imagePath(pid);
    if (process.platform === "linux") return fs.readlinkSync(`/proc/${pid}/exe`);
    const out = execFileSync("ps", ["-o", "comm=", "-p", String(pid)], { encoding: "utf8" }).trim();
    return out || null;
  } catch {
    return null;
  }
}

function samePath(a: string, b: string): boolean {
  const norm = (p: string) => {
    const r = path.resolve(p.replace(/ \(deleted\)$/, ""));
    return process.platform === "linux" ? r : r.toLowerCase();
  };
  return norm(a) === norm(b);
}

export type PortCheck = { free: true } | { free: false; code: string };

/** Whether 127.0.0.1:port can be bound right now, and the OS error code when not (EADDRINUSE:
 * another program listens; EACCES on Windows: the port is reserved or blocked). */
export function checkPort(port: number): Promise<PortCheck> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", (err: NodeJS.ErrnoException) => resolve({ free: false, code: err.code ?? "unknown" }));
    server.listen({ port, host: HOST, exclusive: true }, () => server.close(() => resolve({ free: true })));
  });
}

export async function portFree(port: number): Promise<boolean> {
  return (await checkPort(port)).free;
}

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return check();
}

export interface StartOptions {
  port: number;
  dataFolder: string;
  appVersion: string;
}

export class Backend {
  private child: ChildProcess | null = null;
  private launchToken = "";
  private secret = "";
  private port = 0;
  private stopping: Promise<void> | null = null;
  private log: LogFile;
  private exited = false;

  constructor(private readonly paths: Paths) {
    this.log = new LogFile(path.join(paths.logs, "backend.log"));
  }

  get markerFile(): string {
    return path.join(this.paths.backendData, "backend.run.json");
  }

  private get errorFile(): string {
    return path.join(this.paths.backendData, "startup-error.json");
  }

  clientSecret(): string {
    return this.secret;
  }

  running(): boolean {
    return this.child !== null && !this.exited;
  }

  /** Stop a backend left by an earlier run of this installation (FR-011). */
  async replaceStale(): Promise<void> {
    let marker: RunMarker;
    try {
      marker = JSON.parse(fs.readFileSync(this.markerFile, "utf8")) as RunMarker;
    } catch {
      return;
    }
    const exe = alive(marker.pid) ? executableOf(marker.pid) : null;
    if (exe && samePath(exe, this.paths.backend.exe)) {
      log.warn(`stopping a backend left by an earlier run (pid ${marker.pid})`);
      try {
        process.kill(marker.pid, "SIGKILL");
      } catch {
        /* already gone */
      }
      await waitFor(() => !alive(marker.pid), STOP_GRACE_MS);
      await waitFor(() => portFree(marker.port), STOP_GRACE_MS);
    } else if (alive(marker.pid)) {
      log.info(`run marker names pid ${marker.pid}, which is not our backend; leaving it alone`);
    }
    fs.rmSync(this.markerFile, { force: true });
  }

  async start(opts: StartOptions): Promise<void> {
    this.port = opts.port;
    this.launchToken = crypto.randomBytes(32).toString("hex");
    this.secret = crypto.randomBytes(32).toString("hex");
    this.exited = false;
    fs.mkdirSync(this.paths.backendData, { recursive: true });
    fs.rmSync(this.errorFile, { force: true });
    if (!fs.existsSync(this.paths.backend.exe)) {
      throw new StartupError({
        code: "unexpected",
        message: this.paths.backend.missingHint,
        details: {},
        logFile: this.log.file,
      });
    }
    this.log.open();
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      UNIHELPER_DESKTOP: "1",
      UNIHELPER_PORT: String(opts.port),
      UNIHELPER_DATA_DIR: this.paths.backendData,
      UNIHELPER_FILES_DIR: opts.dataFolder,
      UNIHELPER_STATIC_DIR: this.paths.frontendDir,
      UNIHELPER_KEY_FILE: this.paths.keyFile,
      UNIHELPER_DESKTOP_USER: os.userInfo().username,
      UNIHELPER_DESKTOP_TZ: Intl.DateTimeFormat().resolvedOptions().timeZone,
      UNIHELPER_APP_VERSION: opts.appVersion,
      UNIHELPER_APP_FILES_ROOTS: this.paths.appFilesRoots.join(path.delimiter),
      UNIHELPER_LOG_FILE: this.log.file,
    };
    for (const name of ["UNIHELPER_HOST", "UNIHELPER_STATIC_DIR_OVERRIDE", "UNIHELPER_ALLOWED_HOSTS"]) delete env[name];
    const { exe, args, cwd } = this.paths.backend;
    const child = spawn(exe, args, { env, cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    this.child = child;
    child.stdout?.on("data", (d: Buffer) => this.log.write(d.toString("utf8")));
    child.stderr?.on("data", (d: Buffer) => this.log.write(d.toString("utf8")));
    child.stdin?.on("error", () => undefined); // EPIPE after the backend exits
    const exitedEarly = new Promise<number>((resolve) => {
      child.once("exit", (code) => {
        this.exited = true;
        this.log.close();
        resolve(code ?? -1);
      });
    });
    if (child.pid && process.platform === "win32" && !winJob.assign(child.pid)) {
      log.warn("could not put the backend in a job object; relying on the stdin watchdog");
    }
    child.stdin?.write(`${JSON.stringify({ launchToken: this.launchToken, clientSecret: this.secret })}\n`);
    // stdin stays open for the backend's whole life: EOF tells it to stop (research R5)

    const verified = await Promise.race([
      this.verifyIdentity(),
      exitedEarly.then((code) => {
        throw new StartupError(this.readFailure(code));
      }),
    ]);
    if (!verified) {
      await this.forceKill();
      throw new StartupError({
        code: "unexpected",
        message: `The app's server did not start within ${Math.round(this.identityTimeout() / 1000)} seconds.`,
        details: {},
        logFile: this.log.file,
      });
    }
    writeJsonAtomic(this.markerFile, {
      pid: child.pid ?? -1,
      port: opts.port,
      exe: this.paths.backend.exe,
      launchId: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
    } satisfies RunMarker);
    log.info(`backend ready on ${appOrigin(opts.port)} (pid ${child.pid})`);
  }

  private readFailure(exitCode: number): StartupFailure {
    try {
      const body = JSON.parse(fs.readFileSync(this.errorFile, "utf8"));
      return { code: body.code, message: body.message, details: body.details ?? {}, logFile: this.log.file };
    } catch {
      return {
        code: exitCode === 10 ? "port_in_use" : "unexpected",
        message: `The app's server stopped while starting (exit ${exitCode}).`,
        details: { port: this.port },
        logFile: this.log.file,
      };
    }
  }

  private identityTimeout(): number {
    return devMode() ? DEV_IDENTITY_TIMEOUT_MS : IDENTITY_TIMEOUT_MS;
  }

  private async verifyIdentity(): Promise<boolean> {
    return waitFor(async () => {
      if (this.exited) return false;
      const nonce = crypto.randomBytes(16).toString("hex");
      try {
        const res = await fetch(`${appOrigin(this.port)}/api/v1/desktop/identity?nonce=${nonce}`, {
          signal: AbortSignal.timeout(2000),
        });
        if (res.status !== 200) return false;
        const body = (await res.json()) as { proof?: string };
        const expected = crypto
          .createHmac("sha256", Buffer.from(this.launchToken, "hex"))
          .update(Buffer.from(nonce, "hex"))
          .digest("hex");
        if (body.proof && crypto.timingSafeEqual(Buffer.from(body.proof), Buffer.from(expected))) return true;
        log.error("a server answered on the app's port but failed the identity check");
        return false;
      } catch {
        return false;
      }
    }, this.identityTimeout());
  }

  /** Graceful stop, then force after 5 s (FR-009, FR-010). Safe to call more than once. */
  stop(graceMs = STOP_GRACE_MS): Promise<void> {
    if (!this.stopping) this.stopping = this.doStop(graceMs).finally(() => (this.stopping = null));
    return this.stopping;
  }

  private async doStop(graceMs: number): Promise<void> {
    const child = this.child;
    if (!child || this.exited) return;
    try {
      await fetch(`${appOrigin(this.port)}/api/v1/desktop/shutdown`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.launchToken}`, "X-UniHelper-Client": this.secret },
        signal: AbortSignal.timeout(Math.min(2000, graceMs)),
      });
    } catch {
      child.stdin?.end(); // the watchdog's way in
    }
    if (!(await waitFor(() => this.exited, graceMs))) {
      log.warn(`backend did not stop within ${graceMs} ms; forcing it`);
      await this.forceKill();
    }
    fs.rmSync(this.markerFile, { force: true });
  }

  private async forceKill(): Promise<void> {
    const child = this.child;
    if (!child || this.exited) return;
    child.kill("SIGKILL"); // TerminateProcess on Windows
    await waitFor(() => this.exited, 2000);
  }
}
