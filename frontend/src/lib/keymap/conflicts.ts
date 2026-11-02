/** 019 FR-006 / research R5: which commands can't share a key, and the user's keymap. */
import { chordLabel, withoutShift, type Binding } from "./chord";
import { COMMAND_BY_ID, COMMANDS, type Command, type Scope } from "./commands";

export type Slot = 0 | 1;
/** The stored overrides: {commandId: [main, alternate]}, null = removed. */
export type Overrides = Record<string, readonly [Binding | null, Binding | null]>;

export interface ResolvedSlot extends Binding {
  custom: boolean;
}
export interface Resolved {
  slots: Record<string, [ResolvedSlot | null, ResolvedSlot | null]>;
  /** "commandId:slot" of defaults dropped because a custom key took them. */
  dropped: Set<string>;
}

// a page-wide scope meets the global one; tools only meet themselves (their keys win there)
const PAGE: Partial<Record<Scope, true>> = { global: true, workspace: true, calendar: true };

function meet(a: Scope, b: Scope): boolean {
  if (a === b) return true;
  return !!PAGE[a] && !!PAGE[b] && (a === "global" || b === "global");
}

/** True when the two commands may not share these keys. */
export function clash(a: Command, chordA: string, b: Command, chordB: string): boolean {
  if (!meet(a.scope, b.scope)) return false;
  if (a.noShiftVariant || b.noShiftVariant) return withoutShift(chordA) === withoutShift(chordB);
  return chordA === chordB;
}

export function findConflict(resolved: Resolved, commandId: string, slot: Slot, chord: string): { commandId: string; slot: Slot } | null {
  const command = COMMAND_BY_ID.get(commandId);
  if (!command) return null;
  for (const other of COMMANDS) {
    for (const s of [0, 1] as const) {
      if (other.id === commandId && s === slot) continue;
      const b = resolved.slots[other.id]?.[s];
      if (b && clash(command, chord, other, b.chord)) return { commandId: other.id, slot: s };
    }
  }
  return null;
}

export function defaultSlot(command: Command, slot: Slot): ResolvedSlot | null {
  const chord = command.defaults[slot];
  return chord ? { chord, label: chordLabel(chord), custom: false } : null;
}

/** Defaults, then the user's overrides; a default that clashes with a custom key is dropped
 * (a new command whose default the user already took starts as "Not set"). */
export function resolveKeymap(overrides: Overrides = {}): Resolved {
  const slots: Resolved["slots"] = {};
  for (const command of COMMANDS) {
    const o = overrides[command.id];
    slots[command.id] = o
      ? [o[0] && { ...o[0], custom: true }, o[1] && { ...o[1], custom: true }]
      : [defaultSlot(command, 0), defaultSlot(command, 1)];
  }
  const dropped = new Set<string>();
  const customs = COMMANDS.flatMap((cmd) => slots[cmd.id].flatMap((b) => (b?.custom ? [{ cmd, chord: b.chord }] : [])));
  for (const command of COMMANDS) {
    if (overrides[command.id]) continue;
    for (const s of [0, 1] as const) {
      const b = slots[command.id][s];
      if (b && customs.some((x) => x.cmd.id !== command.id && clash(command, b.chord, x.cmd, x.chord))) {
        slots[command.id][s] = null;
        dropped.add(`${command.id}:${s}`);
      }
    }
  }
  return { slots, dropped };
}

const same = (a: Binding | null, chord: string | null) => (a?.chord ?? null) === chord;

/** The overrides after setting one slot; a command back on both defaults is left out. */
export function setSlot(overrides: Overrides, commandId: string, slot: Slot, value: Binding | null): Overrides {
  const command = COMMAND_BY_ID.get(commandId);
  if (!command) return overrides;
  const current = overrides[commandId] ?? [defaultSlot(command, 0), defaultSlot(command, 1)];
  const pair: [Binding | null, Binding | null] = [current[0], current[1]];
  pair[slot] = value && { chord: value.chord, label: value.label };
  const next = { ...overrides };
  if (same(pair[0], command.defaults[0]) && same(pair[1], command.defaults[1])) delete next[commandId];
  else next[commandId] = [pair[0] && { chord: pair[0].chord, label: pair[0].label }, pair[1] && { chord: pair[1].chord, label: pair[1].label }];
  return next;
}
