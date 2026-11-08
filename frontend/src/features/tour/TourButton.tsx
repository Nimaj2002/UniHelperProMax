/** 023 FR-020: the Yuii button in the rail / side-panel footer: replay from the start or a chapter. */
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { PanelActionProps } from "@/app/shell/registry";
import chicks from "./chicks.webp";
import { CHAPTERS } from "./steps";
import { startTour } from "./store";

export function TourButton({ variant = "full" }: PanelActionProps) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8" aria-label="Tour with Yuii" data-tour="tour-button">
              <img src={chicks} alt="" className="size-6 rounded-full" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side={variant === "icon" ? "right" : "top"}>Tour with Yuii</TooltipContent>
      </Tooltip>
      <DropdownMenuContent side={variant === "icon" ? "right" : "top"} align={variant === "icon" ? "end" : "start"} className="min-w-52">
        <DropdownMenuItem onSelect={() => startTour()}>Start from the beginning</DropdownMenuItem>
        <DropdownMenuSeparator />
        {CHAPTERS.map((c) => (
          <DropdownMenuItem key={c.id} onSelect={() => startTour(c.id)}>
            {c.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
