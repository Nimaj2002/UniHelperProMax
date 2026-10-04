import { useEffect, useRef } from "react";

export interface WorkspaceActions {
  newNote: () => void;
  closeTab: () => void;
  nextTab: () => void;
  prevTab: () => void;
  toggleLeft: () => void;
  toggleRight: () => void;
}

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
      const a = ref.current;
      const map: Record<string, () => void> = {
        KeyN: a.newNote,
        KeyW: a.closeTab,
        PageDown: a.nextTab,
        PageUp: a.prevTab,
        BracketLeft: a.toggleLeft,
        BracketRight: a.toggleRight,
      };
      const run = map[e.code];
      if (!run) return;
      e.preventDefault();
      run();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
