/**
 * Keyboard moving of a card (FR-016, research R2) as a pure reducer: Enter/Space picks up a
 * focused card, ↑/↓ move it within its column, ←/→ to the neighbouring column at the nearest
 * index, Enter drops (one move request), Escape restores. Indexes are insertion indexes among the
 * column's cards without the moved one (see `dropTarget.ts`).
 */
import type { BoardLayout, DropTarget } from "./dropTarget";

export interface KeyboardMoveState {
  taskId: string;
  origin: DropTarget;
  target: DropTarget;
}

export type KeyboardMoveAction =
  | { type: "pickUp"; taskId: string; layout: BoardLayout }
  | { type: "up" | "down" | "left" | "right"; layout: BoardLayout }
  | { type: "drop" | "cancel" };

type State = KeyboardMoveState | null;

/** Cards of a column the moved card can be placed among. */
function restLength(layout: BoardLayout, columnId: string, taskId: string): number {
  const col = layout.find((c) => c.id === columnId);
  if (!col) return 0;
  return col.taskIds.filter((id) => id !== taskId).length;
}

export function keyboardMove(state: State, action: KeyboardMoveAction): State {
  switch (action.type) {
    case "pickUp": {
      const col = action.layout.find((c) => c.taskIds.includes(action.taskId));
      if (!col) return state;
      const origin = { columnId: col.id, index: col.taskIds.indexOf(action.taskId) };
      return { taskId: action.taskId, origin, target: origin };
    }
    case "up":
    case "down": {
      if (!state) return state;
      const len = restLength(action.layout, state.target.columnId, state.taskId);
      const index = Math.max(0, Math.min(len, state.target.index + (action.type === "up" ? -1 : 1)));
      return index === state.target.index ? state : { ...state, target: { ...state.target, index } };
    }
    case "left":
    case "right": {
      if (!state) return state;
      const at = action.layout.findIndex((c) => c.id === state.target.columnId);
      const next = action.layout[at + (action.type === "left" ? -1 : 1)];
      if (at === -1 || !next) return state;
      const index = Math.min(state.target.index, restLength(action.layout, next.id, state.taskId));
      return { ...state, target: { columnId: next.id, index } };
    }
    case "drop":
    case "cancel":
      return null;
  }
}

interface Named {
  id: string;
  name: string;
}

interface Titled {
  id: string;
  title: string;
}

/**
 * The live-region text for a step. `state` is the state the step produced (for "drop" and
 * "cancel": the state before it). Positions count the moved card ("2 of 5").
 */
export function announcement(
  type: KeyboardMoveAction["type"],
  state: State,
  columns: readonly Named[],
  tasks: readonly Titled[],
  layout: BoardLayout,
): string {
  if (type === "cancel") return "Move cancelled.";
  if (!state) return "";
  const name = columns.find((c) => c.id === state.target.columnId)?.name ?? "";
  const total = restLength(layout, state.target.columnId, state.taskId) + 1;
  const position = `position ${state.target.index + 1} of ${total}`;
  if (type === "pickUp") {
    const title = tasks.find((t) => t.id === state.taskId)?.title ?? "task";
    return `Picked up ${title}. Position ${state.target.index + 1} of ${total} in ${name}.`;
  }
  if (type === "drop") return `Dropped in ${name}, ${position}.`;
  return `Moved to ${name}, ${position}.`;
}
