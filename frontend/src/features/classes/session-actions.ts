/** Extra actions shown in the session details (US4 edit/delete, 002 "Open workspace"). */
import { useSyncExternalStore, type ComponentType } from "react";
import type { Session } from "./api";

export interface SessionActionProps {
  session: Session;
  close: () => void;
}

export interface SessionAction {
  id: string;
  priority?: number;
  component: ComponentType<SessionActionProps>;
}

let actions: SessionAction[] = [];
const listeners = new Set<() => void>();

export function registerSessionAction(action: SessionAction) {
  actions = [...actions.filter((a) => a.id !== action.id), action].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
  listeners.forEach((l) => l());
}

export function useSessionActions(): SessionAction[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => actions,
    () => actions,
  );
}
