/**
 * 014 T126 FR-072 (research R13): every app keyboard binding in one table. Fails on two actions
 * bound to the same keys in the same place, and on keys the browsers keep for themselves (the
 * Firefox/Chrome/Edge menu accelerators Alt+F/E/V/S/B/T/H and Ctrl/Cmd+K/L/T/W/N).
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CALENDAR_SHORTCUTS } from "@/features/calendar/useCalendarKeyboard";
import { useWorkspaceKeyboard, WORKSPACE_SHORTCUTS } from "@/features/sessions/useWorkspaceKeyboard";

interface Binding {
  /** "Alt+Shift+KeyK": modifiers in a fixed order, then the `KeyboardEvent.code`. */
  chord: string;
  owner: string;
  /** Where it is active: bindings in different scopes never meet. */
  scope: "app" | "calendar" | "editor" | "chat-box";
}

const CODE: Record<string, string> = {
  "[": "BracketLeft", "]": "BracketRight", "\\": "Backslash", "/": "Slash", "?": "Slash", PageUp: "PageUp", PageDown: "PageDown",
  "←": "ArrowLeft", "→": "ArrowRight", "↑": "ArrowUp", "↓": "ArrowDown", Enter: "Enter", Esc: "Escape", Space: "Space",
};
const codeOf = (key: string) => CODE[key] ?? (/^[A-Z]$/.test(key) ? `Key${key}` : key);

function chord(keys: string): string {
  const parts = keys.split("+").map((p) => p.trim()).filter(Boolean);
  const key = parts.pop() ?? "";
  const mods = new Set(parts.map((m) => (m === "Mod" ? "Ctrl" : m)));
  if (key === "?") mods.add("Shift");
  const order = ["Ctrl", "Meta", "Alt", "Shift"].filter((m) => mods.has(m));
  return [...order, codeOf(key)].join("+");
}

/** The calendar's help table, one binding per listed key ("D / W / M", "← / →  or  K / J"). */
function calendarBindings(): Binding[] {
  return CALENDAR_SHORTCUTS.flatMap(([keys, label]) => {
    // rows about moving inside the grid or the task board are local to those widgets
    if (/inside|picked-up|task card|focused session|Clear the range/.test(label)) return [];
    return keys
      .split(/\s+or\s+|\s\/\s/)
      .map((k) => k.trim())
      .filter((k) => k && !k.includes(" "))
      .map((k) => ({ chord: chord(k.replace(/\s/g, "")), owner: `calendar: ${label}`, scope: "calendar" as const }));
  });
}

const APP: Binding[] = [
  // AppShell (001 FR-023, 008 FR-024): bare keys, never while typing
  { chord: chord("["), owner: "AppShell: side panel", scope: "app" },
  { chord: chord("\\"), owner: "AppShell: focus mode", scope: "app" },
  { chord: chord("/"), owner: "AppShell: course search", scope: "app" },
  // HomePage (FR-070): by key position
  { chord: chord("Shift+C"), owner: "HomePage: calendar panel", scope: "app" },
  { chord: chord("Shift+T"), owner: "HomePage: tasks panel", scope: "app" },
  // the workspace's Alt bindings, including 014's Alt+K and Alt+Shift+K
  ...WORKSPACE_SHORTCUTS.map((s) => ({ chord: chord(s.keys), owner: `workspace: ${s.action}`, scope: "app" as const })),
];
const EDITOR: Binding[] = [{ chord: chord("Mod+E"), owner: "editor: live/raw", scope: "editor" }];
const CHAT_BOX: Binding[] = [
  { chord: chord("Enter"), owner: "chat box: send", scope: "chat-box" },
  { chord: chord("Shift+Enter"), owner: "chat box: new line", scope: "chat-box" },
  { chord: chord("Esc"), owner: "chat box: stop", scope: "chat-box" },
];

const RESERVED = [
  ..."FEVSBTH".split("").map((k) => chord(`Alt+${k}`)),
  ..."KLTWN".split("").flatMap((k) => [chord(`Ctrl+${k}`), chord(`Meta+${k}`)]),
];

const ALL = [...APP, ...EDITOR, ...CHAT_BOX, ...calendarBindings()];

describe("shortcut conflicts (FR-072)", () => {
  it("lists the new chat shortcuts, matched by key position", () => {
    expect(WORKSPACE_SHORTCUTS.find((s) => s.action === "focusChat")).toMatchObject({ keys: "Alt+K", code: "KeyK", shift: false });
    expect(WORKSPACE_SHORTCUTS.find((s) => s.action === "newChat")).toMatchObject({ keys: "Alt+Shift+K", code: "KeyK", shift: true });
    expect(WORKSPACE_SHORTCUTS.find((s) => s.action === "toggleRight")).toMatchObject({ keys: "Alt+]" });
  });

  it("binds no keys twice in the same place", () => {
    // the calendar's help repeats AppShell's "/" and "[" (the same bindings, documented there)
    const appChords = new Set(APP.map((b) => b.chord));
    const list = ALL.filter((b) => !(b.scope === "calendar" && appChords.has(b.chord)));
    // app-wide keys are live on every page, so they meet the calendar's, the editor's and the box's
    const meet = (x: Binding, y: Binding) => x.scope === y.scope || x.scope === "app" || y.scope === "app";
    const dupes = list.flatMap((x, i) =>
      list.slice(i + 1).filter((y) => y.chord === x.chord && y.owner !== x.owner && meet(x, y)).map((y) => `${x.chord}: ${x.owner} / ${y.owner}`),
    );
    expect(dupes).toEqual([]);
    expect(list.length).toBeGreaterThan(20);
  });

  it("leaves the browsers' own keys alone", () => {
    expect(ALL.filter((b) => RESERVED.includes(b.chord)).map((b) => `${b.chord} (${b.owner})`)).toEqual([]);
  });

  it("matches Alt+K and Alt+Shift+K by e.code, so macOS Option characters work", () => {
    const focusChat = vi.fn();
    const newChat = vi.fn();
    const noop = () => {};
    renderHook(() =>
      useWorkspaceKeyboard({ focusChat, newChat, newNote: noop, closeTab: noop, nextTab: noop, prevTab: noop, toggleLeft: noop, toggleRight: noop }),
    );
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyK", key: "˚", altKey: true }));
    expect(focusChat).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyK", key: "K", altKey: true, shiftKey: true }));
    expect(newChat).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyK", key: "k", altKey: true, ctrlKey: true }));
    expect(focusChat).toHaveBeenCalledTimes(1);
  });
});
