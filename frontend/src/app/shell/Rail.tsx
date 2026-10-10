import { SidebarSimple } from "@phosphor-icons/react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AccountMenu } from "./AccountMenu";
import { Card } from "./Card";
import { AppMark } from "./LeftCard";
import { LEFT_CARD_ID, SHOW_LEFT_ID, useLayout } from "./layout";
import { usePanelActions } from "./registry";

/** The closed side panel on wide windows (008 FR-011): reopen, app mark, Account and Settings. */
export function Rail() {
  const { toggleLeft } = useLayout();
  const footer = usePanelActions("footer");
  return (
    <Card as="aside" id={LEFT_CARD_ID} label="Side panel" className="h-full" body="fill">
      <div className="flex h-full flex-col items-center gap-2 py-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              id={SHOW_LEFT_ID}
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={toggleLeft}
              aria-controls={LEFT_CARD_ID}
              aria-expanded={false}
              aria-label="Show side panel"
              aria-keyshortcuts="BracketLeft"
            >
              <SidebarSimple size={18} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            Show side panel <kbd className="ml-1 font-mono">[</kbd>
          </TooltipContent>
        </Tooltip>
        <Link to="/" aria-label="Go to home" className="rounded-md">
          <AppMark />
        </Link>
        <div className="mt-auto flex flex-col items-center gap-1">
          <AccountMenu variant="icon" />
          {footer.map(({ id, component: C }) => (
            <C key={id} variant="icon" />
          ))}
        </div>
      </div>
    </Card>
  );
}
