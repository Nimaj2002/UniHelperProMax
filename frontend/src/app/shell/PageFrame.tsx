import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { MainBarControls } from "./MainBarControls";

/**
 * A page inside the main card: a slim bar with the layout controls (side panel opener on narrow
 * windows, focus mode) and the page's content scrolling below it (008 US3).
 */
export function PageFrame({ children, className, bar }: { children: ReactNode; className?: string; bar?: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 px-2">
        <MainBarControls position="start" />
        <div className="flex min-w-0 flex-1 items-center gap-2">{bar}</div>
        <MainBarControls position="end" />
      </div>
      <div className={cn("min-h-0 flex-1 overflow-y-auto", className)}>{children}</div>
    </div>
  );
}
