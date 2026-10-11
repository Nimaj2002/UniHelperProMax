import { useMemo, useReducer } from "react";
import type { Draft, DraftOrigin, DraftRange } from "./draft";

/**
 * The calendar's single new-entry draft (009 FR-036–FR-040). `drag`: the pointer is held;
 * `select`: a keyboard range in the time grid; `open`: the quick form is open for it.
 * Nothing here is ever stored on the server; Save in the quick form does that.
 */
export type DraftPhase = "drag" | "select" | "open";

export interface DraftState {
  draft: Draft | null;
  phase: DraftPhase | null;
  /** Something was entered in the quick form: outside clicks and new presses keep it (FR-039). */
  dirty: boolean;
  nextId: number;
}

export const initialDraftState: DraftState = { draft: null, phase: null, dirty: false, nextId: 1 };

export type DraftAction =
  | { type: "start"; date: string; range: DraftRange; origin: DraftOrigin; phase: DraftPhase }
  | { type: "update"; id: number; range: DraftRange; date?: string }
  | { type: "open"; id: number; range?: DraftRange }
  | { type: "dirty"; id: number; dirty: boolean }
  /** Without `id`: whatever draft there is (Escape, leaving the page). */
  | { type: "discard"; id?: number };

/** Whether a new press may replace the current draft: only when nothing was entered (FR-040). */
export function canReplace(s: DraftState): boolean {
  return !(s.phase === "open" && s.dirty);
}

export function draftReducer(s: DraftState, a: DraftAction): DraftState {
  switch (a.type) {
    case "start": {
      if (!canReplace(s)) return s;
      const draft: Draft = { id: s.nextId, date: a.date, origin: a.origin, ...a.range };
      return { draft, phase: a.phase, dirty: false, nextId: s.nextId + 1 };
    }
    case "update": {
      if (!s.draft || s.draft.id !== a.id) return s;
      const { startMin, endMin } = a.range;
      const date = a.date ?? s.draft.date;
      if (startMin === s.draft.startMin && endMin === s.draft.endMin && date === s.draft.date) return s;
      return { ...s, draft: { ...s.draft, date, startMin, endMin } };
    }
    case "open":
      if (!s.draft || s.draft.id !== a.id) return s;
      return { ...s, phase: "open", draft: a.range ? { ...s.draft, ...a.range } : s.draft };
    case "dirty":
      if (!s.draft || s.draft.id !== a.id || s.dirty === a.dirty) return s;
      return { ...s, dirty: a.dirty };
    case "discard":
      if (!s.draft || (a.id !== undefined && s.draft.id !== a.id)) return s;
      return { ...s, draft: null, phase: null, dirty: false };
  }
}

export function useDraft() {
  const [state, dispatch] = useReducer(draftReducer, initialDraftState);
  const actions = useMemo(
    () => ({
      start: (date: string, range: DraftRange, origin: DraftOrigin, phase: DraftPhase) =>
        dispatch({ type: "start", date, range, origin, phase }),
      update: (id: number, range: DraftRange, date?: string) => dispatch({ type: "update", id, range, date }),
      open: (id: number, range?: DraftRange) => dispatch({ type: "open", id, range }),
      setDirty: (id: number, dirty: boolean) => dispatch({ type: "dirty", id, dirty }),
      discard: (id?: number) => dispatch({ type: "discard", id }),
    }),
    [],
  );
  return { state, ...actions };
}

export type DraftControls = ReturnType<typeof useDraft>;
