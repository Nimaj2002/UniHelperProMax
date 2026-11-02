import { CalendarStar } from "@phosphor-icons/react";
import { useNavigate } from "react-router";
import type { PanelActionProps } from "@/app/shell/registry";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useShortcut } from "@/lib/keymap";
import { useOpenContextState } from "./usePreselectedSemester";

/** "New event" (009 FR-002): next to "New class" in the calendar toolbar, and a small icon beside
 * the Courses heading, so an open course's semester can be preselected (FR-004). */
export function NewEventButton({ variant = "full" }: PanelActionProps) {
  const navigate = useNavigate();
  const state = useOpenContextState();
  const open = () => navigate("/events/new", { state });
  const { aria } = useShortcut("calendar.newEvent");
  if (variant === "icon")
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="size-7" aria-label="New event" onClick={open}>
            <CalendarStar size={14} weight="bold" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>New event</TooltipContent>
      </Tooltip>
    );
  return (
    <Button size="sm" variant="outline" className="px-2 sm:px-3" onClick={open} aria-keyshortcuts={aria}>
      <CalendarStar size={16} weight="bold" aria-hidden />
      {/* the label hides on phones so the toolbar fits; the name stays */}
      <span className="sr-only sm:not-sr-only">New event</span>
    </Button>
  );
}
