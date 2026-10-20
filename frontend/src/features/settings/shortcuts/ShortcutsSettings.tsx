import { CALENDAR_SHORTCUTS } from "@/features/calendar/useCalendarKeyboard";
import { WORKSPACE_SHORTCUTS, type WorkspaceActions } from "@/features/sessions/useWorkspaceKeyboard";

const WORKSPACE_LABELS: Record<keyof WorkspaceActions, string> = {
  newNote: "New note",
  importNote: "Import a note",
  closeTab: "Close the current tab",
  nextTab: "Next tab",
  prevTab: "Previous tab",
  toggleLeft: "Show or hide the left panel",
  toggleRight: "Show or hide the right panel",
  toggleSplit: "Toggle split view",
  focusChat: "Focus the AI chat message box",
  newChat: "Start a new chat",
};

type Group = { title: string; note?: string; items: [string, string][] };

// Read-only for now: lists the bindings defined across the app.
const GROUPS: Group[] = [
  {
    title: "General",
    note: "Single-key shortcuts are ignored while you type in a field.",
    items: [
      ["[", "Show or hide the side panel"],
      ["\\", "Toggle focus mode"],
      ["/", "Search courses"],
      ["Shift + C", "Show or hide the calendar panel (home page)"],
      ["Shift + T", "Show or hide the tasks panel (home page)"],
    ],
  },
  {
    title: "Notes workspace",
    note: "These work inside the editor too.",
    items: WORKSPACE_SHORTCUTS.map((s) => [s.keys.replaceAll("+", " + "), WORKSPACE_LABELS[s.action]]),
  },
  {
    title: "AI chat",
    items: [
      ["Enter", "Send the message"],
      ["Shift + Enter", "New line"],
      ["Esc", "Stop generating"],
    ],
  },
  {
    title: "Calendar",
    // the calendar's own list also repeats the global and task-board keys, shown in their own groups here
    items: CALENDAR_SHORTCUTS.filter(([keys, label]) => !["/", "[", "Shift + C", "Shift + T"].includes(keys) && !/task|card/i.test(label)),
  },
  {
    title: "Task board",
    items: [
      ["Enter / Space", "Pick up the focused card or column"],
      ["↑ / ↓ / ← / →", "Move a picked-up card"],
      ["Enter  or  Esc", "Drop the card, or cancel the move"],
      ["Alt + ↑ / ↓", "Reorder a checklist item"],
    ],
  },
  {
    title: "Recording player",
    items: [
      ["Space  or  K", "Play or pause"],
      ["← / →  or  J / L", "Skip back / forward 5 seconds"],
      ["↑ / ↓", "Volume up / down"],
      ["M", "Mute or unmute"],
    ],
  },
  {
    title: "PDF annotations",
    items: [
      ["Arrow keys", "Move the focused annotation (hold Shift for bigger steps)"],
      ["Enter", "Edit a text box or comment"],
      ["Ctrl + Enter  or  Esc", "Finish editing"],
      ["C", "Open the annotation menu"],
      ["Delete / Backspace", "Delete the annotation"],
    ],
  },
  {
    title: "Diagram viewer",
    items: [
      ["+ / -", "Zoom in / out"],
      ["0", "Reset the view"],
      ["Arrow keys", "Pan"],
    ],
  },
];

/** Settings → Keyboard shortcuts: a reference list of every binding. */
export function ShortcutsSettings() {
  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <h2 className="text-lg font-semibold">Keyboard shortcuts</h2>
        <p className="text-sm text-muted-foreground">On macOS, Alt is the Option key. Press ? on the calendar for a quick reference.</p>
      </div>
      {GROUPS.map((g) => (
        <section key={g.title} aria-labelledby={`shortcuts-${g.title}`} className="grid gap-2">
          <div>
            <h3 id={`shortcuts-${g.title}`} className="text-sm font-medium">{g.title}</h3>
            {g.note && <p className="text-xs text-muted-foreground">{g.note}</p>}
          </div>
          <dl className="grid grid-cols-[minmax(9rem,auto)_1fr] gap-x-6 gap-y-2 rounded-lg border border-divider p-3 text-sm">
            {g.items.map(([keys, label]) => (
              <div key={keys + label} className="contents">
                <dt><kbd className="rounded border border-divider bg-surface-sunken px-1.5 py-0.5 font-mono text-xs whitespace-pre">{keys}</kbd></dt>
                <dd className="text-muted-foreground">{label}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
