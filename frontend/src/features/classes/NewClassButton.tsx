import { Plus } from "@phosphor-icons/react";
import { useNavigate } from "react-router";
import type { PanelActionProps } from "@/app/shell/registry";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** "New class": a labelled button (calendar toolbar) or a small "+" beside the Courses heading. */
export function NewClassButton({ variant = "full" }: PanelActionProps) {
  const navigate = useNavigate();
  if (variant === "icon")
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="size-7" aria-label="New class" onClick={() => navigate("/classes/new")}>
            <Plus size={14} weight="bold" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>New class</TooltipContent>
      </Tooltip>
    );
  return (
    <Button size="sm" onClick={() => navigate("/classes/new")} aria-keyshortcuts="n">
      <Plus size={16} weight="bold" aria-hidden />
      New class
    </Button>
  );
}
