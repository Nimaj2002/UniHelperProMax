/**
 * 014 T126 FR-072, 019 FR-006: every default binding comes from the keymap registry. Fails on two
 * commands with the same keys where they meet, and on keys the browsers or the system keep (the
 * Firefox/Chrome/Edge menu accelerators Alt+F/E/V/S/B/T/H, Ctrl/Cmd+K/L/T/W/N, …).
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useWorkspaceKeyboard } from "@/features/sessions/useWorkspaceKeyboard";
import { checkChord, COMMANDS, findConflict, resolveKeymap } from "@/lib/keymap";

const defaults = resolveKeymap();
const bindings = COMMANDS.flatMap((c) => ([0, 1] as const).flatMap((slot) => (c.defaults[slot] ? [{ c, slot, chord: c.defaults[slot]! }] : [])));

describe("shortcut conflicts (FR-072, 019)", () => {
  it("has one registry entry per command, each with at least one default", () => {
    expect(new Set(COMMANDS.map((c) => c.id)).size).toBe(COMMANDS.length);
    expect(COMMANDS.filter((c) => !c.defaults[0]).map((c) => c.id)).toEqual([]);
    expect(bindings.length).toBeGreaterThan(50);
  });

  it("binds no keys twice where they meet", () => {
    const clashes = bindings.flatMap(({ c, slot, chord }) => {
      const other = findConflict(defaults, c.id, slot, chord);
      return other ? [`${chord}: ${c.id} / ${other.commandId}`] : [];
    });
    expect(clashes).toEqual([]);
  });

  it("leaves the browsers' and the system's own keys alone, and every default is a key the user could pick", () => {
    expect(bindings.filter(({ c, chord }) => checkChord(c, chord) !== null).map(({ c, chord }) => `${chord} (${c.id}: ${checkChord(c, chord)})`)).toEqual([]);
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
