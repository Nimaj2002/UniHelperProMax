// desktop.json in userData (data-model.md "Desktop settings"). Atomic writes; a corrupt file is
// kept aside and defaults are used; a newer schema is never overwritten.
import fs from "node:fs";
import path from "node:path";
import { log } from "./logs";

export const DEFAULT_PORT = 47813;
const SCHEMA_VERSION = 1;

export interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
}

export interface GuardSnapshot {
  pending: boolean;
  recording: boolean;
  at: string;
}

export interface DesktopSettings {
  schemaVersion: number;
  port: number; // 1024–65535
  dataFolder: string | null;
  firstRunComplete: boolean;
  micExplained: boolean;
  window: WindowState | null;
  lastGuardState: GuardSnapshot | null;
  pendingCleanup: { oldPath: string; manifestId: string } | null;
}

export function defaults(): DesktopSettings {
  return {
    schemaVersion: SCHEMA_VERSION,
    port: DEFAULT_PORT,
    dataFolder: null,
    firstRunComplete: false,
    micExplained: false,
    window: null,
    lastGuardState: null,
    pendingCleanup: null,
  };
}

export function validPort(port: unknown): port is number {
  return typeof port === "number" && Number.isInteger(port) && port >= 1024 && port <= 65535;
}

export class SettingsStore {
  private value: DesktopSettings = defaults();
  private readOnly = false;

  constructor(private readonly file: string) {}

  load(): DesktopSettings {
    let raw: string;
    try {
      raw = fs.readFileSync(this.file, "utf8");
    } catch {
      return (this.value = defaults());
    }
    try {
      const parsed = JSON.parse(raw) as Partial<DesktopSettings>;
      if (typeof parsed.schemaVersion === "number" && parsed.schemaVersion > SCHEMA_VERSION) {
        log.warn(`desktop.json has schema ${parsed.schemaVersion}; using defaults and leaving it untouched`);
        this.readOnly = true;
        return (this.value = defaults());
      }
      const merged = { ...defaults(), ...parsed, schemaVersion: SCHEMA_VERSION };
      if (!validPort(merged.port)) merged.port = DEFAULT_PORT;
      return (this.value = merged);
    } catch {
      const aside = `${this.file}.corrupt-${new Date().toISOString().replace(/[:.]/g, "-")}`;
      try {
        fs.renameSync(this.file, aside);
      } catch {
        /* keep going with defaults */
      }
      log.warn(`desktop.json was unreadable; kept as ${path.basename(aside)}`);
      return (this.value = defaults());
    }
  }

  get(): DesktopSettings {
    return this.value;
  }

  update(patch: Partial<DesktopSettings>): DesktopSettings {
    this.value = { ...this.value, ...patch };
    this.write();
    return this.value;
  }

  private write(): void {
    if (this.readOnly) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    const fd = fs.openSync(tmp, "w");
    try {
      fs.writeSync(fd, JSON.stringify(this.value, null, 2));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, this.file);
  }
}
