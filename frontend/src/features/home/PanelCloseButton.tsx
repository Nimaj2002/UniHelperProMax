import { X } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ShortcutKbd, useShortcut } from "@/lib/keymap";
import type { Panel } from "./homeWidths";
import { PANEL_COMMAND, PANEL_ID } from "./PanelRail";

export const LAST_OPEN_MESSAGE = "At least one panel stays open";

/**
 * A panel header's close button (FR-070, FR-077). While it is the last open panel the button is
 * `aria-disabled` (still focusable, so the reason shows on hover and focus) and described by the
 * reason; activating it then only announces the reason (the page decides).
 */
export function PanelCloseButton({ panel, disabled, onClose }: { panel: Panel; disabled: boolean; onClose: () => void }) {
  const reasonId = `close-${panel}-reason`;
  const { aria } = useShortcut(PANEL_COMMAND[panel]);
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            id={`close-${panel}`}
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            aria-label={`Close ${panel}`}
            aria-controls={PANEL_ID[panel]}
            aria-disabled={disabled || undefined}
            aria-describedby={disabled ? reasonId : undefined}
            aria-keyshortcuts={aria}
            onClick={onClose}
          >
            <X size={16} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {disabled ? LAST_OPEN_MESSAGE : <>Close {panel} <ShortcutKbd id={PANEL_COMMAND[panel]} /></>}
        </TooltipContent>
      </Tooltip>
      {disabled && (
        <span id={reasonId} className="sr-only">
          {LAST_OPEN_MESSAGE}
        </span>
      )}
    </>
  );
}
