import { CalendarBlank, Kanban } from "@phosphor-icons/react";
import { Card } from "@/app/shell/Card";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
  const Icon = panel === "calendar" ? CalendarBlank : Kanban;
  const name = PANEL_NAME[panel];
  return (
    <Card className="h-full" body="fill" data-rail={panel}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            id={SHOW_PANEL_ID[panel]}
            variant="ghost"
            className="h-full w-full flex-col items-center justify-start gap-2 rounded-[13px] px-0 py-3"
            onClick={onOpen}
            aria-controls={PANEL_ID[panel]}
            aria-expanded={false}
            aria-label={railLabel(panel, openCount, overdueCount)}
            aria-keyshortcuts={PANEL_SHORTCUT[panel]}
          >
            <Icon size={18} aria-hidden />
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
          </Button>
        </TooltipTrigger>
        <TooltipContent side={panel === "calendar" ? "right" : "left"}>
          Show {panel} <kbd className="ml-1 font-mono">{PANEL_SHORTCUT[panel]}</kbd>
        </TooltipContent>
      </Tooltip>
    </Card>
  );
}
