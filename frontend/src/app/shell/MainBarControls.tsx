import { ArrowsIn, ArrowsOut, SidebarSimple } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { FOCUS_BUTTON_ID, LEFT_CARD_ID, SHOW_LEFT_ID, useLayout } from "./layout";

/** Opens the side panel over the main card on narrow windows, where there is no rail (008 FR-011). */
export function ShowSidePanelButton() {
  const { mode, focus, leftVisible, toggleLeft } = useLayout();
  if (mode !== "overlay" || focus) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          id={SHOW_LEFT_ID}
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          onClick={toggleLeft}
          aria-controls={LEFT_CARD_ID}
          aria-expanded={leftVisible}
          aria-label="Show side panel"
          aria-keyshortcuts="BracketLeft"
        >
          <SidebarSimple size={18} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        Show side panel <kbd className="ml-1 font-mono">[</kbd>
      </TooltipContent>
    </Tooltip>
  );
}

/** Hides both side cards, or brings them back as they were (008 FR-024). */
export function FocusModeButton() {
  const { focus, toggleFocus } = useLayout();
  const label = focus ? "Leave focus mode" : "Enter focus mode";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          id={FOCUS_BUTTON_ID}
          variant="ghost"
          size="icon"
          className={cn("size-8 shrink-0", focus && "bg-accent text-foreground")}
          onClick={toggleFocus}
          aria-pressed={focus}
          aria-label={label}
          aria-keyshortcuts="Backslash"
        >
          {focus ? <ArrowsIn size={18} /> : <ArrowsOut size={18} />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {label} <kbd className="ml-1 font-mono">\</kbd>
      </TooltipContent>
    </Tooltip>
  );
}

/** The layout controls at the start and end of every main card's top bar. */
export function MainBarControls({ position }: { position: "start" | "end" }) {
  return position === "start" ? <ShowSidePanelButton /> : <FocusModeButton />;
}
