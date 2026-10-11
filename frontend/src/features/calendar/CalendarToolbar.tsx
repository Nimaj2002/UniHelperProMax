import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MainBarControls } from "@/app/shell/MainBarControls";
import { NewClassButton } from "@/features/classes/NewClassButton";
import { NewEventButton } from "@/features/events/NewEventButton";
import { formatRangeLabel, formatShortRangeLabel, todayISO } from "@/lib/dates";
import { PERIOD_NOUN, shiftPeriod } from "./navigation";
import { calendarPath, type CalendarView } from "./state";

const VIEW_LABELS: Record<CalendarView, [string, string]> = { day: ["D", "Day"], week: ["W", "Week"], month: ["M", "Month"] };

export function CalendarToolbar({ view, date, tz }: { view: CalendarView; date: string; tz: string }) {
  const navigate = useNavigate();
  const go = (d: string, v: CalendarView = view) => navigate(calendarPath(v, d));
  const noun = PERIOD_NOUN[view];

  return (
    <div className="flex h-12 min-w-0 shrink-0 items-center gap-1 border-b border-divider px-2 sm:gap-2">
      <MainBarControls position="start" />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline" size="sm" className="px-2 sm:px-3" onClick={() => go(todayISO(tz))} aria-keyshortcuts="t">Today</Button>
        </TooltipTrigger>
        <TooltipContent>Today <kbd className="ml-1 font-mono">T</kbd></TooltipContent>
      </Tooltip>
      <Button variant="ghost" size="icon" className="size-8 sm:size-9" aria-label={`Previous ${noun}`} onClick={() => go(shiftPeriod(view, date, -1))}>
        <CaretLeft size={18} />
      </Button>
      <Button variant="ghost" size="icon" className="size-8 sm:size-9" aria-label={`Next ${noun}`} onClick={() => go(shiftPeriod(view, date, 1))}>
        <CaretRight size={18} />
      </Button>
      <h1 aria-live="polite" aria-label={formatRangeLabel(view, date)} className="min-w-0 truncate text-sm font-semibold tracking-tight sm:text-lg">
        <span aria-hidden className="sm:hidden">{formatShortRangeLabel(view, date)}</span>
        <span aria-hidden className="hidden sm:inline">{formatRangeLabel(view, date)}</span>
      </h1>
      <div className="ml-auto flex shrink-0 gap-1 sm:gap-2">
        <NewClassButton />
        <NewEventButton />
      </div>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={view}
        onValueChange={(v) => v && go(date, v as CalendarView)}
        aria-label="Calendar view"
        className="shrink-0"
      >
        {(Object.keys(VIEW_LABELS) as CalendarView[]).map((v) => (
          <ToggleGroupItem key={v} value={v} aria-label={`${VIEW_LABELS[v][1]} view`} aria-keyshortcuts={v[0]} className="px-2.5">
            <span className="sm:hidden">{VIEW_LABELS[v][0]}</span>
            <span className="hidden sm:inline">{VIEW_LABELS[v][1]}</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <MainBarControls position="end" />
    </div>
  );
}
