import { CaretDown } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Card } from "@/app/shell/Card";
import { PanelResizeHandle } from "@/components/PanelResizeHandle";
import { Button } from "@/components/ui/button";
import { useTaskColumns, useTasks, type Task } from "@/features/tasks/api";
import { Board } from "@/features/tasks/board/Board";
import { TaskList } from "@/features/tasks/list/TaskList";
import { activeFilterCount, taskMatcher } from "@/features/tasks/model/filters";
import { QuickNotesPopover, quickNotesButton } from "@/features/tasks/QuickNotesPopover";
import { TaskDetails } from "@/features/tasks/TaskDetails";
import { TasksHeader } from "@/features/tasks/TasksHeader";
import { useTaskFilters } from "@/features/tasks/useTaskFilters";
import { useTaskView } from "@/features/tasks/view";
import { GeneralNotesSection } from "./GeneralNotesSection";
import { onTaskRequest, pendingTaskRequest, takeTaskRequest } from "./openTask";
import { DEFAULT_SHARE, type TasksColumn } from "./tasksColumn";

interface Props {
  open: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
  /** Tasks above General notes, each collapsible (018). */
  column: TasksColumn;
}

/** A section's smallest height while both are expanded: its header and some content. */
const SECTION_MIN_PX = 140;

/** Where focus goes back to when the details close: the opener, else the task's title button. */
function focusTask(taskId: string, opener: HTMLElement | null) {
  requestAnimationFrame(() => {
    if (opener?.isConnected && opener.offsetParent !== null && !opener.closest("[inert]")) return opener.focus();
    const panel = document.getElementById("tasks-panel");
    const el =
      panel?.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(taskId)}"] button:not([data-drag-surface])`) ??
      panel?.querySelector<HTMLElement>("[data-panel-header] button");
    el?.focus();
  });
}

/**
 * The home page's Tasks panel (FR-066): one header row and the board or list below, the details
 * sheet over the panel and the quick-note pop-up inside it. Stays mounted while closed (hidden and
 * inert) so its view, filters and unfinished input survive (FR-075). (018) Like the session
 * panel, it stacks two collapsible sections, Tasks above General notes, with a resizable boundary.
 */
export function TasksPanel({ open, leading, trailing, column }: Props) {
  const [view, setView] = useTaskView();
  const [filters, setFilters] = useTaskFilters();
  const tasks = useTasks();
  const columns = useTaskColumns();
  const [panel, setPanel] = useState<HTMLElement | null>(null);

  const matcher = useMemo(() => taskMatcher(filters, columns.data ?? []), [filters, columns.data]);
  const filtering = activeFilterCount(filters) > 0;
  const filter = filtering ? (matcher as (t: Task) => boolean) : undefined;
  const total = tasks.data?.length ?? 0;
  const hidden = filtering && tasks.data ? total - tasks.data.filter(matcher).length : 0;

  const [notes, setNotes] = useState<{ taskId: string; anchor: HTMLElement } | null>(null);

  // ---- details sheet ------------------------------------------------------------------------
  // `?task=<id>` and other parts of the home page ask for a task's details (openTask.ts)
  const [details, setDetails] = useState<string | null>(pendingTaskRequest);
  const opener = useRef<HTMLElement | null>(null);
  const openTask = useCallback((taskId: string) => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setNotes(null);
    setDetails(taskId);
  }, []);
  const closeDetails = useCallback(() => {
    setDetails((id) => {
      if (id) focusTask(id, opener.current);
      return null;
    });
  }, []);
  useEffect(() => {
    takeTaskRequest(); // a request made before mounting is already shown
    return onTaskRequest(() => {
      const id = takeTaskRequest();
      if (!id) return;
      opener.current = null;
      setNotes(null);
      setDetails(id);
    });
  }, []);

  // ---- quick notes --------------------------------------------------------------------------
  const openNotes = useCallback((taskId: string, anchor: HTMLElement) => setNotes({ taskId, anchor }), []);
  // closing the panel closes the pop-up (its unmount sends pending saves)
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) setNotes(null);
  }
  const notesTask = notes ? tasks.data?.find((t) => t.id === notes.taskId) : undefined;

  // ---- Tasks above General notes (018) -------------------------------------------------------
  const { collapsed, share, setCollapsed, setShare } = column;
  const both = !collapsed.tasks && !collapsed.notes;
  const tasksEl = useRef<HTMLDivElement>(null);
  const notesEl = useRef<HTMLElement>(null);
  const columnEl = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const el = columnEl.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setHeight(e.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const minShare = height > 0 ? Math.min(50, Math.max(10, Math.ceil((100 * SECTION_MIN_PX) / height))) : 10;
  const tasksToggle = (
    <Button
      id="home-tasks-toggle"
      variant="ghost"
      size="icon"
      className="size-8 shrink-0"
      aria-expanded={!collapsed.tasks}
      aria-controls="home-tasks-body"
      aria-label={`${collapsed.tasks ? "Expand" : "Collapse"} Tasks`}
      onClick={() => setCollapsed("tasks", !collapsed.tasks)}
    >
      <CaretDown size={14} weight="bold" aria-hidden className={collapsed.tasks ? "-rotate-90" : undefined} />
    </Button>
  );

  return (
    <Card
      ref={setPanel}
      as="section"
      id="tasks-panel"
      data-panel="tasks"
      label="Tasks"
      body="fill"
      hidden={!open}
      inert={!open}
      className="@container/tasks h-full"
    >
      <div ref={columnEl} className="flex min-h-0 flex-1 flex-col" inert={details !== null || undefined}>
        <TasksHeader
          view={view}
          onViewChange={setView}
          filters={filters}
          onFiltersChange={setFilters}
          leading={
            <>
              {leading}
              {tasksToggle}
            </>
          }
          trailing={trailing}
        />
        <div
          ref={tasksEl}
          id="home-tasks-body"
          hidden={collapsed.tasks}
          className="flex min-h-0 flex-col"
          style={collapsed.tasks ? undefined : { flex: `${both ? share : 1} 1 0` }}
        >
          {hidden > 0 && (
            <div className="flex shrink-0 items-center gap-2 border-b border-divider px-3 py-1 text-xs text-text-muted" data-testid="filter-notice">
              {hidden === total && <span className="font-medium text-text-primary">No tasks match.</span>}
              <span>{hidden} hidden by filters</span>
              <Button variant="link" size="sm" className="ml-auto h-6 px-1 text-xs" onClick={() => setFilters(null)}>
                Clear filters
              </Button>
            </div>
          )}
          <div className="min-h-0 flex-1">
            {view === "board" ? (
              <Board filter={filter} onOpenTask={openTask} onQuickNotes={openNotes} />
            ) : (
              <TaskList filter={filter} onOpenTask={openTask} onQuickNotes={openNotes} />
            )}
          </div>
        </div>
        <GeneralNotesSection
          collapsed={collapsed.notes}
          onToggle={() => setCollapsed("notes", !collapsed.notes)}
          sectionRef={notesEl}
          className={collapsed.notes ? "shrink-0 border-t border-divider" : "min-h-[140px] border-t border-divider"}
          style={collapsed.notes ? undefined : { flex: `${both ? 100 - share : 1} 1 0` }}
          handle={
            both && (
              <PanelResizeHandle
                value={share}
                min={minShare}
                max={100 - minShare}
                defaultValue={DEFAULT_SHARE}
                onResize={setShare}
                onDrag={(p) => {
                  tasksEl.current?.style.setProperty("flex-grow", String(p));
                  notesEl.current?.style.setProperty("flex-grow", String(100 - p));
                }}
                // the value is the Tasks share: dragging the boundary down makes it larger
                grow="down"
                step={5}
                unitsPerPx={() => 100 / ((tasksEl.current?.clientHeight ?? 0) + (notesEl.current?.clientHeight ?? 0) || 1)}
                label="Resize Tasks and General notes"
                controls="home-tasks-body"
                className="top-0"
              />
            )
          }
        />
      </div>
      {details && (
        <TaskDetails key={details} taskId={details} onClose={closeDetails} onQuickNotes={openNotes} />
      )}
      {notes && (
        <QuickNotesPopover
          key={notes.taskId}
          taskId={notes.taskId}
          taskTitle={notesTask?.title ?? ""}
          anchor={notes.anchor.isConnected ? notes.anchor : quickNotesButton(notes.taskId)}
          container={panel}
          onClose={() => setNotes(null)}
        />
      )}
    </Card>
  );
}
