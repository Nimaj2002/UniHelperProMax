import { CalendarBlank, Kanban } from "@phosphor-icons/react";
import { SideRail } from "@/app/shell/SideRail";
import { formatCount } from "@/features/tasks/model/counts";
import type { Panel } from "./homeWidths";

export const SHOW_PANEL_ID: Record<Panel, string> = { calendar: "show-calendar", tasks: "show-tasks" };
export const PANEL_ID: Record<Panel, string> = { calendar: "calendar-panel", tasks: "tasks-panel" };
export const PANEL_NAME: Record<Panel, string> = { calendar: "Calendar", tasks: "Tasks" };
export const PANEL_SHORTCUT: Record<Panel, string> = { calendar: "Shift+C", tasks: "Shift+T" };

interface Props {
  panel: Panel;
  onOpen: () => void;
  /** Tasks rail: open tasks (not in a done column); omitted while unknown. */
  openCount?: number;
  /** Tasks rail: open tasks past due. */
  overdueCount?: number;
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
 * overdue "!" (text, never color alone).
 */
export function PanelRail({ panel, onOpen, openCount, overdueCount }: Props) {
  const name = PANEL_NAME[panel];
  return (
    <SideRail
      side={panel === "calendar" ? "left" : "right"}
      data-rail={panel}
      reopen={{
        id: SHOW_PANEL_ID[panel],
        label: railLabel(panel, openCount, overdueCount),
        tooltip: `Show ${panel}`,
        shortcut: PANEL_SHORTCUT[panel],
        shortcutHint: PANEL_SHORTCUT[panel],
        icon: panel === "calendar" ? CalendarBlank : Kanban,
        controls: PANEL_ID[panel],
        onActivate: onOpen,
        content: (
          <>
            <span aria-hidden className="text-sm font-medium [writing-mode:vertical-rl]">{name}</span>
            {panel === "tasks" && openCount !== undefined && (
              <span aria-hidden className="text-xs tabular-nums text-muted-foreground" data-testid="rail-open-count">
                {formatCount(openCount)}
              </span>
            )}
            {panel === "tasks" && !!overdueCount && (
              <span className="text-sm font-bold text-warning" data-testid="rail-overdue">
                <span aria-hidden>!</span>
                <span className="sr-only">{overdueCount} overdue</span>
              </span>
            )}
          </>
        ),
      }}
    />
  );
}
