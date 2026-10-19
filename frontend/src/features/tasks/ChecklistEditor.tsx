/**
 * The details sheet's checklist (FR-024): tick, edit in place, Enter adds an item below,
 * Backspace on an empty item removes it, Alt+↑/↓ or the drag handle reorder, and the delete button
 * removes an item with an Undo toast (R6: items are re-created on Undo).
 *
 * The list is kept here and the whole list is saved with `PUT /tasks/{id}/checklist` — at once for
 * ticks, adds, removes and moves, 600 ms after typing for text. One request at a time; changes
 * made meanwhile are sent right after. A failed save keeps the items and offers Retry (FR-027).
 */
import { DotsSixVertical, Plus, X } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useId, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { taskKeys, useReplaceChecklist, type ChecklistItem, type TaskDetail } from "./api";
import { SaveState } from "./SaveState";

const UNDO_MS = 10_000;
const TEXT_DELAY = 600;
export const CHECKLIST_MAX = 200;
const TEXT_MAX = 500;

interface Item {
  key: string;
  id?: string | null;
  text: string;
  done: boolean;
}

let seq = 0;
const newKey = () => `item-${++seq}`;
const fromServer = (items: readonly ChecklistItem[]): Item[] => items.map((i) => ({ key: i.id, id: i.id, text: i.text, done: i.done }));

/** What is sent: empty items are not saved yet (the server needs 1–500 characters). */
const payload = (items: readonly Item[]) =>
  items.filter((i) => i.text.trim()).map((i) => ({ id: i.id ?? null, text: i.text.trim().slice(0, TEXT_MAX), done: i.done }));

interface Props {
  task: TaskDetail;
}

export function ChecklistEditor({ task }: Props) {
  const qc = useQueryClient();
  const replace = useReplaceChecklist();
  const [items, setItems] = useState<Item[]>(() => fromServer(task.checklist));
  const [status, setStatus] = useState<"saved" | "saving" | "error">("saved");
  const itemsRef = useRef(items);
  const listId = useId();
  const focusKey = useRef<{ key: string; at?: number } | null>(null);

  // ---- saving ---------------------------------------------------------------------------------
  const inFlight = useRef(false);
  const again = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const dirty = useRef(false);

  const send = useCallback(async () => {
    window.clearTimeout(timer.current);
    if (inFlight.current) {
      again.current = true;
      return;
    }
    inFlight.current = true;
    try {
      do {
        again.current = false;
        dirty.current = false;
        setStatus("saving");
        const sent = itemsRef.current;
        const version = qc.getQueryData<TaskDetail>(taskKeys.detail(task.id))?.version ?? task.version;
        const saved = await replace.mutateAsync({ id: task.id, version, items: payload(sent) });
        // keep the server's ids for the items sent (others are matched again next time)
        const sentSaved = sent.filter((i) => i.text.trim());
        const next = itemsRef.current.map((i) => {
          const at = sentSaved.indexOf(i);
          return at >= 0 && saved.checklist[at] ? { ...i, id: saved.checklist[at].id } : i;
        });
        itemsRef.current = next;
        setItems(next);
      } while (again.current || dirty.current);
      setStatus("saved");
    } catch {
      dirty.current = true;
      setStatus("error");
    } finally {
      inFlight.current = false;
      again.current = false;
    }
  }, [qc, replace, task.id, task.version]);

  const change = (next: Item[], delay = 0) => {
    itemsRef.current = next;
    setItems(next);
    dirty.current = true;
    window.clearTimeout(timer.current);
    if (delay) {
      setStatus((s) => (s === "error" ? s : "saving"));
      timer.current = window.setTimeout(() => void send(), delay);
    } else void send();
  };

  // leaving the sheet sends a pending text change at once
  useEffect(
    () => () => {
      if (timer.current !== undefined && dirty.current) {
        window.clearTimeout(timer.current);
        void send();
      }
    },
    [send],
  );

  // ---- focus after adds/removes ------------------------------------------------------------------
  const inputs = useRef(new Map<string, HTMLInputElement>());
  useEffect(() => {
    const f = focusKey.current;
    if (!f) return;
    focusKey.current = null;
    const el = inputs.current.get(f.key);
    if (!el) return;
    el.focus();
    const at = f.at ?? el.value.length;
    el.setSelectionRange(at, at);
  });

  // ---- edits -------------------------------------------------------------------------------------
  const update = (key: string, patch: Partial<Item>, delay = 0) =>
    change(itemsRef.current.map((i) => (i.key === key ? { ...i, ...patch } : i)), delay);

  const insertAfter = (index: number) => {
    if (itemsRef.current.length >= CHECKLIST_MAX) return;
    const item: Item = { key: newKey(), text: "", done: false };
    const next = [...itemsRef.current];
    next.splice(index + 1, 0, item);
    focusKey.current = { key: item.key };
    // an empty item is not saved yet: nothing to send
    itemsRef.current = next;
    setItems(next);
  };

  const remove = (key: string, { undo, focusPrevious }: { undo: boolean; focusPrevious: boolean }) => {
    const index = itemsRef.current.findIndex((i) => i.key === key);
    if (index < 0) return;
    const item = itemsRef.current[index];
    const next = itemsRef.current.filter((i) => i.key !== key);
    const neighbour = next[Math.max(0, index - 1)];
    if (focusPrevious && neighbour) focusKey.current = { key: neighbour.key };
    change(next);
    if (undo && item.text.trim())
      toast("Checklist item deleted", {
        duration: UNDO_MS,
        action: {
          label: "Undo",
          onClick: () => {
            const current = [...itemsRef.current];
            current.splice(Math.min(index, current.length), 0, { ...item, key: newKey(), id: null });
            change(current);
          },
        },
      });
  };

  const move = (key: string, to: number) => {
    const list = [...itemsRef.current];
    const from = list.findIndex((i) => i.key === key);
    const target = Math.max(0, Math.min(list.length - 1, to));
    if (from < 0 || from === target) return;
    const [item] = list.splice(from, 1);
    list.splice(target, 0, item);
    focusKey.current = { key, at: inputs.current.get(key)?.selectionStart ?? undefined };
    change(list);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>, item: Item, index: number) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter") {
      e.preventDefault();
      insertAfter(index);
    } else if (e.key === "Backspace" && item.text === "" && !e.altKey) {
      e.preventDefault();
      remove(item.key, { undo: false, focusPrevious: true });
    } else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      move(item.key, index + (e.key === "ArrowUp" ? -1 : 1));
    }
  };

  // ---- drag handle (pointer) -----------------------------------------------------------------------
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const onDragOver = (e: DragEvent<HTMLLIElement>, index: number) => {
    if (!dragging) return;
    e.preventDefault();
    setOver(index);
  };
  const onDrop = (e: DragEvent<HTMLLIElement>, index: number) => {
    e.preventDefault();
    if (dragging) move(dragging, index);
    setDragging(null);
    setOver(null);
  };

  const done = items.filter((i) => i.done && i.text.trim()).length;
  const total = items.filter((i) => i.text.trim()).length;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <h3 id={`${listId}-title`} className="text-sm font-medium">
          Checklist
        </h3>
        {total > 0 && (
          <span className="text-xs tabular-nums text-text-muted" data-testid="details-checklist-count">
            {done}/{total}
          </span>
        )}
        <span className="ml-auto" />
        {status !== "saved" && (
          <SaveState status={status === "error" ? "error" : "saving"} onRetry={() => void send()} />
        )}
      </div>
      {items.length > 0 && (
        <ul aria-labelledby={`${listId}-title`} className="flex flex-col gap-0.5">
          {items.map((item, index) => (
            <li
              key={item.key}
              onDragOver={(e) => onDragOver(e, index)}
              onDrop={(e) => onDrop(e, index)}
              className={cn(
                "group/item flex items-center gap-1.5 rounded-md px-1",
                over === index && dragging && dragging !== item.key && "ring-1 ring-ring",
                dragging === item.key && "opacity-50",
              )}
            >
              <span
                draggable
                role="presentation"
                title="Drag to reorder (or Alt+↑/↓)"
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", item.text);
                  setDragging(item.key);
                }}
                onDragEnd={() => {
                  setDragging(null);
                  setOver(null);
                }}
                className="flex size-5 shrink-0 cursor-grab items-center justify-center text-text-muted"
              >
                <DotsSixVertical size={12} weight="bold" aria-hidden />
              </span>
              <Checkbox
                checked={item.done}
                aria-label={`Done: ${item.text || "new item"}`}
                onCheckedChange={(v) => update(item.key, { done: v === true })}
              />
              <input
                ref={(el) => {
                  if (el) inputs.current.set(item.key, el);
                  else inputs.current.delete(item.key);
                }}
                value={item.text}
                maxLength={TEXT_MAX}
                aria-label={`Checklist item ${index + 1}`}
                aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                placeholder="Item"
                className={cn(
                  "h-7 min-w-0 flex-1 rounded-sm bg-transparent px-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  item.done && "text-text-muted line-through",
                )}
                onChange={(e) => update(item.key, { text: e.target.value }, TEXT_DELAY)}
                onKeyDown={(e) => onKeyDown(e, item, index)}
              />
              <button
                type="button"
                aria-label={`Delete item ${item.text || index + 1}`}
                className="flex size-6 shrink-0 items-center justify-center rounded-sm text-text-muted outline-none hover:bg-surface-hover hover:text-text-primary focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => remove(item.key, { undo: true, focusPrevious: false })}
              >
                <X size={12} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 justify-start gap-1 self-start px-2 text-text-muted"
        disabled={items.length >= CHECKLIST_MAX}
        onClick={() => insertAfter(itemsRef.current.length - 1)}
      >
        <Plus size={12} weight="bold" aria-hidden />
        Add item
      </Button>
    </div>
  );
}
