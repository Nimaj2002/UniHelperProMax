import { useEffect, useRef } from "react";
import { matches } from "@/lib/keymap";

export interface WorkspaceActions {
  newNote: () => void;
  /** 006: Alt+Shift+N */
  importNote?: () => void;
  closeTab: () => void;
  nextTab: () => void;
  prevTab: () => void;
  toggleLeft: () => void;
  toggleRight: () => void;
  /** 007: Alt+\ toggles split view */
  toggleSplit?: () => void;
  /** 014: Alt+K focuses the chat message box (opening the panel and Chat, or the chat tab) */
  focusChat?: () => void;
  /** 014: Alt+Shift+K starts a new chat */
  newChat?: () => void;
}

const ACTIONS: readonly (keyof WorkspaceActions)[] = [
  "newNote", "importNote", "closeTab", "nextTab", "prevTab", "toggleLeft", "toggleRight", "toggleSplit", "focusChat", "newChat",
];

/** FR-024 shortcuts (contracts/ui-workspace.md), keys from the 019 keymap (`workspace.<action>`).
 * They need Alt, Ctrl or Cmd, so they work inside the editor too; `Mod+E` (live/raw) is bound
 * inside the editor itself. */
export function useWorkspaceKeyboard(actions: WorkspaceActions) {
  const ref = useRef(actions);
  useEffect(() => {
    ref.current = actions;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !(e.altKey || e.ctrlKey || e.metaKey)) return;
      if (document.querySelector("[role='dialog'][data-state='open'],[role='alertdialog'][data-state='open']")) return;
      const action = ACTIONS.find((a) => matches(e, `workspace.${a}`));
      const run = action && ref.current[action];
      if (!run) return;
      e.preventDefault();
      run();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
