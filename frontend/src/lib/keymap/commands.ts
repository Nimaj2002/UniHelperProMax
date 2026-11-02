/** 019: every command on Settings → Keyboard shortcuts, the only place defaults are written
 * (research R4). Handlers, hints, the calendar's help dialog and the conflict test read it. */

/**
 * Where a command fires. `global` fires on every page, `workspace` on a session's page and
 * `calendar` on the calendar (and the home page's calendar panel); the rest fire only while
 * that tool has focus, and a tool's own keys win over the others there (research R5).
 */
export type Scope =
  | "global"
  | "workspace"
  | "calendar"
  | "calendarGrid"
  | "taskBoard"
  | "checklist"
  | "player"
  | "pdfAnnotation"
  | "pdfAnnotationEditor"
  | "diagramViewer"
  | "chatBox";

export type Group =
  | "General"
  | "Notes workspace"
  | "AI chat"
  | "Calendar"
  | "Task board"
  | "Recording player"
  | "PDF annotations"
  | "Diagram viewer";

export interface Command {
  id: string;
  label: string;
  group: Group;
  scope: Scope;
  /** [main, alternate] */
  defaults: readonly [string | null, string | null];
  /** Also works in text fields and the editor, so it needs Alt, Ctrl or Cmd (FR-008). */
  worksWhileTyping?: boolean;
  /** Shift + its key means a bigger step, so its own key can't include Shift (research R6). */
  noShiftVariant?: boolean;
  /** The only keyboard way to do this: its last key can't be removed (FR-007a). */
  keyboardOnly?: boolean;
}

const c = (
  id: string,
  group: Group,
  scope: Scope,
  label: string,
  main: string | null,
  alt: string | null = null,
  flags: Pick<Command, "worksWhileTyping" | "noShiftVariant" | "keyboardOnly"> = {},
): Command => ({ id, label, group, scope, defaults: [main, alt], ...flags });

const W = { worksWhileTyping: true } as const;
const K = { keyboardOnly: true } as const;

export const COMMANDS: readonly Command[] = [
  c("shell.toggleSidePanel", "General", "global", "Show or hide the side panel", "BracketLeft"),
  c("shell.toggleFocus", "General", "global", "Toggle focus mode", "Backslash"),
  c("shell.searchCourses", "General", "global", "Search courses", "Slash"),
  c("home.toggleCalendar", "General", "global", "Show or hide the calendar panel (home page)", "Shift+KeyC"),
  c("home.toggleTasks", "General", "global", "Show or hide the tasks panel (home page)", "Shift+KeyT"),
  c("time.toggleTimer", "General", "global", "Start or stop the timer", "Alt+Shift+KeyS", null, W), // 020

  c("workspace.newNote", "Notes workspace", "workspace", "New note", "Alt+KeyN", null, W),
  c("workspace.importNote", "Notes workspace", "workspace", "Import a note", "Alt+Shift+KeyN", null, W),
  c("workspace.closeTab", "Notes workspace", "workspace", "Close the current tab", "Alt+KeyW", null, W),
  c("workspace.nextTab", "Notes workspace", "workspace", "Next tab", "Alt+PageDown", null, W),
  c("workspace.prevTab", "Notes workspace", "workspace", "Previous tab", "Alt+PageUp", null, W),
  c("workspace.toggleLeft", "Notes workspace", "workspace", "Show or hide the left panel", "Alt+BracketLeft", null, W),
  c("workspace.toggleRight", "Notes workspace", "workspace", "Show or hide the right panel", "Alt+BracketRight", null, W),
  c("workspace.toggleSplit", "Notes workspace", "workspace", "Toggle split view", "Alt+Backslash", null, W),
  c("workspace.focusChat", "Notes workspace", "workspace", "Focus the AI chat message box", "Alt+KeyK", null, W),
  c("workspace.newChat", "Notes workspace", "workspace", "Start a new chat", "Alt+Shift+KeyK", null, W),

  c("chat.send", "AI chat", "chatBox", "Send the message", "Enter"),
  c("chat.newLine", "AI chat", "chatBox", "New line", "Shift+Enter", null, K),
  c("chat.stop", "AI chat", "chatBox", "Stop generating", "Escape"),

  c("calendar.today", "Calendar", "calendar", "Go to today", "KeyT"),
  c("calendar.dayView", "Calendar", "calendar", "Day view", "KeyD"),
  c("calendar.weekView", "Calendar", "calendar", "Week view", "KeyW"),
  c("calendar.monthView", "Calendar", "calendar", "Month view", "KeyM"),
  c("calendar.prevPeriod", "Calendar", "calendar", "Previous period", "ArrowLeft", "KeyK"),
  c("calendar.nextPeriod", "Calendar", "calendar", "Next period", "ArrowRight", "KeyJ"),
  c("calendar.newClass", "Calendar", "calendar", "New class", "KeyN"),
  c("calendar.newEvent", "Calendar", "calendar", "New event", "KeyE"),
  c("calendar.help", "Calendar", "calendar", "Show keyboard shortcuts", "Shift+Slash"),
  c("calendarGrid.up", "Calendar", "calendarGrid", "Move up a 15-minute slot (inside the calendar grid)", "ArrowUp", null, K),
  c("calendarGrid.down", "Calendar", "calendarGrid", "Move down a 15-minute slot (inside the calendar grid)", "ArrowDown", null, K),
  c("calendarGrid.left", "Calendar", "calendarGrid", "Move a day left (inside the calendar grid)", "ArrowLeft", null, K),
  c("calendarGrid.right", "Calendar", "calendarGrid", "Move a day right (inside the calendar grid)", "ArrowRight", null, K),
  c("calendarGrid.shrink", "Calendar", "calendarGrid", "Shorten the highlighted range", "Shift+ArrowUp", null, K),
  c("calendarGrid.extend", "Calendar", "calendarGrid", "Extend the highlighted range", "Shift+ArrowDown", null, K),
  c("calendarGrid.open", "Calendar", "calendarGrid", "New class or event for the highlighted range, or open the focused session", "Enter", "Space"),
  c("calendarGrid.cancel", "Calendar", "calendarGrid", "Clear the range or cancel a new entry", "Escape"),

  c("taskBoard.pickUpOrDrop", "Task board", "taskBoard", "Pick up or drop the focused card or column", "Enter", "Space", K),
  c("taskBoard.up", "Task board", "taskBoard", "Move a picked-up card up", "ArrowUp", null, K),
  c("taskBoard.down", "Task board", "taskBoard", "Move a picked-up card down", "ArrowDown", null, K),
  c("taskBoard.left", "Task board", "taskBoard", "Move a picked-up card or column left", "ArrowLeft", null, K),
  c("taskBoard.right", "Task board", "taskBoard", "Move a picked-up card or column right", "ArrowRight", null, K),
  c("taskBoard.cancel", "Task board", "taskBoard", "Cancel the move", "Escape"),
  c("checklist.moveUp", "Task board", "checklist", "Move a checklist item up", "Alt+ArrowUp", null, K),
  c("checklist.moveDown", "Task board", "checklist", "Move a checklist item down", "Alt+ArrowDown", null, K),

  c("player.playPause", "Recording player", "player", "Play or pause", "Space", "KeyK"),
  c("player.back", "Recording player", "player", "Skip back 5 seconds", "ArrowLeft", "KeyJ"),
  c("player.forward", "Recording player", "player", "Skip forward 5 seconds", "ArrowRight", "KeyL"),
  c("player.volumeUp", "Recording player", "player", "Volume up", "ArrowUp"),
  c("player.volumeDown", "Recording player", "player", "Volume down", "ArrowDown"),
  c("player.mute", "Recording player", "player", "Mute or unmute", "KeyM"),

  c("pdfAnnotation.up", "PDF annotations", "pdfAnnotation", "Move the focused annotation up (hold Shift for bigger steps)", "ArrowUp", null, { keyboardOnly: true, noShiftVariant: true }),
  c("pdfAnnotation.down", "PDF annotations", "pdfAnnotation", "Move the focused annotation down", "ArrowDown", null, { keyboardOnly: true, noShiftVariant: true }),
  c("pdfAnnotation.left", "PDF annotations", "pdfAnnotation", "Move the focused annotation left", "ArrowLeft", null, { keyboardOnly: true, noShiftVariant: true }),
  c("pdfAnnotation.right", "PDF annotations", "pdfAnnotation", "Move the focused annotation right", "ArrowRight", null, { keyboardOnly: true, noShiftVariant: true }),
  c("pdfAnnotation.edit", "PDF annotations", "pdfAnnotation", "Edit a text box or comment", "Enter"),
  c("pdfAnnotation.menu", "PDF annotations", "pdfAnnotation", "Open the annotation menu", "KeyC"),
  c("pdfAnnotation.delete", "PDF annotations", "pdfAnnotation", "Delete the annotation", "Delete", "Backspace"),
  c("pdfAnnotationEditor.finish", "PDF annotations", "pdfAnnotationEditor", "Finish editing", "Ctrl+Enter", "Escape", K),

  c("diagram.zoomIn", "Diagram viewer", "diagramViewer", "Zoom in", "Shift+Equal", "Equal"),
  c("diagram.zoomOut", "Diagram viewer", "diagramViewer", "Zoom out", "Minus", "NumpadSubtract"),
  c("diagram.reset", "Diagram viewer", "diagramViewer", "Reset the view", "Digit0", "Numpad0"),
  c("diagram.panLeft", "Diagram viewer", "diagramViewer", "Pan left", "ArrowLeft", null, K),
  c("diagram.panRight", "Diagram viewer", "diagramViewer", "Pan right", "ArrowRight", null, K),
  c("diagram.panUp", "Diagram viewer", "diagramViewer", "Pan up", "ArrowUp", null, K),
  c("diagram.panDown", "Diagram viewer", "diagramViewer", "Pan down", "ArrowDown", null, K),
];

export const COMMAND_BY_ID: ReadonlyMap<string, Command> = new Map(COMMANDS.map((x) => [x.id, x]));

export const GROUPS: readonly Group[] = [
  "General",
  "Notes workspace",
  "AI chat",
  "Calendar",
  "Task board",
  "Recording player",
  "PDF annotations",
  "Diagram viewer",
];
