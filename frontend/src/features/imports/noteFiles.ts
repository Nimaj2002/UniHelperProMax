/** Reading `.md` / `.txt` files for "Import note" (006 FR-015–FR-017, research I10). */

export const NOTE_EXTENSIONS = [".md", ".txt"] as const;
export const NOTE_ACCEPT = ".md,.txt,text/markdown,text/plain";
export const MAX_NOTE_BYTES = 5 * 1024 * 1024;
export const MAX_NOTE_NAME = 120;
export const FALLBACK_NOTE_NAME = "Imported note";

export type NoteFile =
  | { ok: true; fileName: string; /** null: nothing left after removing the extension */ name: string | null; content: string }
  | { ok: false; fileName: string; reason: string };

/** Same rules as the server's display names: NFC, whitespace collapsed, trimmed. */
export function normalizeName(name: string): string {
  return name.normalize("NFC").replace(/\s+/g, " ").trim(); // \s includes no-break spaces
}

/** Case-insensitive comparison key, like the server's `name_key`. */
export function nameKey(name: string): string {
  return normalizeName(name).toLowerCase();
}

/** The note name a file gets: its name without the last extension, at most 120 characters. */
export function noteNameFor(fileName: string): string | null {
  const dot = fileName.lastIndexOf(".");
  const stem = normalizeName(dot >= 0 ? fileName.slice(0, dot) : fileName);
  const name = [...stem].slice(0, MAX_NOTE_NAME).join("").trim();
  return name || null;
}

function extension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot >= 0 ? fileName.slice(dot).toLowerCase() : "";
}

async function bytesOf(file: Blob): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === "function") return file.arrayBuffer();
  return new Response(file).arrayBuffer();
}

export async function readNoteFile(file: File): Promise<NoteFile> {
  const fileName = file.name;
  if (!(NOTE_EXTENSIONS as readonly string[]).includes(extension(fileName))) {
    return { ok: false, fileName, reason: `${fileName} isn't a .md or .txt file.` };
  }
  if (file.size > MAX_NOTE_BYTES) {
    return { ok: false, fileName, reason: `${fileName} is larger than 5 MB.` };
  }
  const unreadable = { ok: false as const, fileName, reason: `${fileName} isn't readable text (save it as UTF-8 and try again).` };
  let content: string;
  try {
    // fatal: invalid UTF-8 is refused instead of silently turned into "�" (content must match)
    content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(await bytesOf(file));
  } catch {
    return unreadable;
  }
  if (content.includes("\u0000")) return unreadable;
  return { ok: true, fileName, name: noteNameFor(fileName), content };
}
