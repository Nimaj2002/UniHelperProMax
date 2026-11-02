import { CalendarBlank, Kanban, NotePencil, SidebarSimple } from "@phosphor-icons/react";
import { SideRail } from "@/app/shell/SideRail";
import { formatCount } from "@/features/tasks/model/counts";
import { useShortcut } from "@/lib/keymap";
import type { Panel } from "./homeWidths";
import type { ColumnSection } from "./tasksColumn";

export const SHOW_PANEL_ID: Record<Panel, string> = { calendar: "show-calendar", tasks: "show-tasks" };
export const PANEL_ID: Record<Panel, string> = { calendar: "calendar-panel", tasks: "tasks-panel" };
export const PANEL_NAME: Record<Panel, string> = { calendar: "Calendar", tasks: "Tasks" };
/** 019: the keymap command that shows or hides each panel. */
export const PANEL_COMMAND: Record<Panel, string> = { calendar: "home.toggleCalendar", tasks: "home.toggleTasks" };

interface Props {
  panel: Panel;
  onOpen: () => void;
  /** Tasks rail: open tasks (not in a done column); omitted while unknown. */
  openCount?: number;
  /** Tasks rail: open tasks past due. */
  overdueCount?: number;
  /** Tasks rail (018): an item per section, like the session panel's rail; opens on that section. */
  onOpenSection?: (section: ColumnSection) => void;
}

/** "Show tasks, 7 open, 2 overdue" (contracts/ui-home-tasks.md). */
export function railLabel(panel: Panel, openCount?: number, overdueCount?: number): string {
  const parts = [`Show ${panel}`];
  if (panel === "tasks" && openCount !== undefined) {
    parts.push(`${openCount} open`);
    if (overdueCount) parts.push(`${overdueCount} overdue`);
  }
  return parts.join(", ");
}

/**
 * A closed home panel (FR-071–FR-073): a 44 px card like the left card's rail; the whole strip is
 * the reopen button with the panel's icon, vertical name and, for Tasks, the open count and an
 * overdue "!" (text, never color alone). (018) The Tasks rail is the session panel's kind: a
 * reopen button and an item per section (Tasks with its counts, General notes).
 */
export function PanelRail({ panel, onOpen, openCount, overdueCount, onOpenSection }: Props) {
  const name = PANEL_NAME[panel];
  const hint = useShortcut(PANEL_COMMAND[panel]);
  const counts = (
    <>
      {openCount !== undefined && (
        <span aria-hidden className="text-xs tabular-nums text-muted-foreground" data-testid="rail-open-count">
          {formatCount(openCount)}
        </span>
      )}
      {!!overdueCount && (
        <span className="text-sm font-bold text-warning" data-testid="rail-overdue">
          <span aria-hidden>!</span>
          <span className="sr-only">{overdueCount} overdue</span>
        </span>
      )}
    </>
  );
  if (panel === "tasks" && onOpenSection)
    return (
      <SideRail
        side="right"
        data-rail={panel}
        label="Tasks panel rail"
        reopen={{
          id: SHOW_PANEL_ID.tasks,
          label: railLabel(panel, openCount, overdueCount),
          tooltip: "Show tasks",
          shortcut: hint.aria,
          shortcutHint: hint.label,
          icon: SidebarSimple,
          mirrored: true,
          controls: PANEL_ID.tasks,
          onActivate: onOpen,
        }}
        items={[
          { id: "tasks", icon: Kanban, name: "Tasks", onActivate: () => onOpenSection("tasks"), content: counts },
          { id: "notes", icon: NotePencil, name: "General notes", onActivate: () => onOpenSection("notes") },
        ]}
      />
    );
  return (
    <SideRail
      side={panel === "calendar" ? "left" : "right"}
      data-rail={panel}
      reopen={{
        id: SHOW_PANEL_ID[panel],
        label: railLabel(panel, openCount, overdueCount),
        tooltip: `Show ${panel}`,
        shortcut: hint.aria,
        shortcutHint: hint.label,
        icon: panel === "calendar" ? CalendarBlank : Kanban,
        controls: PANEL_ID[panel],
        onActivate: onOpen,
        content: (
          <>
            <span aria-hidden className="text-sm font-medium [writing-mode:vertical-rl]">{name}</span>
            {panel === "tasks" && counts}
          </>
        ),
      }}
    />
  );
}
