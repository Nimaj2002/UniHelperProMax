import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { COMMANDS, useKeymap } from "@/lib/keymap";

// the calendar's quick reference: its own keys plus the global and task-board ones (019: the user's keys)
const SHOWN = new Set(["General", "Calendar", "Task board"]);

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const keymap = useKeymap();
  const rows = COMMANDS.filter((c) => SHOWN.has(c.group)).flatMap((c) => {
    const keys = keymap.slots[c.id].flatMap((b) => (b ? [b.label] : []));
    return keys.length ? [{ id: c.id, keys: keys.join("  or  "), label: c.label }] : [];
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Single-key shortcuts are ignored while you type in a field. Change them in Settings → Keyboard shortcuts.</DialogDescription>
        </DialogHeader>
        <dl className="grid max-h-[60vh] grid-cols-[auto_1fr] gap-x-6 gap-y-2 overflow-y-auto text-sm">
          {rows.map(({ id, keys, label }) => (
            <div key={id} className="contents">
              <dt><kbd className="rounded border border-divider bg-surface-sunken px-1.5 py-0.5 font-mono text-xs whitespace-pre">{keys}</kbd></dt>
              <dd className="text-muted-foreground">{label}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
