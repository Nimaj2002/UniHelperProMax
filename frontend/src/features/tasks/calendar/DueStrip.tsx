import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatDay } from "@/lib/dates";
import { TaskMarker } from "./TaskMarker";
import type { CalendarTask } from "./useCalendarTasks";

const VISIBLE = 2;

/** "+N more" with a popover listing every task of the day (as the month view's "+N"). */
export function MoreTasks({ date, entries, hidden }: { date: string; entries: CalendarTask[]; hidden: number }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="h-5 rounded px-1 text-left text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={`Show ${hidden} more tasks on ${formatDay(date)}`}
        >
          +{hidden} more
        </button>
      </PopoverTrigger>
      <PopoverContent role="dialog" aria-label={`Tasks on ${formatDay(date)}`} className="w-64 p-2">
        <p className="mb-2 px-1 text-sm font-medium">{formatDay(date)}</p>
        <div className="grid max-h-72 gap-1 overflow-y-auto">
          {entries.map((e) => (
            <TaskMarker key={e.task.id} entry={e} />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Date-only tasks under the week/day headers (FR-047, research R16): one cell per day with at
 * most two markers, then "+N more". Uses the header row's grid columns.
 */
export function DueStrip({ days, tasks, columns }: { days: string[]; tasks: Map<string, CalendarTask[]>; columns: string }) {
  return (
    <div
      data-testid="due-strip"
      className="grid border-b border-divider pr-[var(--scrollbar,0px)]"
      style={{ gridTemplateColumns: columns }}
    >
      <div className="self-center pr-2 text-right text-[11px] text-muted-foreground">Due</div>
      {days.map((d) => {
        const list = tasks.get(d) ?? [];
        const hidden = list.length > VISIBLE ? list.length - VISIBLE : 0;
        return (
          <div key={d} role="group" aria-label={`Tasks due ${formatDay(d)}`} data-due-day={d} className="grid min-w-0 content-start gap-0.5 p-0.5">
            {list.slice(0, hidden ? VISIBLE : list.length).map((e) => (
              <TaskMarker key={e.task.id} entry={e} />
            ))}
            {hidden > 0 && <MoreTasks date={d} entries={list} hidden={hidden} />}
          </div>
        );
      })}
    </div>
  );
}
