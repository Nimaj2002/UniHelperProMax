// main.log and backend.log (FR-006): the last 10 runs are kept, each capped at 10 MB. Anything
// that looks like a per-launch secret (64 hex characters) is redacted before it is written.
import fs from "node:fs";
import path from "node:path";

const KEEP_RUNS = 10;
const MAX_BYTES = 10 * 1024 * 1024;
const SECRET = /\b[0-9a-f]{64}\b/gi;

export function redact(text: string): string {
  return text.replace(SECRET, "<redacted>");
}

function rotate(file: string): void {
  for (let i = KEEP_RUNS - 1; i >= 1; i--) {
    const from = i === 1 ? file : `${file}.${i - 1}`;
    const to = `${file}.${i}`;
    try {
      if (fs.existsSync(from)) fs.renameSync(from, to);
    } catch {
      /* a locked old log is not worth failing the start for */
    }
  }
}

export class LogFile {
  private fd: number | null = null;
  private written = 0;
  private capped = false;

  constructor(readonly file: string) {}

  open(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    rotate(this.file);
    this.fd = fs.openSync(this.file, "a");
  }

  write(text: string): void {
    if (this.fd === null || this.capped) return;
    const data = Buffer.from(redact(text), "utf8");
    if (this.written + data.length > MAX_BYTES) {
      fs.writeSync(this.fd, "\n[log size limit reached; further output is not written]\n");
      this.capped = true;
      return;
    }
    fs.writeSync(this.fd, data);
    this.written += data.length;
  }

  close(): void {
    if (this.fd !== null) fs.closeSync(this.fd);
    this.fd = null;
  }
}

let mainLog: LogFile | null = null;

export function openMainLog(dir: string): void {
  mainLog = new LogFile(path.join(dir, "main.log"));
  mainLog.open();
}

function line(level: string, msg: string): void {
  const text = `${new Date().toISOString()} ${level} ${msg}\n`;
  mainLog?.write(text);
  if (!process.env.UNIHELPER_QUIET) process.stderr.write(redact(text));
}

export const log = {
  info: (msg: string) => line("INFO", msg),
  warn: (msg: string) => line("WARN", msg),
  error: (msg: string) => line("ERROR", msg),
};
