import { Graph, Kanban, NotePencil, Timer } from "@phosphor-icons/react";
import { GraphSection } from "@/features/graph/GraphSection";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Card } from "@/app/shell/Card";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useTaskColumns, useTasks, type Task } from "@/features/tasks/api";
import { Board } from "@/features/tasks/board/Board";
import { TaskList } from "@/features/tasks/list/TaskList";
import { activeFilterCount, taskMatcher } from "@/features/tasks/model/filters";
import {
  QuickNotesPopover,
  quickNotesButton,
} from "@/features/tasks/QuickNotesPopover";
import { TaskDetails } from "@/features/tasks/TaskDetails";
import { TasksHeader } from "@/features/tasks/TasksHeader";
import { useTaskFilters } from "@/features/tasks/useTaskFilters";
import { useTaskView } from "@/features/tasks/view";
import { TimePanel } from "@/features/time/TimePanel";
import { GeneralNotesSection } from "./GeneralNotesSection";
import { onTaskRequest, pendingTaskRequest, takeTaskRequest } from "./openTask";
import {
  SECTION_SWITCH_ID,
  type ColumnSection,
  type TasksColumn,
} from "./tasksColumn";

interface Props {
  open: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
  /** Which of Tasks, General notes and (020) Time is shown (018). */
  column: TasksColumn;
}

/** Where focus goes back to when the details close: the opener, else the task's title button. */
function focusTask(taskId: string, opener: HTMLElement | null) {
  requestAnimationFrame(() => {
    if (
      opener?.isConnected &&
      opener.offsetParent !== null &&
      !opener.closest("[inert]")
    )
      return opener.focus();
    const panel = document.getElementById("tasks-panel");
    const el =
      panel?.querySelector<HTMLElement>(
        `[data-task-id="${CSS.escape(taskId)}"] button:not([data-drag-surface])`,
      ) ?? panel?.querySelector<HTMLElement>("[data-panel-header] button");
    el?.focus();
  });
}

/**
 * The home page's Tasks panel (FR-066): one header row and the board or list below, the details
 * sheet over the panel and the quick-note pop-up inside it. Stays mounted while closed (hidden and
 * inert) so its view, filters and unfinished input survive (FR-075). (018) Like the Calendar, a
 * header card above a body card; the header's switch shows Tasks or General notes, one at a time.
 */
export function TasksPanel({ open, leading, trailing, column }: Props) {
  const [view, setView] = useTaskView();
  const [filters, setFilters] = useTaskFilters();
  const tasks = useTasks();
  const columns = useTaskColumns();
  const [panel, setPanel] = useState<HTMLElement | null>(null);

  const matcher = useMemo(
    () => taskMatcher(filters, columns.data ?? []),
    [filters, columns.data],
  );
  const filtering = activeFilterCount(filters) > 0;
  const filter = filtering ? (matcher as (t: Task) => boolean) : undefined;
  const total = tasks.data?.length ?? 0;
  const hidden =
    filtering && tasks.data ? total - tasks.data.filter(matcher).length : 0;

  const [notes, setNotes] = useState<{
    taskId: string;
    anchor: HTMLElement;
  } | null>(null);

  // ---- details sheet ------------------------------------------------------------------------
  // `?task=<id>` and other parts of the home page ask for a task's details (openTask.ts)
  const [details, setDetails] = useState<string | null>(pendingTaskRequest);
  const opener = useRef<HTMLElement | null>(null);
  const openTask = useCallback((taskId: string) => {
    opener.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
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
  const openNotes = useCallback(
    (taskId: string, anchor: HTMLElement) => setNotes({ taskId, anchor }),
    [],
  );
  // closing the panel closes the pop-up (its unmount sends pending saves)
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) setNotes(null);
  }
  const notesTask = notes
    ? tasks.data?.find((t) => t.id === notes.taskId)
    : undefined;

  // ---- Tasks or General notes (018) --------------------------------------------------------
  const { section, setSection } = column;
  const sectionSwitch = (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      value={section}
      onValueChange={(v) => v && setSection(v as ColumnSection)}
      aria-label="Tasks, general notes, time or knowledge graph"
      className="h-7 shrink-0"
    >
      <ToggleGroupItem
        id={SECTION_SWITCH_ID.tasks}
        value="tasks"
        aria-label="Tasks"
        title="Tasks"
        className="h-7 px-2"
      >
        <Kanban size={14} aria-hidden />
      </ToggleGroupItem>
      <ToggleGroupItem
        id={SECTION_SWITCH_ID.notes}
        value="notes"
        aria-label="General notes"
        title="General notes"
        className="h-7 px-2"
      >
        <NotePencil size={14} aria-hidden />
      </ToggleGroupItem>
      <ToggleGroupItem
        id={SECTION_SWITCH_ID.time}
        value="time"
        aria-label="Time"
        title="Time"
        className="h-7 px-2"
      >
        <Timer size={14} aria-hidden />
      </ToggleGroupItem>
      <ToggleGroupItem
        id={SECTION_SWITCH_ID.graph}
        value="graph"
        aria-label="Knowledge graph"
        title="Knowledge graph"
        className="h-7 px-2"
      >
        <Graph size={14} aria-hidden />
      </ToggleGroupItem>
    </ToggleGroup>
  );
  const start = (
    <>
      {leading}
      {sectionSwitch}
    </>
  );

  return (
    <Card
      ref={setPanel}
      as="section"
      id="tasks-panel"
      data-panel="tasks"
      label="Tasks and time"
      body="fill"
      bodyClassName="gap-2"
      chrome={false}
      hidden={!open}
      inert={!open}
      className="@container/tasks h-full"
    >
      <div className="contents" inert={details !== null || undefined}>
        {section === "notes" ? (
          <GeneralNotesSection leading={start} trailing={trailing} />
        ) : section === "time" ? (
          <TimePanel leading={start} trailing={trailing} />
        ) : section === "graph" ? (
          <GraphSection leading={start} trailing={trailing} />
        ) : (
          <>
            <Card className="shrink-0" body="fill">
              <TasksHeader
                view={view}
                onViewChange={setView}
                filters={filters}
                onFiltersChange={setFilters}
                leading={start}
                trailing={trailing}
              />
            </Card>
            <Card id="home-tasks-body" className="flex-1" body="fill">
              {hidden > 0 && (
                <div
                  className="flex shrink-0 items-center gap-2 border-b border-divider px-3 py-1 text-xs text-text-muted"
                  data-testid="filter-notice"
                >
                  {hidden === total && (
                    <span className="font-medium text-text-primary">
                      No tasks match.
                    </span>
                  )}
                  <span>{hidden} hidden by filters</span>
                  <Button
                    variant="link"
                    size="sm"
                    className="ml-auto h-6 px-1 text-xs"
                    onClick={() => setFilters(null)}
                  >
                    Clear filters
                  </Button>
                </div>
              )}
              <div className="min-h-0 flex-1">
                {view === "board" ? (
                  <Board
                    filter={filter}
                    onOpenTask={openTask}
                    onQuickNotes={openNotes}
                  />
                ) : (
                  <TaskList
                    filter={filter}
                    onOpenTask={openTask}
                    onQuickNotes={openNotes}
                  />
                )}
              </div>
            </Card>
          </>
        )}
      </div>
      {details && (
        // the sheet covers both cards, with their rounded border
        <div className="absolute inset-0 z-20 overflow-hidden rounded-[14px] border border-strong-border">
          <TaskDetails
            key={details}
            taskId={details}
            onClose={closeDetails}
            onQuickNotes={openNotes}
          />
        </div>
      )}
      {notes && (
        <QuickNotesPopover
          key={notes.taskId}
          taskId={notes.taskId}
          taskTitle={notesTask?.title ?? ""}
          anchor={
            notes.anchor.isConnected
              ? notes.anchor
              : quickNotesButton(notes.taskId)
          }
          container={panel}
          onClose={() => setNotes(null)}
        />
      )}
    </Card>
  );
}
