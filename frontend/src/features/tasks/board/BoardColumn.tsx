import { Check, DotsSixVertical } from "@phosphor-icons/react";
import { Fragment, useState, type KeyboardEvent, type PointerEvent, type ReactNode, type Ref } from "react";
import { scrollKeys, useScrollMemory } from "@/features/home/scrollMemory";
import { cn } from "@/lib/utils";
import type { TaskColumn } from "../api";
import { AddTaskField } from "./AddTaskField";
import { ColumnMenu, ColumnNameInput } from "./ColumnMenu";
import type { Slot } from "./dropTarget";

export const COLUMN_HINT_ID = "column-move-hint";

/** The landing slot of a drag or keyboard move (FR-014): the dragged item's size, dashed. */
export function Ghost({ height, width, className }: { height?: number; width?: number; className?: string }) {
  return (
    <div
      data-ghost
      aria-hidden
      className={cn("shrink-0 rounded-lg border border-dashed border-draft-border bg-muted", className)}
      style={{ height, width }}
    />
  );
}

export interface BoardColumnProps {
  column: TaskColumn;
  /** Board index and number of columns (Move left/right, Delete). */
  index: number;
  columnCount: number;
  /** Live tasks in the column, including any hidden by filters. */
  count: number;
  /** Cards and the ghost in render order (see `slots` in dropTarget.ts). */
  slots: Slot[];
  renderCard: (taskId: string) => ReactNode;
  /** Height of the ghost placeholder (the dragged card's height). */
  ghostHeight: number;
  columnRef?: Ref<HTMLDivElement>;
  /** Picked up for a keyboard column move: `aria-pressed` on the handle and a ring. */
  pickedUp?: boolean;
  onHeaderPointerDown?: (e: PointerEvent<HTMLElement>, columnId: string) => void;
  onHandleKeyDown?: (e: KeyboardEvent<HTMLElement>, columnId: string) => void;
  onHandleBlur?: (columnId: string) => void;
  onRename: (name: string) => Promise<unknown>;
  onToggleDone: (value: boolean) => void;
  onMove: (delta: -1 | 1) => void;
  onDelete: () => void;
}

/**
 * One board column (FR-012): fixed ≈ 280 px, its own vertical scroll; header with a reorder
 * handle, name, count, "Done column" badge and menu; the cards; an "Add task" field at the
 * bottom (FR-015).
 */
export function BoardColumn({
  column,
  index,
  columnCount,
  count,
  slots,
  renderCard,
  ghostHeight,
  columnRef,
  pickedUp = false,
  onHeaderPointerDown,
  onHandleKeyDown,
  onHandleBlur,
  onRename,
  onToggleDone,
  onMove,
  onDelete,
}: BoardColumnProps) {
  const [renaming, setRenaming] = useState(false);
  const empty = slots.length === 0;
  const scrollRef = useScrollMemory<HTMLDivElement>(scrollKeys.column(column.id));

  return (
    <div
      ref={columnRef}
      data-column-id={column.id}
      role="group"
      aria-label={column.name}
      className={cn(
        "flex h-full w-70 shrink-0 flex-col rounded-xl border border-divider bg-surface-sunken",
        pickedUp && "ring-2 ring-ring",
      )}
    >
      <div
        className="flex h-10 shrink-0 cursor-grab touch-none items-center gap-1 px-1.5 select-none"
        onPointerDown={(e) => onHeaderPointerDown?.(e, column.id)}
      >
        <button
          type="button"
          data-drag-surface
          aria-label={`Reorder column ${column.name}`}
          aria-describedby={COLUMN_HINT_ID}
          aria-pressed={pickedUp}
          className="flex size-6 shrink-0 cursor-grab items-center justify-center rounded-sm text-text-muted outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring"
          onKeyDown={(e) => onHandleKeyDown?.(e, column.id)}
          onBlur={() => onHandleBlur?.(column.id)}
        >
          <DotsSixVertical size={14} weight="bold" aria-hidden />
        </button>
        {renaming ? (
          <ColumnNameInput
            label="Column name"
            initial={column.name}
            onSave={onRename}
            onDone={() => setRenaming(false)}
            className="flex-1"
          />
        ) : (
          <>
            <h3 className="min-w-0 truncate text-sm font-semibold">{column.name}</h3>
            <span className="shrink-0 text-xs tabular-nums text-text-muted" aria-label={`${count} tasks`}>
              {count}
            </span>
            {column.countsAsDone && (
              <span
                className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-divider px-1.5 text-[11px] font-medium text-text-muted"
                data-testid="done-column-badge"
              >
                <Check size={10} weight="bold" aria-hidden />
                Done column
              </span>
            )}
            <span className="ml-auto" />
          </>
        )}
        <ColumnMenu
          name={column.name}
          countsAsDone={column.countsAsDone}
          canMoveLeft={index > 0}
          canMoveRight={index < columnCount - 1}
          canDelete={columnCount > 1}
          // after the menu has closed and given focus back, so the field keeps it
          onRename={() => window.setTimeout(() => setRenaming(true), 0)}
          onToggleDone={onToggleDone}
          onMoveLeft={() => onMove(-1)}
          onMoveRight={() => onMove(1)}
          onDelete={onDelete}
        />
      </div>
      <div ref={scrollRef} data-column-scroll className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
        {slots.map((slot) =>
          slot.kind === "ghost" ? <Ghost key="ghost" height={ghostHeight} /> : <Fragment key={slot.id}>{renderCard(slot.id)}</Fragment>,
        )}
        {empty && <p className="px-1 py-2 text-xs text-text-muted">No tasks</p>}
      </div>
      <div className="shrink-0 p-2 pt-0">
        <AddTaskField columnId={column.id} columnName={column.name} />
      </div>
    </div>
  );
}
