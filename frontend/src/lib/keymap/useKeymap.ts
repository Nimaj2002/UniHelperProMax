/** 019: the user's keymap for handlers (plain functions, read at key time) and for hints (hooks). */
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { usePreferences } from "@/features/sessions/api";
import { chordAria, eventMatches } from "./chord";
import { COMMAND_BY_ID } from "./commands";
import { resolveKeymap, type Overrides, type Resolved } from "./conflicts";

let active: Resolved = resolveKeymap();
let recording = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Set by the shortcuts page while it waits for a key: no command runs meanwhile. */
export function setRecording(on: boolean): void {
  recording = on;
}

export function isRecording(): boolean {
  return recording;
}

/** True when the key event is one of the command's keys. Handlers call this at key time, so a
 * change works on the next press (FR-004). */
export function matches(e: KeyboardEvent, commandId: string): boolean {
  if (recording) return false;
  const command = COMMAND_BY_ID.get(commandId);
  const slots = active.slots[commandId];
  return !!command && !!slots && slots.some((b) => b !== null && eventMatches(e, b.chord, command.noShiftVariant));
}

/** The first of these commands the event matches. */
export function matchFirst<T extends string>(e: KeyboardEvent, ids: readonly T[]): T | null {
  return ids.find((id) => matches(e, id)) ?? null;
}

/** The user's keymap as `KeymapSync` last published it (defaults until then); re-renders on change. */
export function useKeymap(): Resolved {
  return useSyncExternalStore(subscribe, () => active);
}

/** Publishes the account's shortcuts to the handlers and hints (mounted once, signed in). */
export function KeymapSync(): null {
  const prefs = usePreferences();
  const overrides = prefs.data?.shortcuts as Overrides | undefined;
  const keymap = useMemo(() => resolveKeymap(overrides ?? {}), [overrides]);
  useEffect(() => {
    active = keymap;
    listeners.forEach((l) => l());
  }, [keymap]);
  return null;
}

export interface ShortcutHint {
  /** "Alt + N", or "" when not set */
  label: string;
  /** `aria-keyshortcuts` value, or undefined when not set */
  aria: string | undefined;
}

export function hintOf(keymap: Resolved, commandId: string): ShortcutHint {
  const slots = (keymap.slots[commandId] ?? [null, null]).filter((b) => b !== null);
  return {
    label: slots[0]?.label ?? "",
    aria: slots.length ? slots.map((b) => chordAria(b.chord)).join(" ") : undefined,
  };
}

/** Label and `aria-keyshortcuts` of a command, following the user's keys (FR-005). */
export function useShortcut(commandId: string): ShortcutHint {
  const keymap = useKeymap();
  return hintOf(keymap, commandId);
}
