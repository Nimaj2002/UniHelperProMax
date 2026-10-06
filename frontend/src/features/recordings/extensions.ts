/**
 * Per-recording extension points of the audio panel (feature 004 adds Transcribe + status).
 * Same pattern as the workspace panel registry: features register at module load.
 */
import { useSyncExternalStore, type ComponentType } from "react";
import type { Recording } from "./api";

export interface RecordingExtensionProps {
  recording: Recording;
  sessionKey: string;
}

export interface RecordingExtension {
  id: string;
  /** Button(s) shown next to the recording's menu. */
  Action?: ComponentType<RecordingExtensionProps>;
  /** Status rows shown under the recording. */
  Details?: ComponentType<RecordingExtensionProps>;
}

let extensions: RecordingExtension[] = [];
const listeners = new Set<() => void>();

export function registerRecordingExtension(ext: RecordingExtension) {
  extensions = [...extensions.filter((e) => e.id !== ext.id), ext];
  listeners.forEach((l) => l());
}

export function useRecordingExtensions(): RecordingExtension[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => extensions,
    () => extensions,
  );
}
