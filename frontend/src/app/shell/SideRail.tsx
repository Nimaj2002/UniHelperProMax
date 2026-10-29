import type { Icon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Card } from "./Card";

/** Activity on a rail item: a pulsing dot, a spinner or a filled dot (shape, never colour alone). */
export type RailIndicator = "recording" | "running" | "unseen";

export interface SideRailItem {
  id: string;
  icon: Icon;
  name: string;
  indicator?: RailIndicator;
  /** Appended to the name while the indicator shows, e.g. "recording in progress". */
  status?: string;
  onActivate: () => void;
  /** Shown under the item's button, e.g. the home Tasks item's open count (018). */
  content?: ReactNode;
}

export interface SideRailReopen {
  id?: string;
  label: string;
  /** The tooltip text when it differs from the label. */
  tooltip?: string;
  /** `aria-keyshortcuts` value, e.g. "Alt+BracketRight". */
  shortcut?: string;
  /** The shortcut as shown in the tooltip, e.g. "Alt+]". */
  shortcutHint?: string;
  icon: Icon;
  /** Flip the icon (the right edge's rail mirrors the left one). */
  mirrored?: boolean;
  controls?: string;
  onActivate: () => void;
  /** Without items the reopen button fills the rail; this content sits under its icon. */
  content?: ReactNode;
}

interface Props {
  side: "left" | "right";
  /** Names the rail as a navigation landmark (e.g. "Session panel rail"). */
  label?: string;
  reopen: SideRailReopen;
  items?: SideRailItem[];
  className?: string;
  "data-rail"?: string;
}

/** The accessible name of a rail item: its name and, while active, its status. */
export const railItemName = (item: Pick<SideRailItem, "name" | "indicator" | "status">) =>
  item.indicator && item.status ? `${item.name}, ${item.status}` : item.name;

export function RailIndicatorBadge({ kind }: { kind: RailIndicator }) {
  if (kind === "recording")
    return (
      <span aria-hidden data-indicator="recording" className="absolute top-1 right-1 size-2 animate-pulse rounded-full bg-danger ring-2 ring-surface-elevated motion-reduce:animate-none" />
    );
  if (kind === "running")
    return (
      <span
        aria-hidden
        data-indicator="running"
        className="absolute -right-0.5 -bottom-0.5 size-3 animate-spin rounded-full border-2 border-primary border-t-transparent bg-surface-elevated motion-reduce:animate-none"
      />
    );
  return <span aria-hidden data-indicator="unseen" className="absolute top-1 right-1 size-2 rounded-full bg-primary ring-2 ring-surface-elevated" />;
}

/**
 * A closed side card (008 FR-011, 012 FR-071, 014 FR-005): a 44 px card on the window's edge.
 * Without items the whole strip reopens the card (the home panels); with items the reopen button
 * sits on top and each item reopens the card on its own section, showing its activity.
 */
export function SideRail({ side, label, reopen, items = [], className, "data-rail": dataRail }: Props) {
  const tip = side === "left" ? "right" : "left";
  const ReopenIcon = reopen.icon;
  const filled = items.length === 0;
  const reopenButton = (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          id={reopen.id}
          variant="ghost"
          size={filled ? "default" : "icon"}
          className={filled ? "h-full w-full flex-col items-center justify-start gap-2 rounded-[13px] px-0 py-3" : "size-8"}
          onClick={reopen.onActivate}
          aria-controls={reopen.controls}
          aria-expanded={false}
          aria-label={reopen.label}
          aria-keyshortcuts={reopen.shortcut}
        >
          <ReopenIcon size={18} aria-hidden className={cn(reopen.mirrored && "-scale-x-100")} />
          {filled && reopen.content}
        </Button>
      </TooltipTrigger>
      <TooltipContent side={tip}>
        {reopen.tooltip ?? reopen.label} {reopen.shortcutHint && <kbd className="ml-1 font-mono">{reopen.shortcutHint}</kbd>}
      </TooltipContent>
    </Tooltip>
  );
  return (
    <Card as={label ? "nav" : "div"} label={label} className={cn("h-full", className)} body="fill" data-rail={dataRail}>
      {filled ? (
        reopenButton
      ) : (
        <div className="flex h-full flex-col items-center gap-2 py-2">
          {reopenButton}
          <span aria-hidden className="h-px w-6 shrink-0 bg-divider" />
          {items.map((item) => {
            const ItemIcon = item.icon;
            const name = railItemName(item);
            const button = (
              <Tooltip key={item.id}>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="relative size-8" onClick={item.onActivate} aria-label={name} data-rail-item={item.id}>
                    <ItemIcon size={18} aria-hidden />
                    {item.indicator && <RailIndicatorBadge kind={item.indicator} />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side={tip}>{name}</TooltipContent>
              </Tooltip>
            );
            if (!item.content) return button;
            return (
              <div key={item.id} className="flex flex-col items-center gap-0.5">
                {button}
                {item.content}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
