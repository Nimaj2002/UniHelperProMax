import { CalendarStar, CaretLeft, CaretRight, DotsThree, Plus } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MainBarControls } from "@/app/shell/MainBarControls";
import { NewClassButton } from "@/features/classes/NewClassButton";
import { NewEventButton } from "@/features/events/NewEventButton";
import { useOpenContextState } from "@/features/events/usePreselectedSemester";
import { useShowTasks } from "@/features/tasks/calendar/showTasks";
import { formatRangeLabel, formatShortRangeLabel, todayISO } from "@/lib/dates";
import { hintOf, ShortcutKbd, useKeymap } from "@/lib/keymap";
import { cn } from "@/lib/utils";
import { PERIOD_NOUN, shiftPeriod } from "./navigation";
import { useSemesterWeek } from "./semesterWeek";
import { calendarPath, type CalendarView } from "./state";

const VIEW_LABELS: Record<CalendarView, [string, string]> = { day: ["D", "Day"], week: ["W", "Week"], month: ["M", "Month"] };

interface Props {
  view: CalendarView;
  date: string;
  tz: string;
  /**
   * The home page's Calendar panel header (012 FR-063): one 40 px row sized by the panel (container
   * `calendar`), New class / New event in a "More" menu below 640 px, the page's own controls in
   * `leading` / `trailing` (left-card opener; focus mode and close buttons).
   */
  compact?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
}

export function CalendarToolbar({ view, date, tz, compact = false, leading, trailing }: Props) {
  const navigate = useNavigate();
  const keymap = useKeymap();
  const hint = (id: string) => hintOf(keymap, id);
  const go = (d: string, v: CalendarView = view) => navigate(calendarPath(v, d));
  const noun = PERIOD_NOUN[view];

  if (compact)
    return (
      <div data-panel-header className="flex h-10 min-w-0 shrink-0 items-center gap-1 px-1.5">
        {leading}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 px-2" onClick={() => go(todayISO(tz))} aria-keyshortcuts={hint("calendar.today").aria}>Today</Button>
          </TooltipTrigger>
          <TooltipContent>Today <ShortcutKbd id="calendar.today" /></TooltipContent>
        </Tooltip>
        <Button variant="ghost" size="icon" className="size-7 shrink-0" aria-label={`Previous ${noun}`} onClick={() => go(shiftPeriod(view, date, -1))}>
          <CaretLeft size={16} />
        </Button>
        <Button variant="ghost" size="icon" className="size-7 shrink-0" aria-label={`Next ${noun}`} onClick={() => go(shiftPeriod(view, date, 1))}>
          <CaretRight size={16} />
        </Button>
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <h1 aria-live="polite" aria-label={formatRangeLabel(view, date)} className="min-w-0 truncate text-sm font-semibold tracking-tight">
            <span aria-hidden className="@[36rem]/calendar:hidden">{formatShortRangeLabel(view, date)}</span>
            <span aria-hidden className="hidden @[36rem]/calendar:inline">{formatRangeLabel(view, date)}</span>
          </h1>
          {view !== "month" && <SemesterWeekBadge date={date} />}
        </div>
        <div className="hidden shrink-0 items-center gap-1 @[40rem]/calendar:flex [&_button]:h-7">
          <NewClassButton />
          <NewEventButton />
        </div>
        <MoreMenu className="@[40rem]/calendar:hidden" />
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={view}
          onValueChange={(v) => v && go(date, v as CalendarView)}
          aria-label="Calendar view"
          className="h-7 shrink-0"
        >
          {(Object.keys(VIEW_LABELS) as CalendarView[]).map((v) => (
            <ToggleGroupItem key={v} value={v} aria-label={`${VIEW_LABELS[v][1]} view`} aria-keyshortcuts={hint(`calendar.${v}View`).aria} className="h-7 px-2">
              <span className="@[48rem]/calendar:hidden">{VIEW_LABELS[v][0]}</span>
              <span className="hidden @[48rem]/calendar:inline">{VIEW_LABELS[v][1]}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <ShowTasksSwitch />
        {trailing}
      </div>
    );

  return (
    <div className="flex h-12 min-w-0 shrink-0 items-center gap-1 border-b border-divider px-2 sm:gap-2">
      <MainBarControls position="start" />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline" size="sm" className="px-2 sm:px-3" onClick={() => go(todayISO(tz))} aria-keyshortcuts={hint("calendar.today").aria}>Today</Button>
        </TooltipTrigger>
        <TooltipContent>Today <ShortcutKbd id="calendar.today" /></TooltipContent>
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
      {view !== "month" && <SemesterWeekBadge date={date} />}
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
          <ToggleGroupItem key={v} value={v} aria-label={`${VIEW_LABELS[v][1]} view`} aria-keyshortcuts={hint(`calendar.${v}View`).aria} className="px-2.5">
            <span className="sm:hidden">{VIEW_LABELS[v][0]}</span>
            <span className="hidden sm:inline">{VIEW_LABELS[v][1]}</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <MainBarControls position="end" />
    </div>
  );
}

/** "Week N" of the semester the shown day/week falls in; nothing outside a dated semester. */
function SemesterWeekBadge({ date }: { date: string }) {
  const sw = useSemesterWeek(date);
  if (!sw) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-label={`Week ${sw.week} of ${sw.semesterName}`}
          className="shrink-0 rounded-full border border-divider px-2 py-0.5 text-xs font-medium whitespace-nowrap text-text-muted tabular-nums"
        >
          Week {sw.week}
        </span>
      </TooltipTrigger>
      <TooltipContent>{sw.semesterName} · week {sw.week}</TooltipContent>
    </Tooltip>
  );
}

/** 012 FR-046: tasks on the calendar, off by default (remembered per browser). */
function ShowTasksSwitch() {
  const [on, setOn] = useShowTasks();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex shrink-0 items-center gap-1 px-1">
          <Switch id="show-tasks-on-calendar" size="sm" checked={on} onCheckedChange={setOn} aria-label="Show tasks" />
          <label htmlFor="show-tasks-on-calendar" aria-hidden className="hidden text-xs text-text-muted @[44rem]/calendar:inline">
            Tasks
          </label>
        </div>
      </TooltipTrigger>
      <TooltipContent>Show tasks on the calendar</TooltipContent>
    </Tooltip>
  );
}

/** New class / New event when the panel is too narrow for their buttons (FR-064). */
function MoreMenu({ className }: { className?: string }) {
  const navigate = useNavigate();
  const keymap = useKeymap();
  const state = useOpenContextState();
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className={cn("size-7 shrink-0", className)} aria-label="More calendar actions">
              <DotsThree size={18} weight="bold" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>More</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => navigate("/classes/new", { state })} aria-keyshortcuts={hintOf(keymap, "calendar.newClass").aria}>
          <Plus size={16} weight="bold" aria-hidden />
          New class
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate("/events/new", { state })} aria-keyshortcuts={hintOf(keymap, "calendar.newEvent").aria}>
          <CalendarStar size={16} weight="bold" aria-hidden />
          New event
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
