/**
 * Session panel content of the session workspace: its Recordings section (feature 003 registers
 * the audio panel) and its Chat section (feature 014 registers the chat).
 */
import { useSyncExternalStore, type ComponentType } from "react";

export interface WorkspacePanelProps {
  sessionKey: string;
}

export interface WorkspacePanel {
  id: string;
  title: string;
  component: ComponentType<WorkspacePanelProps>;
  /** Buttons in the Recordings section's header, beside its title (008 FR-020: Record, Upload). */
  headerActions?: ComponentType<WorkspacePanelProps>;
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

// ---- the session panel's Chat section (014) -------------------------------------------------------

export interface ChatSectionProps {
  sessionKey: string;
}

export interface ChatSection {
  /** The section's body: the chat history or conversation and the message box. */
  component: ComponentType<ChatSectionProps>;
  /** Buttons in the Chat section's header, beside its title (Search chats, New chat, …). */
  headerActions?: ComponentType<ChatSectionProps>;
}

let chatSection: ChatSection | null = null;
const chatListeners = new Set<() => void>();

/** Fill the session panel's Chat section (until then it shows an empty placeholder). */
export function registerChatSection(section: ChatSection) {
  chatSection = section;
  chatListeners.forEach((l) => l());
  return () => {
    if (chatSection === section) chatSection = null;
    chatListeners.forEach((l) => l());
  };
}

export function useChatSection(): ChatSection | null {
  return useSyncExternalStore(
    (l) => {
      chatListeners.add(l);
      return () => chatListeners.delete(l);
    },
    () => chatSection,
    () => chatSection,
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
  /** Shown only for these sessions (012: the course's Tasks for class sessions); default all. */
  when?: (session: { courseId: string | null; kind: string }) => boolean;
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
