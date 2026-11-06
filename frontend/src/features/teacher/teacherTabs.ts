/**
 * 022: the workspace's teacher tabs, as the AI Teacher section and the teacher tab see them. The
 * workspace page registers itself as the host (like 014's chat tabs host).
 */
import { useSyncExternalStore } from "react";

export interface TeacherTabsHost {
  sessionKey: string;
  /** Open (or focus) a teacher chat's tab. */
  open: (id: string) => void;
  /** A new chat's tab became a saved chat (its first send). */
  replace: (from: string, to: string) => void;
  close: (id: string) => void;
}

let host: TeacherTabsHost | null = null;
const listeners = new Set<() => void>();

export function setTeacherTabsHost(next: TeacherTabsHost | null) {
  host = next;
  listeners.forEach((l) => l());
}

export function useTeacherTabsHost(): TeacherTabsHost | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => host,
    () => host,
  );
}
