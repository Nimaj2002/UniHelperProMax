/** Settings → Keyboard shortcuts (019): every shortcut, with a main and an alternate key the
 * user can record, reset or remove. Saved to the account's preferences. */
import { DotsThree } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { usePreferences, useUpdatePreferences, type Preferences } from "@/features/sessions/api";
import {
  COMMAND_BY_ID, COMMANDS, defaultSlot, findConflict, GROUPS, resolveKeymap, setSlot,
  type Binding, type Command, type Overrides, type Slot,
} from "@/lib/keymap";
import { ConflictDialog } from "./ConflictDialog";
import { ShortcutSlot } from "./ShortcutSlot";

const SLOT_NAME = ["Key", "Alternate key"] as const;
const GROUP_NOTE: Partial<Record<string, string>> = {
  General: "Single-key shortcuts are ignored while you type in a field.",
  "Notes workspace": "These work inside the editor too, so they need Alt, Ctrl or Cmd.",
};

interface Pending {
  command: Command;
  slot: Slot;
  binding: Binding;
  other: { commandId: string; slot: Slot };
}

export function ShortcutsSettings() {
  const prefs = usePreferences();
  const update = useUpdatePreferences();
  const stored = prefs.data?.shortcuts as Overrides | undefined;
  const overrides = useMemo(() => stored ?? {}, [stored]);
  // straight from the preferences (with the pending change), not from KeymapSync
  const keymap = useMemo(() => resolveKeymap(overrides), [overrides]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [status, setStatus] = useState("");
  const [failed, setFailed] = useState<{ next: Overrides; commandId: string } | null>(null);

  const save = (next: Overrides, commandId: string, done: string) => {
    setFailed(null);
    update.mutate(
      { shortcuts: next as Preferences["shortcuts"] },
      {
        onSuccess: () => setStatus(done),
        onError: () => {
          setFailed({ next, commandId });
          setStatus("Not saved. Your previous shortcut still works.");
        },
      },
    );
  };

  /** Set a slot, or ask first when another command uses the key (FR-006). */
  const assign = (command: Command, slot: Slot, binding: Binding | null, done: string) => {
    const other = binding && findConflict(keymap, command.id, slot, binding.chord);
    if (binding && other) return setPending({ command, slot, binding, other });
    save(setSlot(overrides, command.id, slot, binding), command.id, done);
  };

  const reassign = () => {
    if (!pending) return;
    const { command, slot, binding, other } = pending;
    const freed = setSlot(overrides, other.commandId, other.slot, null);
    save(setSlot(freed, command.id, slot, binding), command.id, `Saved: ${binding.label} for ${command.label}.`);
    setPending(null);
  };

  const ownerOf = (command: Command, slot: Slot) => {
    const chord = command.defaults[slot];
    const other = chord && findConflict(keymap, command.id, slot, chord);
    return other ? COMMAND_BY_ID.get(other.commandId)?.label : undefined;
  };

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h2 className="text-lg font-semibold">Keyboard shortcuts</h2>
          <p className="text-sm text-muted-foreground">
            Select a key to change it, then press the new shortcut. On macOS, Alt is the Option key. Press ? on the calendar for a quick reference.
          </p>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" disabled={Object.keys(overrides).length === 0}>Reset all</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reset all shortcuts?</AlertDialogTitle>
              <AlertDialogDescription>Every shortcut goes back to its default. Your changes are lost.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => save({}, "", "All shortcuts are back to their defaults.")}>Reset all</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <p role="status" aria-live="polite" className="sr-only">{status}</p>

      {GROUPS.map((group) => (
        <section key={group} aria-labelledby={`shortcuts-${group}`} className="grid gap-2">
          <div>
            <h3 id={`shortcuts-${group}`} className="text-sm font-medium">{group}</h3>
            {GROUP_NOTE[group] && <p className="text-xs text-muted-foreground">{GROUP_NOTE[group]}</p>}
          </div>
          <ul className="grid divide-y divide-divider rounded-lg border border-divider text-sm">
            {COMMANDS.filter((c) => c.group === group).map((command) => {
              const slots = keymap.slots[command.id];
              const changed = !!overrides[command.id];
              return (
                <li key={command.id} className="grid gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-start sm:gap-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-2 pt-1">
                    <span>{command.label}</span>
                    {changed && <Badge variant="secondary">Changed</Badge>}
                    {failed?.commandId === command.id && (
                      <span className="text-xs text-destructive">
                        Not saved.{" "}
                        <button type="button" className="underline underline-offset-2" onClick={() => save(failed.next, command.id, "Saved.")}>Try again</button>
                      </span>
                    )}
                  </div>
                  {([0, 1] as const).map((slot) => {
                    const owner = keymap.dropped.has(`${command.id}:${slot}`) ? ownerOf(command, slot) : undefined;
                    return (
                      <ShortcutSlot
                        key={slot}
                        command={command}
                        slotName={SLOT_NAME[slot]}
                        label={slots[slot]?.label ?? null}
                        emptyText={owner ? `Not set — its default is used by ${owner}` : "Not set"}
                        onRecorded={(b) => assign(command, slot, b, `Saved: ${b.label} for ${command.label}.`)}
                      />
                    );
                  })}
                  <RowMenu
                    command={command}
                    slots={slots}
                    onReset={(slot) => assign(command, slot, defaultSlot(command, slot), `${command.label} is back to its default.`)}
                    onRemove={(slot) => assign(command, slot, null, `Removed the ${SLOT_NAME[slot].toLowerCase()} of ${command.label}.`)}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <ConflictDialog
        conflict={pending && {
          label: pending.binding.label,
          owner: COMMAND_BY_ID.get(pending.other.commandId)?.label ?? "",
          command: pending.command.label,
        }}
        onReassign={reassign}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}

function RowMenu({ command, slots, onReset, onRemove }: {
  command: Command;
  slots: readonly [unknown, unknown];
  onReset: (slot: Slot) => void;
  onRemove: (slot: Slot) => void;
}) {
  // FR-007a: the only keyboard way to do something keeps at least one key
  const lastKey = (slot: Slot) => !!command.keyboardOnly && slots[slot === 0 ? 1 : 0] === null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-7 justify-self-start" aria-label={`More for ${command.label}`}>
          <DotsThree size={18} weight="bold" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {([0, 1] as const).map((slot) => (
          <DropdownMenuItem key={`reset-${slot}`} onSelect={() => onReset(slot)}>
            Reset {SLOT_NAME[slot].toLowerCase()}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        {([0, 1] as const).map((slot) => (
          <DropdownMenuItem
            key={`remove-${slot}`}
            disabled={slots[slot] === null || lastKey(slot)}
            onSelect={() => onRemove(slot)}
            title={lastKey(slot) ? "This is the only keyboard way to do this, so it keeps one key." : undefined}
          >
            Remove {SLOT_NAME[slot].toLowerCase()}
            {lastKey(slot) && <span className="sr-only"> (unavailable: this is the only keyboard way to do this)</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
