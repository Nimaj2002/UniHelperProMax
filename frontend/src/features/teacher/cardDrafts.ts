/**
 * 022 (edge case "the app closes with unsent answers"): what the student has typed or chosen on a
 * question card, per chat and question, kept in this browser until the answer is submitted.
 * An in-memory copy keeps the cards and the shared "Submit answers" in step (and working without
 * storage).
 */
import { useCallback, useSyncExternalStore } from "react";
import { readLocal, writeLocal } from "@/lib/storage";
import type { Confidence } from "./api";

export interface CardDraft {
  choice: number | null;
  text: string;
  /** The fixed "I don't know" answer. */
  dontKnow: boolean;
  confidence: Confidence | null;
  thinking: string;
}

export const EMPTY_CARD: CardDraft = { choice: null, text: "", dontKnow: false, confidence: null, thinking: "" };
const key = (chatId: string, questionId: string) => `uh.teacher.card.${chatId}.${questionId}`;
const memory = new Map<string, CardDraft>();
const listeners = new Set<() => void>();
const subscribe = (on: () => void) => {
  listeners.add(on);
  return () => listeners.delete(on);
};

export function readCard(chatId: string, questionId: string): CardDraft {
  const k = key(chatId, questionId);
  let draft = memory.get(k);
  if (!draft) {
    const raw = readLocal<Partial<CardDraft> | null>(k, null);
    draft = raw && typeof raw === "object" ? { ...EMPTY_CARD, ...raw } : EMPTY_CARD;
    if (typeof draft.confidence === "string") draft = { ...draft, confidence: null }; // a pre-slider level
    memory.set(k, draft);
  }
  return draft;
}

function writeCard(chatId: string, questionId: string, draft: CardDraft) {
  memory.set(key(chatId, questionId), draft);
  writeLocal(key(chatId, questionId), draft);
  listeners.forEach((on) => on());
}

export function clearCard(chatId: string, questionId: string) {
  memory.delete(key(chatId, questionId));
  try {
    localStorage.removeItem(key(chatId, questionId));
  } catch {
    // storage unavailable: nothing was kept
  }
  listeners.forEach((on) => on());
}

/** A card's draft, saved as it changes. */
export function useCardDraft(chatId: string, questionId: string): [CardDraft, (patch: Partial<CardDraft>) => void] {
  const draft = useSyncExternalStore(subscribe, () => readCard(chatId, questionId));
  const update = useCallback(
    (patch: Partial<CardDraft>) => writeCard(chatId, questionId, { ...readCard(chatId, questionId), ...patch }),
    [chatId, questionId],
  );
  return [draft, update];
}

export const isFilled = (q: { kind: "choice" | "text" }, d: CardDraft) =>
  d.dontKnow || (q.kind === "choice" ? d.choice !== null : d.text.trim().length > 0);

/** True when every one of these questions has an answer (re-renders when that changes). */
export function useAllFilled(chatId: string, questions: { id: string; kind: "choice" | "text" }[]): boolean {
  return useSyncExternalStore(subscribe, () => questions.every((q) => isFilled(q, readCard(chatId, q.id))));
}
