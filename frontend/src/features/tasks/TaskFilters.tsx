/**
 * The Tasks header's "Filter" button and pop-up (FR-033): course (one course or personal tasks),
 * event-linked only, show Done, and Clear filters. The badge counts active filters, the search
 * included (`aria-label="Filter, N active"`).
 */
import { Funnel } from "@phosphor-icons/react";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { activeFilterCount, PERSONAL, type TaskFilters as Filters } from "./model/filters";
import { useCourseOptions } from "./useCourseOptions";

const ALL = "all";

interface Props {
  filters: Filters;
  onChange: (change: Partial<Filters> | null) => void;
}

export const filterLabel = (n: number) => (n > 0 ? `Filter, ${n} active` : "Filter");

export function TaskFiltersButton({ filters, onChange }: Props) {
  const uid = useId();
  const courses = useCourseOptions();
  const count = activeFilterCount(filters);
  const unknownCourse = filters.course && filters.course !== PERSONAL && !courses.some((c) => c.id === filters.course);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={count > 0 ? "secondary" : "ghost"}
          size="sm"
          aria-label={filterLabel(count)}
          className="relative h-7 shrink-0 gap-1 px-2"
        >
          <Funnel size={14} aria-hidden />
          <span className="hidden @[30rem]/tasks:inline">Filter</span>
          {count > 0 && (
            <span
              aria-hidden
              data-testid="filter-badge"
              className="grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold tabular-nums text-primary-foreground"
            >
              {count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-64 flex-col gap-3 p-3" aria-label="Task filters">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${uid}-course`} className="text-xs font-medium text-text-muted">
            Course
          </Label>
          <Select value={filters.course ?? ALL} onValueChange={(v) => onChange({ course: v === ALL ? null : v })}>
            <SelectTrigger id={`${uid}-course`} size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All tasks</SelectItem>
              <SelectItem value={PERSONAL}>Personal tasks</SelectItem>
              {unknownCourse && <SelectItem value={filters.course!}>Deleted course</SelectItem>}
              {courses.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name} <span className="text-text-muted">· {c.where}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor={`${uid}-event`} className="text-sm">
            Event-linked only
          </Label>
          <Switch id={`${uid}-event`} checked={filters.eventLinked} onCheckedChange={(v) => onChange({ eventLinked: v })} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor={`${uid}-done`} className="text-sm">
            Show done
          </Label>
          <Switch id={`${uid}-done`} checked={filters.showDone} onCheckedChange={(v) => onChange({ showDone: v })} />
        </div>
        <Button
          variant="outline"
          size="sm"
          className={cn("h-7 self-start")}
          disabled={count === 0}
          onClick={() => onChange(null)}
        >
          Clear filters
        </Button>
      </PopoverContent>
    </Popover>
  );
}
