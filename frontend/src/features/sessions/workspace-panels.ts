/** Right-panel content of the session workspace (feature 003 registers the audio panel). */
import { useSyncExternalStore, type ComponentType } from "react";

export interface WorkspacePanelProps {
  sessionKey: string;
}

export interface WorkspacePanel {
  id: string;
  title: string;
  component: ComponentType<WorkspacePanelProps>;
}

let panels: WorkspacePanel[] = [];
const listeners = new Set<() => void>();

export function registerWorkspacePanel(panel: WorkspacePanel) {
  panels = [...panels.filter((p) => p.id !== panel.id), panel];
  listeners.forEach((l) => l());
}

export function useWorkspacePanels(): WorkspacePanel[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => panels,
    () => panels,
  );
}
