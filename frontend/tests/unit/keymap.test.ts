/** 019: chord parsing, refused keys, the conflict rule and the resolved keymap. */
import { describe, expect, it } from "vitest";
import { checkChord, chordAria, chordFromEvent, chordLabel, COMMAND_BY_ID, findConflict, resolveKeymap, setSlot } from "@/lib/keymap";
import { eventMatches } from "@/lib/keymap/chord";

const key = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);
const cmd = (id: string) => COMMAND_BY_ID.get(id)!;
const b = (chord: string, label = chord) => ({ chord, label });

describe("chordFromEvent", () => {
  it("reads letters by position with the pressed key as label", () => {
    expect(chordFromEvent(key({ code: "KeyM", key: "M", altKey: true, shiftKey: true }))).toEqual({ chord: "Alt+Shift+KeyM", label: "Alt + Shift + M" });
    // AZERTY: the key at the Q position types "a"
    expect(chordFromEvent(key({ code: "KeyQ", key: "a", ctrlKey: true }))).toEqual({ chord: "Ctrl+KeyQ", label: "Ctrl + A" });
  });
  it("shows shifted punctuation as the character", () => {
    expect(chordFromEvent(key({ code: "Slash", key: "?", shiftKey: true }))).toEqual({ chord: "Shift+Slash", label: "?" });
  });
  it("names special and numpad keys, and macOS Option characters fall back", () => {
    expect(chordFromEvent(key({ code: "Escape", key: "Escape" }))?.label).toBe("Esc");
    expect(chordFromEvent(key({ code: "Space", key: " " }))?.label).toBe("Space");
    expect(chordFromEvent(key({ code: "NumpadAdd", key: "+" }))?.chord).toBe("NumpadAdd");
    expect(chordFromEvent(key({ code: "KeyK", key: "˚", altKey: true }))).toEqual({ chord: "Alt+KeyK", label: "Alt + K" });
  });
  it("ignores a press of only modifiers", () => {
    expect(chordFromEvent(key({ code: "AltLeft", key: "Alt", altKey: true }))).toBeNull();
    expect(chordFromEvent(key({ code: "ShiftRight", key: "Shift", shiftKey: true }))).toBeNull();
  });
});

describe("eventMatches", () => {
  it("matches bare symbol keys by the character typed, whatever the layout", () => {
    expect(eventMatches(key({ code: "Slash", key: "?", shiftKey: true }), "Shift+Slash")).toBe(true);
    expect(eventMatches(key({ code: "Slash", key: "?" }), "Shift+Slash")).toBe(true); // shift implied by the character
    expect(eventMatches(key({ code: "Slash", key: "?", shiftKey: true }), "Slash")).toBe(false);
    expect(eventMatches(key({ code: "Digit7", key: "/", shiftKey: true }), "Slash")).toBe(true); // German "/"
    expect(eventMatches(key({ code: "BracketLeft", key: "[" }), "BracketLeft")).toBe(true);
  });
  it("matches letters and modifier combos by position", () => {
    expect(eventMatches(key({ code: "KeyK", key: "˚", altKey: true }), "Alt+KeyK")).toBe(true);
    expect(eventMatches(key({ code: "BracketRight", key: "‘", altKey: true }), "Alt+BracketRight")).toBe(true);
    expect(eventMatches(key({ code: "KeyQ", key: "a" }), "KeyQ")).toBe(true);
  });
});

describe("labels", () => {
  it("formats defaults", () => {
    expect(chordLabel("Shift+Slash")).toBe("?");
    expect(chordLabel("Alt+BracketRight")).toBe("Alt + ]");
    expect(chordLabel("Ctrl+Enter")).toBe("Ctrl + Enter");
    expect(chordAria("Alt+Shift+KeyK")).toBe("Alt+Shift+K");
    expect(chordAria("Ctrl+Enter")).toBe("Control+Enter");
  });
});

describe("checkChord", () => {
  it("refuses Tab, browser keys, bare keys for commands that work while typing, and Shift on step moves", () => {
    expect(checkChord(cmd("workspace.newNote"), "Tab")).toBe("tab");
    expect(checkChord(cmd("workspace.newNote"), "Shift+Tab")).toBe("tab");
    expect(checkChord(cmd("workspace.newNote"), "Ctrl+KeyC")).toBe("reserved");
    expect(checkChord(cmd("workspace.newNote"), "Meta+KeyQ")).toBe("reserved");
    expect(checkChord(cmd("workspace.newNote"), "Alt+KeyF")).toBe("reserved");
    expect(checkChord(cmd("workspace.newNote"), "KeyQ")).toBe("needsModifier");
    expect(checkChord(cmd("workspace.newNote"), "Shift+KeyQ")).toBe("needsModifier");
    expect(checkChord(cmd("pdfAnnotation.up"), "Shift+KeyW")).toBe("shiftReserved");
    expect(checkChord(cmd("chat.stop"), "Escape")).toBeNull();
    expect(checkChord(cmd("shell.toggleFocus"), "KeyQ")).toBeNull();
  });
});

describe("findConflict", () => {
  const defaults = resolveKeymap();
  it("finds a clash in the same scope and between global and page scopes", () => {
    expect(findConflict(defaults, "workspace.closeTab", 0, "Alt+KeyN")).toEqual({ commandId: "workspace.newNote", slot: 0 });
    expect(findConflict(defaults, "workspace.closeTab", 0, "BracketLeft")).toEqual({ commandId: "shell.toggleSidePanel", slot: 0 });
    expect(findConflict(defaults, "calendar.today", 0, "Backslash")).toEqual({ commandId: "shell.toggleFocus", slot: 0 });
    expect(findConflict(defaults, "player.playPause", 1, "KeyJ")).toEqual({ commandId: "player.back", slot: 1 });
  });
  it("lets different tools, and pages that never meet, share a key", () => {
    expect(findConflict(defaults, "player.playPause", 1, "KeyC")).toBeNull(); // PDF annotations use C
    expect(findConflict(defaults, "workspace.newNote", 0, "KeyT")).toBeNull(); // calendar's T: other page
    expect(findConflict(defaults, "player.mute", 0, "BracketLeft")).toBeNull(); // a tool's key wins inside it
  });
  it("treats Shift + a step-move key as taken", () => {
    expect(findConflict(defaults, "pdfAnnotation.menu", 0, "Shift+ArrowUp")).toEqual({ commandId: "pdfAnnotation.up", slot: 0 });
  });
});

describe("resolveKeymap and setSlot", () => {
  it("drops a default that a custom key took, and ignores unknown commands", () => {
    const r = resolveKeymap({ "workspace.closeTab": [b("Alt+KeyN"), null], "gone.command": [b("KeyQ"), null] });
    expect(r.slots["workspace.newNote"][0]).toBeNull();
    expect(r.dropped.has("workspace.newNote:0")).toBe(true);
    expect(r.slots["workspace.closeTab"][0]).toMatchObject({ chord: "Alt+KeyN", custom: true });
    expect(r.slots["gone.command"]).toBeUndefined();
  });
  it("stores only commands that differ from their defaults", () => {
    const changed = setSlot({}, "player.playPause", 1, null);
    expect(changed).toEqual({ "player.playPause": [{ chord: "Space", label: "Space" }, null] });
    expect(setSlot(changed, "player.playPause", 1, b("KeyK", "K"))).toEqual({});
  });
});
