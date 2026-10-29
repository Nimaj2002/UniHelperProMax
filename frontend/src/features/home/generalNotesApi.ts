import { useQuery } from "@tanstack/react-query";
import type { Note, NoteMeta } from "@/features/sessions/api";
import { apiFetch } from "@/lib/api";

/** General notes (018): notes in `<user>/General Notes/`, tied to no session. */
export const generalNotesKey = ["general-notes"] as const;

export function useGeneralNotes() {
  return useQuery({ queryKey: generalNotesKey, queryFn: () => apiFetch<NoteMeta[]>("/general-notes") });
}

export function createGeneralNote(name: string) {
  return apiFetch<Note>("/general-notes", { method: "POST", body: { name } });
}

/** Name a new note gets until its first line names it (research R6). */
export const AUTO_NAME = /^General note \d{4}-\d{2}-\d{2} \d{2}-\d{2}( \(\d+\))?$/;

export function autoName(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `General note ${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}-${p(now.getMinutes())}`;
}

/** The note's first non-empty line without Markdown heading marks, cut to 60 characters. */
export function nameFromText(text: string): string {
  const line = text.split("\n").find((l) => l.trim()) ?? "";
  return line.replace(/^\s*#+\s*/, "").trim().slice(0, 60).trim();
}
