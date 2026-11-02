import { Kanban, ListBullets, MagnifyingGlass, Plus, X } from "@phosphor-icons/react";
import { useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useCreateTask } from "./api";
import { NO_FILTERS, type TaskFilters } from "./model/filters";
import { TaskFiltersButton } from "./TaskFilters";
import type { TaskView } from "./view";

interface Props {
  view: TaskView;
  onViewChange: (view: TaskView) => void;
  filters?: TaskFilters;
  onFiltersChange?: (change: Partial<TaskFilters> | null) => void;
  /** Called with the new task after "New task" created it (in the first column). */
  onCreated?: (taskId: string) => void;
  /** Page controls at the start (left-card opener on narrow windows) and end (close button). */
  leading?: ReactNode;
  trailing?: ReactNode;
}

const noChange = () => {};

/**
 * The Tasks panel's single 40 px header row (FR-066, Clarification Q4): title, Board/List, a
 * search button that expands into a field over the row, Filter (with the active-filter badge),
 * New task and the close button — fitting the panel's 320 px minimum (labels show from container
 * widths that fit them).
 */
export function TasksHeader({
  view,
  onViewChange,
  filters = NO_FILTERS,
  onFiltersChange = noChange,
  onCreated,
  leading,
  trailing,
}: Props) {
  const [searching, setSearching] = useState(false);
  const searchButton = useRef<HTMLButtonElement>(null);
  const collapse = () => {
    setSearching(false);
    requestAnimationFrame(() => searchButton.current?.focus());
  };
  const searchActive = filters.search.trim() !== "";
  // clearing the search elsewhere ("Clear filters") collapses the field too
  const [prevSearch, setPrevSearch] = useState(filters.search);
  if (prevSearch !== filters.search) {
    setPrevSearch(filters.search);
    if (!filters.search && searching) setSearching(false);
  }
  return (
    <div data-panel-header className="relative flex h-10 min-w-0 shrink-0 items-center gap-1 px-1.5">
      {leading}
      <h2 className="min-w-0 truncate px-1 text-sm font-semibold tracking-tight">Tasks</h2>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={view}
        onValueChange={(v) => v && onViewChange(v as TaskView)}
        aria-label="Task view"
        className="ml-auto h-7 shrink-0"
      >
        <ToggleGroupItem value="board" aria-label="Board" className="h-7 gap-1 px-2">
          <Kanban size={14} aria-hidden />
          <span className="hidden @[26rem]/tasks:inline">Board</span>
        </ToggleGroupItem>
        <ToggleGroupItem value="list" aria-label="List" className="h-7 gap-1 px-2">
          <ListBullets size={14} aria-hidden />
          <span className="hidden @[26rem]/tasks:inline">List</span>
        </ToggleGroupItem>
      </ToggleGroup>
      <Button
        ref={searchButton}
        variant={searchActive ? "secondary" : "ghost"}
        size="icon"
        className="size-7 shrink-0"
        aria-label={searchActive ? `Search tasks: ${filters.search}` : "Search tasks"}
        aria-expanded={searching}
        onClick={() => setSearching(true)}
      >
        <MagnifyingGlass size={14} aria-hidden />
      </Button>
      <TaskFiltersButton filters={filters} onChange={onFiltersChange} />
      <NewTaskButton onCreated={onCreated} />
      {trailing}
      {searching && (
        <div className="absolute inset-0 z-10 flex items-center gap-1 bg-surface-elevated px-1.5">
          <MagnifyingGlass size={14} aria-hidden className="ml-1 shrink-0 text-text-muted" />
          <Input
            // eslint-disable-next-line jsx-a11y/no-autofocus -- opened on request to type
            autoFocus
            type="search"
            value={filters.search}
            placeholder="Search tasks"
            aria-label="Search tasks"
            className="h-7 min-w-0 flex-1 text-sm"
            onChange={(e) => {
              onFiltersChange({ search: e.target.value });
              if (!e.target.value) collapse();
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                collapse();
              }
            }}
            onBlur={(e) => {
              if (!filters.search && !e.currentTarget.parentElement?.contains(e.relatedTarget as Node | null)) setSearching(false);
            }}
          />
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            aria-label="Clear search"
            onClick={() => {
              onFiltersChange({ search: "" });
              collapse();
            }}
          >
            <X size={14} aria-hidden />
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * "New task" (US1 scenario 2): a small title field in a popover; Enter creates the task at the end
 * of the first column and closes it; Escape closes it. The typed text is kept while closed.
 */
function NewTaskButton({ onCreated }: { onCreated?: (taskId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const create = useCreateTask();
  const submit = () => {
    const text = title.trim();
    if (!text || create.isPending) return;
    create.mutate(
      { title: text },
      {
        onSuccess: (task) => {
          setTitle("");
          setOpen(false);
          toast(`Added “${task.title}”`);
          onCreated?.(task.id);
        },
        onError: () => toast.error("Couldn't add the task"),
      },
    );
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" aria-label="New task" className="h-7 shrink-0 gap-1 px-2">
          <Plus size={14} weight="bold" aria-hidden />
          <span className="hidden @[23rem]/tasks:inline">New task</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2">
        <Input
          // eslint-disable-next-line jsx-a11y/no-autofocus -- opened on request to type a title
          autoFocus
          value={title}
          maxLength={200}
          placeholder="Task title"
          aria-label="New task title"
          className="h-8 text-sm"
          disabled={create.isPending}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <p className="mt-1.5 px-0.5 text-xs text-text-muted">Enter adds it to the first column.</p>
      </PopoverContent>
    </Popover>
  );
}
