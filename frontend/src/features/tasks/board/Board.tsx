/**
 * The task board (US1, US2): columns side by side in a horizontal scroller, cards moved by
 * pointer (`useBoardDrag`) or keyboard (`keyboardMove`), columns reordered the same way by their
 * header handle, an "Add column" button at the end, and a live region announcing moves.
 *
 * Indexes from the drag/keyboard code are relative to the *visible* cards; `fullIndex` maps them
 * to the full column before `useMoveTask` (filters can hide cards — research R11).
 */
import { Plus } from "@phosphor-icons/react";
import { memo, useCallback, useEffect, useMemo, useReducer, useRef, useState, type ComponentProps, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useMe } from "@/features/auth/api";
import { cn } from "@/lib/utils";
import {
  useCreateColumn,
  useMoveTask,
  usePatchColumn,
  useReorderColumns,
  useTaskColumns,
  useTasks,
  type Task,
  type TaskColumn,
} from "../api";
import { scrollKeys, useScrollMemory } from "@/features/home/scrollMemory";
import { useDeleteColumnFlow } from "../DeleteColumnDialog";
import { TaskMenu } from "../TaskMenu";
import { columnTasks, tasksByColumn } from "../model/order";
import { useNow } from "../useNow";
import { BoardColumn, COLUMN_HINT_ID, Ghost } from "./BoardColumn";
import { COLUMN_LIMIT, ColumnNameInput, MAX_COLUMNS } from "./ColumnMenu";
import { fullIndex, slots, type BoardLayout, type DropTarget } from "./dropTarget";
import { announcement, keyboardMove, type KeyboardMoveAction } from "./keyboardMove";
import { TaskCard, TaskMoveHint } from "./TaskCard";
import { useBoardDrag } from "./useBoardDrag";

export interface BoardProps {
  /** Which tasks are shown (search and filters, US4); hidden tasks keep their place. */
  filter?: (task: Task) => boolean;
  /** Open a task's details (title button or a click on the card). */
  onOpenTask?: (taskId: string) => void;
  /** Open a card's quick notes (anchored to its quick-note button). */
  onQuickNotes?: (taskId: string, anchor: HTMLElement) => void;
}

const noop = () => {};
const DEFAULT_CARD_H = 64;

type CardProps = Omit<ComponentProps<typeof TaskCard>, "menu" | "floating" | "columns"> & {
  columns: readonly TaskColumn[];
  onOpen: (taskId: string) => void;
};

/** Same props, where a task that only changed its position (a renumbered column) counts as equal. */
function sameCard(a: CardProps, b: CardProps): boolean {
  for (const k of Object.keys(b) as (keyof CardProps)[]) if (k !== "task" && a[k] !== b[k]) return false;
  if (a.task === b.task) return true;
  for (const k of Object.keys(b.task) as (keyof Task)[]) if (k !== "position" && a.task[k] !== b.task[k]) return false;
  return true;
}

/**
 * A card with its menu, memoized: with every prop stable, a move or a drag frame re-renders only
 * the cards that changed (SC: 300 tasks in 12 columns stay responsive).
 */
const BoardCard = memo(function BoardCard(props: CardProps) {
  return <TaskCard {...props} menu={<TaskMenu task={props.task} columns={props.columns} onOpen={props.onOpen} />} />;
}, sameCard);

interface ColumnKeyMove {
  columnId: string;
  origin: number;
  index: number;
}

/** A polite live region; the text is set directly so a repeated message is announced again. */
function useAnnouncer() {
  const ref = useRef<HTMLDivElement>(null);
  const announce = useCallback((text: string) => {
    const el = ref.current;
    if (!el || !text) return;
    el.textContent = "";
    requestAnimationFrame(() => {
      el.textContent = text;
    });
  }, []);
  return { ref, announce };
}

const moveIds = (ids: readonly string[], id: string, index: number) => {
  const rest = ids.filter((x) => x !== id);
  rest.splice(Math.max(0, Math.min(index, rest.length)), 0, id);
  return rest;
};

export function Board({ filter, onOpenTask = noop, onQuickNotes = noop }: BoardProps) {
  const tasksQuery = useTasks();
  const columnsQuery = useTaskColumns();
  const { data: me } = useMe();
  const tz = me?.timezone ?? "UTC";
  const now = useNow();
  const tasks = useMemo(() => tasksQuery.data ?? [], [tasksQuery.data]);
  const columns = useMemo(() => [...(columnsQuery.data ?? [])].sort((a, b) => a.position - b.position), [columnsQuery.data]);
  const groups = useMemo(() => tasksByColumn(tasks, columns), [tasks, columns]);
  const layout: BoardLayout = useMemo(
    () => groups.map((g) => ({ id: g.column.id, taskIds: (filter ? g.tasks.filter(filter) : g.tasks).map((t) => t.id) })),
    [groups, filter],
  );
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const layoutRef = useRef(layout);
  useEffect(() => {
    layoutRef.current = layout;
  });

  const move = useMoveTask();
  const reorder = useReorderColumns();
  const patchColumn = usePatchColumn();
  const createColumn = useCreateColumn();
  const { ref: announcerRef, announce } = useAnnouncer();
  const liveCount = useCallback((columnId: string) => columnTasks(tasks, columnId).length, [tasks]);
  const deleteFlow = useDeleteColumnFlow(columns, liveCount);
  const columnName = (id: string) => columns.find((c) => c.id === id)?.name ?? "";

  // ---- committing moves ---------------------------------------------------------------------

  /** Move a task to a visible-index target, mapped onto the full column. */
  const commitMove = (taskId: string, target: DropTarget) => {
    const task = taskById.get(taskId);
    if (!task) return;
    const full = columnTasks(tasks, target.columnId).map((t) => t.id);
    const visible = layoutRef.current.find((c) => c.id === target.columnId)?.taskIds ?? [];
    move.mutate({ id: taskId, version: task.version, columnId: target.columnId, index: fullIndex(full, visible, target.index, taskId) });
  };

  const commitColumnOrder = (columnId: string, index: number) => {
    const ids = columns.map((c) => c.id);
    const next = moveIds(ids, columnId, index);
    if (next.join() !== ids.join()) reorder.mutate(next);
  };

  // ---- pointer drag -------------------------------------------------------------------------

  const { drag, onCardPointerDown, onColumnPointerDown, registerCard, registerColumn, boardRef: dragBoardRef } = useBoardDrag({
    getLayout: () => layoutRef.current,
    onDrop: (taskId, target) => {
      commitMove(taskId, target);
      const total = (layoutRef.current.find((c) => c.id === target.columnId)?.taskIds.filter((id) => id !== taskId).length ?? 0) + 1;
      announce(`Dropped in ${columnName(target.columnId)}, position ${target.index + 1} of ${total}.`);
    },
    onColumnDrop: (columnId, index) => {
      commitColumnOrder(columnId, index);
      announce(`Column ${columnName(columnId)} moved to position ${index + 1} of ${columns.length}.`);
    },
    onCancel: () => announce("Move cancelled."),
  });

  // the board's horizontal scroll survives leaving the home page (FR-089)
  const rememberBoard = useScrollMemory<HTMLDivElement>(scrollKeys.board, "left");
  const boardRef = useCallback(
    (el: HTMLDivElement | null) => {
      rememberBoard(el);
      dragBoardRef(el);
    },
    [rememberBoard, dragBoardRef],
  );

  // ---- keyboard card moves (FR-016) -----------------------------------------------------------

  const [kb, dispatch] = useReducer(keyboardMove, null);
  const kbRef = useRef(kb);
  useEffect(() => {
    kbRef.current = kb;
  });
  const refocus = useRef<string | null>(null);
  const [kbHeight, setKbHeight] = useState(DEFAULT_CARD_H);

  const step = (action: KeyboardMoveAction) => {
    const before = kbRef.current;
    const after = keyboardMove(before, action);
    kbRef.current = after;
    dispatch(action);
    const ending = action.type === "drop" || action.type === "cancel";
    announce(announcement(action.type, ending ? before : after, columns, tasks, layoutRef.current));
    return { before, after };
  };

  const onMoveKeyDown = (e: KeyboardEvent<HTMLElement>, taskId: string) => {
    const current = kbRef.current;
    const keys: Record<string, KeyboardMoveAction["type"]> = {
      ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
    };
    if (current?.taskId !== taskId) {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      setKbHeight(e.currentTarget.closest<HTMLElement>("[data-task-id]")?.offsetHeight ?? DEFAULT_CARD_H);
      step({ type: "pickUp", taskId, layout: layoutRef.current });
      return;
    }
    if (keys[e.key]) {
      step({ type: keys[e.key] as "up", layout: layoutRef.current });
    } else if (e.key === "Enter" || e.key === " ") {
      const { before } = step({ type: "drop" });
      if (before && (before.target.columnId !== before.origin.columnId || before.target.index !== before.origin.index)) {
        refocus.current = taskId;
        commitMove(taskId, before.target);
      }
    } else if (e.key === "Escape") {
      step({ type: "cancel" });
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const onMoveBlur = (taskId: string) => {
    if (kbRef.current?.taskId === taskId) step({ type: "cancel" });
  };

  // stable identities for the memoized cards; they call this render's handlers
  const cardHandlers = useRef({ onMoveKeyDown, onMoveBlur });
  useEffect(() => {
    cardHandlers.current = { onMoveKeyDown, onMoveBlur };
  });
  const stableMoveKeyDown = useCallback((e: KeyboardEvent<HTMLElement>, taskId: string) => cardHandlers.current.onMoveKeyDown(e, taskId), []);
  const stableMoveBlur = useCallback((taskId: string) => cardHandlers.current.onMoveBlur(taskId), []);

  // ---- keyboard column moves (FR-009) ---------------------------------------------------------

  const [colKb, setColKb] = useState<ColumnKeyMove | null>(null);
  const colKbRef = useRef(colKb);
  useEffect(() => {
    colKbRef.current = colKb;
  });
  const refocusColumn = useRef<string | null>(null);

  const setCol = (next: ColumnKeyMove | null) => {
    colKbRef.current = next;
    setColKb(next);
  };

  const onHandleKeyDown = (e: KeyboardEvent<HTMLElement>, columnId: string) => {
    const current = colKbRef.current;
    const n = columns.length;
    if (current?.columnId !== columnId) {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      const origin = columns.findIndex((c) => c.id === columnId);
      setCol({ columnId, origin, index: origin });
      announce(`Picked up column ${columnName(columnId)}. Position ${origin + 1} of ${n}.`);
      return;
    }
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const index = Math.max(0, Math.min(n - 1, current.index + (e.key === "ArrowLeft" ? -1 : 1)));
      setCol({ ...current, index });
      announce(`Column ${columnName(columnId)}, position ${index + 1} of ${n}.`);
    } else if (e.key === "Enter" || e.key === " ") {
      setCol(null);
      if (current.index !== current.origin) {
        refocusColumn.current = columnId;
        commitColumnOrder(columnId, current.index);
      }
      announce(`Column ${columnName(columnId)} dropped at position ${current.index + 1} of ${n}.`);
    } else if (e.key === "Escape") {
      setCol(null);
      announce("Move cancelled.");
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const onHandleBlur = (columnId: string) => {
    if (colKbRef.current?.columnId === columnId) {
      setCol(null);
      announce("Move cancelled.");
    }
  };

  // after a keyboard drop the moved card/column re-renders elsewhere: keep focus on it
  useEffect(() => {
    const id = refocus.current;
    const col = refocusColumn.current;
    if (!id && !col) return;
    const el = id
      ? document.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(id)}"] [data-drag-surface]`)
      : document.querySelector<HTMLElement>(`[data-column-id="${CSS.escape(col!)}"] [data-drag-surface]`);
    if (el && el !== document.activeElement) el.focus();
    refocus.current = null;
    refocusColumn.current = null;
  }, [tasks, columns]);

  // keep the landing slot of a keyboard move in view
  useEffect(() => {
    if (!kb && !colKb) return;
    document
      .querySelector<HTMLElement>("[data-testid='task-board'] [data-ghost]")
      ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [kb, colKb]);

  // ---- rendering ----------------------------------------------------------------------------

  if (tasksQuery.isPending || columnsQuery.isPending) {
    return <p className="p-3 text-sm text-text-muted">Loading tasks…</p>;
  }
  if (tasksQuery.isError || columnsQuery.isError) {
    return (
      <div className="flex flex-col items-start gap-2 p-3 text-sm">
        <p>Couldn't load tasks.</p>
        <Button size="sm" variant="outline" onClick={() => void Promise.all([tasksQuery.refetch(), columnsQuery.refetch()])}>
          Retry
        </Button>
      </div>
    );
  }

  const cardDrag = drag?.mode === "card" ? drag : null;
  const columnDrag = drag?.mode === "column" ? drag : null;
  const draggedTask = cardDrag ? taskById.get(cardDrag.id) : undefined;
  const ghostHeight = cardDrag?.height ?? kbHeight;

  const columnSlots = slots(
    columns.map((c) => c.id),
    columnDrag?.id ?? colKb?.columnId ?? null,
    !columnDrag,
    columnDrag ? (columnDrag.target?.index ?? null) : colKb ? colKb.index : null,
  );
  const columnGhost = (
<Ghost key="column-ghost" className="h-full rounded-xl" width={columnDrag?.width ?? 280} />
  );

  const cardSlots = (columnId: string, ids: readonly string[]) => {
    if (cardDrag) return slots(ids, cardDrag.id, false, cardDrag.target?.columnId === columnId ? cardDrag.target.index : null);
    if (kb) return slots(ids, kb.taskId, true, kb.target.columnId === columnId ? kb.target.index : null);
    return slots(ids, null, false, null);
  };

  const renderCard = (taskId: string) => {
    const task = taskById.get(taskId);
    if (!task) return null;
    return (
      <BoardCard
        task={task}
        columns={columns}
        now={now}
        tz={tz}
        cardRef={registerCard(taskId)}
        pickedUp={kb?.taskId === taskId}
        onOpen={onOpenTask}
        onQuickNotes={onQuickNotes}
        onPointerDown={onCardPointerDown}
        onMoveKeyDown={stableMoveKeyDown}
        onMoveBlur={stableMoveBlur}
      />
    );
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div
        ref={boardRef}
        data-testid="task-board"
        className={cn("flex h-full min-h-0 items-stretch gap-2 overflow-x-auto overflow-y-hidden p-2", drag && "cursor-grabbing")}
      >
        {columnSlots.map((slot) => {
          if (slot.kind === "ghost") return columnGhost;
          const column = columns.find((c) => c.id === slot.id)!;
          const index = columns.indexOf(column);
          const ids = layout.find((c) => c.id === column.id)?.taskIds ?? [];
          return (
            <BoardColumn
              key={column.id}
              column={column}
              index={index}
              columnCount={columns.length}
              count={liveCount(column.id)}
              slots={cardSlots(column.id, ids)}
              renderCard={renderCard}
              ghostHeight={ghostHeight}
              columnRef={registerColumn(column.id)}
              pickedUp={colKb?.columnId === column.id}
              onHeaderPointerDown={onColumnPointerDown}
              onHandleKeyDown={onHandleKeyDown}
              onHandleBlur={onHandleBlur}
              onRename={(name) => patchColumn.mutateAsync({ id: column.id, version: column.version, body: { name } })}
              onToggleDone={(countsAsDone) =>
                patchColumn.mutate({ id: column.id, version: column.version, body: { countsAsDone } })
              }
              onMove={(delta) => {
                commitColumnOrder(column.id, index + delta);
                announce(`Column ${column.name} moved to position ${index + delta + 1} of ${columns.length}.`);
              }}
              onDelete={() => deleteFlow.request(column)}
            />
          );
        })}
        <AddColumn
          atLimit={columns.length >= MAX_COLUMNS}
          onCreate={(name) => createColumn.mutateAsync({ name })}
        />
      </div>

      {cardDrag &&
        draggedTask &&
        createPortal(
          <div
            className="pointer-events-none fixed top-0 left-0 z-50 rounded-lg shadow-lg motion-safe:rotate-1"
            style={{
              width: cardDrag.width,
              transform: `translate(${cardDrag.pointerX - cardDrag.offsetX}px, ${cardDrag.pointerY - cardDrag.offsetY}px)`,
            }}
            data-testid="drag-clone"
          >
            <TaskCard task={draggedTask} columns={columns} now={now} tz={tz} floating />
          </div>,
          document.body,
        )}
      {columnDrag &&
        createPortal(
          <ColumnClone drag={columnDrag} column={columns.find((c) => c.id === columnDrag.id)} count={liveCount(columnDrag.id)} />,
          document.body,
        )}

      <TaskMoveHint />
      <span id={COLUMN_HINT_ID} className="sr-only">
        Press Enter or Space to pick up the column, left and right arrows to move it, Enter to drop, Escape to cancel.
      </span>
      <div ref={announcerRef} role="status" aria-live="polite" className="sr-only" data-testid="tasks-announcer" />
      {deleteFlow.dialog}
    </div>
  );
}

function ColumnClone({
  drag,
  column,
  count,
}: {
  drag: { width: number; height: number; pointerX: number; pointerY: number; offsetX: number; offsetY: number };
  column: TaskColumn | undefined;
  count: number;
}) {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed top-0 left-0 z-50 flex flex-col rounded-xl border border-divider bg-surface-sunken shadow-lg"
      style={{
        width: drag.width,
        height: drag.height,
        transform: `translate(${drag.pointerX - drag.offsetX}px, ${drag.pointerY - drag.offsetY}px)`,
      }}
    >
      <div className="flex h-10 items-center gap-2 px-3 text-sm font-semibold">
        {column?.name}
        <span className="text-xs font-normal tabular-nums text-text-muted">{count}</span>
      </div>
    </div>
  );
}

/** "Add column" at the end of the board (FR-009, FR-010): at most 12 columns. */
function AddColumn({ atLimit, onCreate }: { atLimit: boolean; onCreate: (name: string) => Promise<unknown> }) {
  const [adding, setAdding] = useState(false);
  const reasonId = "add-column-limit";
  if (adding && !atLimit) {
    return (
      <div className="w-70 shrink-0 p-1">
        <ColumnNameInput label="New column name" onSave={onCreate} onDone={() => setAdding(false)} />
      </div>
    );
  }
  return (
    <div className="shrink-0">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            aria-disabled={atLimit || undefined}
            aria-describedby={atLimit ? reasonId : undefined}
            onClick={() => !atLimit && setAdding(true)}
          >
            <Plus size={14} weight="bold" aria-hidden />
            Add column
          </Button>
        </TooltipTrigger>
        {atLimit && <TooltipContent>{COLUMN_LIMIT}</TooltipContent>}
      </Tooltip>
      {atLimit && (
        <span id={reasonId} className="sr-only">
          {COLUMN_LIMIT}
        </span>
      )}
    </div>
  );
}
