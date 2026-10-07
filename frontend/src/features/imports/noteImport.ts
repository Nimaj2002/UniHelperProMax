/**
 * One "Import note" run (006 US4/US5): every picked file becomes a new note, one at a time in
 * pick order. A name clash is never resolved by the app: the user chooses Rename, Replace or
 * Skip, and only a confirmed Replace changes an existing note (FR-018–FR-023).
 */
import { isApiError } from "@/lib/api";
import type { Note, NoteMeta } from "@/features/sessions/api";
import { FALLBACK_NOTE_NAME, MAX_NOTE_NAME, nameKey, readNoteFile } from "./noteFiles";

export interface NoteImportApi {
  create(name: string, content: string): Promise<Note>;
  replace(noteId: string, version: number, content: string): Promise<Note>;
}

export type ConflictChoice = { action: "rename"; name: string } | { action: "replace" } | { action: "skip" };

export interface ConflictPrompt {
  fileName: string;
  /** The taken name. */
  name: string;
  /** First free "Name (n)". */
  suggestion: string;
  /** Names already used in the session (for live validation of a rename). */
  takenKeys: Set<string>;
  /** Conflicts after this one in this run (the "Apply to all" checkbox shows when ≥ 1). */
  remaining: number;
}

export interface NoteImportUi {
  resolveConflict(prompt: ConflictPrompt): Promise<{ choice: ConflictChoice; applyToAll: boolean }>;
  /** Second, explicit confirmation naming every note that will be replaced. */
  confirmReplace(names: string[]): Promise<boolean>;
}

export type NoteImportOutcome = "imported" | "renamed" | "replaced" | "skipped" | "rejected";

export interface NoteImportResult {
  fileName: string;
  outcome: NoteImportOutcome;
  name?: string;
  note?: Note;
  detail?: string;
}

export interface NoteImportOptions {
  files: File[];
  /** The session's notes when the run starts. */
  notes: NoteMeta[];
  api: NoteImportApi;
  ui: NoteImportUi;
  /** Why this note can't be replaced right now (unsaved edits), or null. */
  replaceBlocked?: (noteId: string, name: string) => string | null;
  onCreated?: (note: Note) => void;
  onReplaced?: (note: Note) => void;
}

/** `base`, or `base (2)`, `base (3)`… — the first name not in `taken`, within 120 characters. */
export function firstFreeName(base: string, taken: Set<string>): string {
  let name = base;
  for (let n = 2; taken.has(nameKey(name)); n++) {
    const suffix = ` (${n})`;
    name = [...base].slice(0, MAX_NOTE_NAME - suffix.length).join("").trimEnd() + suffix;
  }
  return name;
}

export function replaceRefusal(err: unknown, name: string): string {
  if (isApiError(err, "note_transcribing")) return `A transcription is being added to “${name}”. Try again when it finishes.`;
  if (isApiError(err, "version_conflict") || isApiError(err, "file_changed_on_disk")) {
    return `“${name}” changed since you chose Replace. Nothing was replaced.`;
  }
  if (isApiError(err, "not_found")) return `“${name}” no longer exists. Nothing was replaced.`;
  return `“${name}” couldn't be replaced: ${err instanceof Error ? err.message : "unknown error"}.`;
}

function errorText(err: unknown): string {
  if (isApiError(err)) return err.title;
  return "Can't reach the server.";
}

interface Known {
  id: string;
  name: string;
  version: number;
}

export async function runNoteImport(opts: NoteImportOptions): Promise<NoteImportResult[]> {
  const { api, ui } = opts;
  const known = new Map<string, Known>(opts.notes.map((n) => [nameKey(n.name), { id: n.id, name: n.name, version: n.version }]));
  const taken = () => new Set(known.keys());
  const results: NoteImportResult[] = [];

  const read = await Promise.all(opts.files.map((f) => readNoteFile(f)));

  // names that will clash, in order, so "Apply to all N remaining" can be offered up front
  const expected = new Set(known.keys());
  const clashes: number[] = [];
  read.forEach((f, i) => {
    if (!f.ok || f.name === null) return;
    const key = nameKey(f.name);
    if (expected.has(key)) clashes.push(i);
    expected.add(key);
  });

  let applyToAll: ConflictChoice["action"] | null = null;

  const remember = (note: Note) => {
    known.set(nameKey(note.name), { id: note.id, name: note.name, version: note.version });
    opts.onCreated?.(note);
  };

  for (const [index, file] of read.entries()) {
    if (!file.ok) {
      results.push({ fileName: file.fileName, outcome: "rejected", detail: file.reason });
      continue;
    }

    // an empty name gets "Imported note", "Imported note (2)", … — the user didn't choose it
    if (file.name === null) {
      let created: Note | null = null;
      let failure: string | null = null;
      const refused = new Set<string>(); // taken by a note this browser didn't know about
      for (let attempt = 0; attempt < 20 && !created && !failure; attempt++) {
        const candidate = firstFreeName(FALLBACK_NOTE_NAME, new Set([...known.keys(), ...refused]));
        try {
          created = await api.create(candidate, file.content);
        } catch (err) {
          if (isApiError(err, "name_taken")) refused.add(nameKey(candidate));
          else failure = errorText(err);
        }
      }
      if (created) {
        remember(created);
        results.push({ fileName: file.fileName, outcome: "imported", name: created.name, note: created });
      } else {
        results.push({ fileName: file.fileName, outcome: "rejected", detail: failure ?? "No free name was found." });
      }
      continue;
    }

    let name = file.name;
    let renamed = false;
    for (;;) {
      try {
        const note = await api.create(name, file.content);
        remember(note);
        results.push({ fileName: file.fileName, outcome: renamed ? "renamed" : "imported", name: note.name, note });
        break;
      } catch (err) {
        if (!isApiError(err, "name_taken")) {
          results.push({ fileName: file.fileName, outcome: "rejected", detail: errorText(err) });
          break;
        }
      }

      // ---- conflict: the user decides ------------------------------------------------------
      const takenKeys = taken();
      takenKeys.add(nameKey(name));
      const suggestion = firstFreeName(name, takenKeys);
      const remaining = clashes.filter((i) => i > index).length;
      let decision: { choice: ConflictChoice; applyToAll: boolean };
      if (applyToAll === "rename") decision = { choice: { action: "rename", name: suggestion }, applyToAll: true };
      else if (applyToAll === "skip") decision = { choice: { action: "skip" }, applyToAll: true };
      else if (applyToAll === "replace") decision = { choice: { action: "replace" }, applyToAll: true };
      else decision = await ui.resolveConflict({ fileName: file.fileName, name, suggestion, takenKeys, remaining });

      const { choice } = decision;
      if (choice.action === "skip") {
        if (decision.applyToAll) applyToAll = "skip";
        results.push({ fileName: file.fileName, outcome: "skipped" });
        break;
      }
      if (choice.action === "rename") {
        if (decision.applyToAll) applyToAll = "rename";
        name = choice.name;
        renamed = true;
        continue; // a clash again prompts again
      }

      // replace
      const target = known.get(nameKey(name));
      if (!target) {
        results.push({ fileName: file.fileName, outcome: "rejected", detail: `“${name}” couldn't be found. Nothing was replaced.` });
        break;
      }
      if (applyToAll !== "replace") {
        const names = decision.applyToAll
          ? [target.name, ...clashes.filter((i) => i > index).map((i) => (read[i] as { name: string }).name)]
          : [target.name];
        if (!(await ui.confirmReplace(names))) continue; // back to the conflict prompt
        if (decision.applyToAll) applyToAll = "replace";
      }
      const blocked = opts.replaceBlocked?.(target.id, target.name);
      if (blocked) {
        results.push({ fileName: file.fileName, outcome: "rejected", detail: blocked });
        break;
      }
      try {
        const note = await api.replace(target.id, target.version, file.content);
        known.set(nameKey(note.name), { id: note.id, name: note.name, version: note.version });
        opts.onReplaced?.(note);
        results.push({ fileName: file.fileName, outcome: "replaced", name: note.name, note });
      } catch (err) {
        results.push({ fileName: file.fileName, outcome: "rejected", detail: replaceRefusal(err, target.name) });
      }
      break;
    }
  }
  return results;
}
