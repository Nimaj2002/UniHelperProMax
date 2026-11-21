/**
 * The Media Editor's tools (025 FR-015). Trim is the first; a new tool is a folder under `tools/`
 * plus one `registerTool` call, with no change to the page layout, rail or save flow.
 */
import type { Icon } from "@phosphor-icons/react";
import { useSyncExternalStore, type ComponentType } from "react";
import type { MediaRecording } from "./api";

export interface ToolProps {
  recording: MediaRecording;
  sessionKey: string;
}

export interface EditorTool {
  id: string;
  title: string;
  icon: Icon;
  component: ComponentType<ToolProps>;
  priority?: number;
}

let tools: EditorTool[] = [];
const listeners = new Set<() => void>();

export function registerTool(tool: EditorTool) {
  tools = [...tools.filter((t) => t.id !== tool.id), tool].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
  listeners.forEach((l) => l());
}

export function useTools(): EditorTool[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => tools,
    () => tools,
  );
}
