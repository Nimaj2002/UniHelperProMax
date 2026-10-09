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

// ---- left-panel sections between Notes and Sessions (007: Documents) --------------------------------

export interface SidePanelSectionProps {
  sessionKey: string;
  /** Open (or focus) a document as a tab of the workspace tab bar. */
  openDocument: (documentId: string) => void;
  /** Close a document's tab without asking (the document was deleted). */
  closeDocument: (documentId: string) => void;
}

export interface SidePanelSection {
  id: string;
  /** The section's collapsible header in the left panel. */
  title: string;
  component: ComponentType<SidePanelSectionProps>;
}

let sections: SidePanelSection[] = [];
const sectionListeners = new Set<() => void>();

export function registerSidePanelSection(section: SidePanelSection) {
  sections = [...sections.filter((s) => s.id !== section.id), section];
  sectionListeners.forEach((l) => l());
}

export function useSidePanelSections(): SidePanelSection[] {
  return useSyncExternalStore(
    (l) => {
      sectionListeners.add(l);
      return () => sectionListeners.delete(l);
    },
    () => sections,
    () => sections,
  );
}
