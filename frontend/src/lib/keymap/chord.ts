/** 019: a shortcut is a physical key (`KeyboardEvent.code`) plus modifiers in a fixed order,
 * e.g. "Alt+Shift+KeyK" (research R3). The label is what people see. */
import type { Command } from "./commands";

export interface Binding {
  chord: string;
  label: string;
}

const MODS = ["Ctrl", "Meta", "Alt", "Shift"] as const;
type Mod = (typeof MODS)[number];
const MODIFIER_CODES = /^(Shift|Control|Alt|Meta|OS)(Left|Right)?$/;

/** US-layout characters for codes that are not letters or digits. */
const CHAR: Record<string, string> = {
  BracketLeft: "[", BracketRight: "]", Backslash: "\\", Slash: "/", Equal: "=", Minus: "-", Comma: ",", Period: ".",
  Semicolon: ";", Quote: "'", Backquote: "`", NumpadAdd: "Num +", NumpadSubtract: "Num -",
  ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", Escape: "Esc",
};
/** Shift + these shows the shifted character instead of "Shift + …". */
const SHIFTED: Record<string, string> = { Slash: "?", Equal: "+" };
const NAMED_KEYS: Record<string, string> = { " ": "Space", ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", Escape: "Esc" };

export function parseChord(chord: string): { mods: Set<Mod>; code: string } {
  const parts = chord.split("+");
  const code = parts.pop() ?? "";
  return { mods: new Set(parts as Mod[]), code };
}

function build(mods: Iterable<string>, code: string): string {
  const set = new Set(mods);
  return [...MODS.filter((m) => set.has(m)), code].join("+");
}

function keyText(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return `Num ${code.slice(6)}`;
  return CHAR[code] ?? code;
}

function join(mods: string[], key: string): string {
  return [...mods, key].join(" + ");
}

/** The label of a chord on a US layout, e.g. "Alt + Shift + K", "?", "Ctrl + Enter". */
export function chordLabel(chord: string): string {
  const { mods, code } = parseChord(chord);
  const shown = MODS.filter((m) => mods.has(m)).map((m) => (m === "Meta" ? "Cmd" : m));
  if (mods.has("Shift") && SHIFTED[code]) return join(shown.filter((m) => m !== "Shift"), SHIFTED[code]);
  return join(shown, keyText(code));
}

/** `aria-keyshortcuts` form of one chord: "Control+Alt+K", "BracketLeft". */
export function chordAria(chord: string): string {
  const { mods, code } = parseChord(chord);
  const key = /^(Key[A-Z]|Digit\d)$/.test(code) ? code.slice(-1) : code === "Escape" ? "Escape" : code;
  return [...MODS.filter((m) => mods.has(m)).map((m) => (m === "Ctrl" ? "Control" : m)), key].join("+");
}

/** The pressed chord, or null while only modifiers are down. The label uses `e.key`, so other
 * layouts show the key that was pressed. */
export function chordFromEvent(e: KeyboardEvent): Binding | null {
  if (!e.code || MODIFIER_CODES.test(e.code)) return null;
  const mods: Mod[] = [];
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.metaKey) mods.push("Meta");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  const chord = build(mods, e.code);
  // Alt/Option changes `e.key` on macOS ("˚"), so fall back to the US label then
  const printable = e.key.length === 1 && !e.altKey;
  if (!printable) {
    const named = NAMED_KEYS[e.key];
    return { chord, label: named ? join(mods.map((m) => (m === "Meta" ? "Cmd" : m)), named) : chordLabel(chord) };
  }
  if (e.key === " ") return { chord, label: join(mods.map((m) => (m === "Meta" ? "Cmd" : m)), "Space") };
  const letter = /^\p{L}$/u.test(e.key);
  const shown = mods.filter((m) => letter || m !== "Shift").map((m) => (m === "Meta" ? "Cmd" : m));
  return { chord, label: join(shown, letter ? e.key.toUpperCase() : e.key).slice(0, 32) };
}

/** [unshifted, shifted] US characters of the symbol keys. */
const SYMBOL: Record<string, [string, string]> = {
  Slash: ["/", "?"], Backslash: ["\\", "|"], BracketLeft: ["[", "{"], BracketRight: ["]", "}"],
  Equal: ["=", "+"], Minus: ["-", "_"], Comma: [",", "<"], Period: [".", ">"], Semicolon: [";", ":"],
  Quote: ["'", '"'], Backquote: ["`", "~"],
};

export function eventMatches(e: KeyboardEvent, chord: string, ignoreShift = false): boolean {
  const { mods, code } = parseChord(chord);
  // a bare symbol key ("/", "?", "[") matches the character typed, as on other layouts it sits
  // elsewhere ("/" is Shift+7 on a German keyboard); letters and modifier combos match by position
  const symbol = SYMBOL[code];
  if (symbol && !mods.has("Ctrl") && !mods.has("Meta") && !mods.has("Alt") && e.key.length === 1) {
    return !e.ctrlKey && !e.metaKey && !e.altKey && e.key === symbol[mods.has("Shift") ? 1 : 0];
  }
  return (
    e.code === code &&
    e.ctrlKey === mods.has("Ctrl") &&
    e.metaKey === mods.has("Meta") &&
    e.altKey === mods.has("Alt") &&
    (ignoreShift || e.shiftKey === mods.has("Shift"))
  );
}

export function withoutShift(chord: string): string {
  const { mods, code } = parseChord(chord);
  mods.delete("Shift");
  return build(mods, code);
}

const both = (keys: string, extra = "") => keys.split("").flatMap((k) => [`Ctrl+${extra}Key${k}`, `Meta+${extra}Key${k}`]);
/** Keys the browser, the system or the desktop app menu keep (research R6), and the editor's
 * own Mod+E (live/raw), which is not on the shortcuts page. */
export const RESERVED = new Set([
  ...both("CVXZYAWQRNTLKEFP"),
  ...both("ZRN", "Shift+"),
  "Meta+KeyM", "Meta+KeyH", "F5", "Ctrl+F5", "Ctrl+Tab", "Ctrl+Shift+Tab", "F11", "F12",
  ..."FEVSBTH".split("").map((k) => `Alt+Key${k}`),
]);

export type Refusal = "tab" | "reserved" | "needsModifier" | "shiftReserved";

export function checkChord(command: Command, chord: string): Refusal | null {
  const { mods, code } = parseChord(chord);
  if (code === "Tab" && !mods.has("Ctrl")) return "tab";
  if (RESERVED.has(chord)) return "reserved";
  if (command.worksWhileTyping && !mods.has("Ctrl") && !mods.has("Meta") && !mods.has("Alt")) return "needsModifier";
  if (command.noShiftVariant && mods.has("Shift")) return "shiftReserved";
  return null;
}
