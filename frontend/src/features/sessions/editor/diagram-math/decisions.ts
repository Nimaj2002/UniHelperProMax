/**
 * The user's answers about a diagram's own settings (FR-032a, research R10), kept in this
 * browser only and never in the note. An answer is tied to the diagram's exact source, so
 * editing the diagram asks again.
 */
import { useCallback, useSyncExternalStore } from "react";
import { readLocal, writeLocal } from "@/lib/storage";
import { hashString } from "./katexLoader";

export interface Decision {
  unsafe?: "allow" | "safe";
  theme?: "own" | "app";
  at: string;
}

type NoteDecisions = Record<string, Decision>;

const PREFIX = "uh.diagramDecisions.";
const INDEX_KEY = "uh.diagramDecisions.index";
export const MAX_PER_NOTE = 100;
export const MAX_NOTES = 200;

const listeners = new Set<() => void>();
const memory = new Map<string, NoteDecisions>();
let version = 0;
const notify = () => {
  version++;
  listeners.forEach((l) => l());
};

/** The identity of a diagram's source (its body and info string). */
export function diagramHash(source: string, info = ""): string {
  return `${hashString(info + "\u0000" + source).toString(36)}${source.length.toString(36)}`;
}

function load(noteId: string): NoteDecisions {
  let d = memory.get(noteId);
  if (!d) {
    d = readLocal<NoteDecisions>(PREFIX + noteId, {});
    memory.set(noteId, d);
  }
  return d;
}

function save(noteId: string, decisions: NoteDecisions) {
  // newest last; keep at most MAX_PER_NOTE
  const entries = Object.entries(decisions).sort((a, b) => a[1].at.localeCompare(b[1].at));
  const kept = Object.fromEntries(entries.slice(-MAX_PER_NOTE));
  memory.set(noteId, kept);
  writeLocal(PREFIX + noteId, kept);
  const index = readLocal<Record<string, string>>(INDEX_KEY, {});
  index[noteId] = new Date().toISOString();
  const notes = Object.entries(index).sort((a, b) => a[1].localeCompare(b[1]));
  for (const [old] of notes.slice(0, Math.max(0, notes.length - MAX_NOTES))) {
    delete index[old];
    memory.delete(old);
    try {
      window.localStorage.removeItem(PREFIX + old);
    } catch {
      /* storage unavailable */
    }
  }
  writeLocal(INDEX_KEY, index);
  notify();
}

export function getDecision(noteId: string, hash: string): Decision | undefined {
  return load(noteId)[hash];
}

export function setDecision(noteId: string, hash: string, answer: Partial<Omit<Decision, "at">>) {
  const all = { ...load(noteId) };
  all[hash] = { ...all[hash], ...answer, at: new Date().toISOString() };
  save(noteId, all);
}

export function resetDecision(noteId: string, hash: string) {
  const all = { ...load(noteId) };
  delete all[hash];
  save(noteId, all);
}

/** Forgets a note's decisions (when the note is deleted in this browser). */
export function forgetNote(noteId: string) {
  memory.delete(noteId);
  try {
    window.localStorage.removeItem(PREFIX + noteId);
  } catch {
    /* storage unavailable */
  }
  notify();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useDecision(noteId: string | undefined, hash: string): Decision | undefined {
  const get = useCallback(() => (noteId ? getDecision(noteId, hash) : undefined), [noteId, hash]);
  return useSyncExternalStore(subscribe, get);
}

/** Changes whenever any decision changes. */
export function useDecisionsVersion(): number {
  return useSyncExternalStore(subscribe, () => version);
}
