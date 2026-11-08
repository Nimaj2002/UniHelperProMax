import { Plus } from "@phosphor-icons/react";
import { useNavigate } from "react-router";
import type { PanelActionProps } from "@/app/shell/registry";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useShortcut } from "@/lib/keymap";
import { useOpenContextState } from "@/features/events/usePreselectedSemester";

/** "New class": a labelled button (calendar toolbar) or a small "+" beside the Courses heading. */
export function NewClassButton({ variant = "full" }: PanelActionProps) {
  const navigate = useNavigate();
  // 009: the open course's year and semester are preselected (FR-004)
  const state = useOpenContextState();
  const { aria } = useShortcut("calendar.newClass");
  if (variant === "icon")
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="size-7" aria-label="New class" data-tour="new-class" onClick={() => navigate("/classes/new", { state })}>
            <Plus size={14} weight="bold" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>New class</TooltipContent>
      </Tooltip>
    );
  return (
    <Button size="sm" data-tour="new-class" onClick={() => navigate("/classes/new", { state })} aria-keyshortcuts={aria}>
      <Plus size={16} weight="bold" aria-hidden />
      New class
    </Button>
  );
}
