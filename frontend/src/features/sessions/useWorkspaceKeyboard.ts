import { useEffect, useRef } from "react";

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

export interface WorkspaceShortcut {
  /** As shown to people and in `aria-keyshortcuts`. */
  keys: string;
  /** `KeyboardEvent.code`: by key position, so other layouts and macOS Option characters work. */
  code: string;
  shift: boolean;
  action: keyof WorkspaceActions;
}

/** Every Alt binding of the workspace (FR-024, 006, 007, 014 FR-072); shortcut-conflicts.test.ts checks them. */
export const WORKSPACE_SHORTCUTS: readonly WorkspaceShortcut[] = [
  { keys: "Alt+N", code: "KeyN", shift: false, action: "newNote" },
  { keys: "Alt+Shift+N", code: "KeyN", shift: true, action: "importNote" },
  { keys: "Alt+W", code: "KeyW", shift: false, action: "closeTab" },
  { keys: "Alt+PageDown", code: "PageDown", shift: false, action: "nextTab" },
  { keys: "Alt+PageUp", code: "PageUp", shift: false, action: "prevTab" },
  { keys: "Alt+[", code: "BracketLeft", shift: false, action: "toggleLeft" },
  { keys: "Alt+]", code: "BracketRight", shift: false, action: "toggleRight" },
  { keys: "Alt+\\", code: "Backslash", shift: false, action: "toggleSplit" },
  { keys: "Alt+K", code: "KeyK", shift: false, action: "focusChat" },
  { keys: "Alt+Shift+K", code: "KeyK", shift: true, action: "newChat" },
];

/** FR-024 shortcuts (contracts/ui-workspace.md). Alt-combos work inside the editor too;
 * `Mod+E` (live/raw) is bound inside the editor itself. */
export function useWorkspaceKeyboard(actions: WorkspaceActions) {
  const ref = useRef(actions);
  useEffect(() => {
    ref.current = actions;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      if (document.querySelector("[role='dialog'][data-state='open'],[role='alertdialog'][data-state='open']")) return;
      const binding = WORKSPACE_SHORTCUTS.find((s) => s.code === e.code && s.shift === e.shiftKey);
      const run = binding && ref.current[binding.action];
      if (!run) return;
      e.preventDefault();
      run();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
