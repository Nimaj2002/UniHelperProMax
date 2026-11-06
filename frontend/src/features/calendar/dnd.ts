import { useSyncExternalStore, type DragEvent } from "react";
import type { RecurrenceValue, WeekdayCode } from "@/features/classes/RecurrenceFields";
import { useRescheduleTask } from "@/features/tasks/api";
import { formatDay, formatHHmm } from "@/lib/dates";
import type { ColorKey } from "@/lib/palette";
import { HOUR_PX, SNAP_MIN } from "./draft";
import { useGuardedNavigate } from "./entryGuard";

/**
 * Calendar drag and drop (native HTML drag events), Google Calendar style: the browser's drag
 * image is hidden and the entry is drawn where it would land instead, snapped to the 15-minute
 * grid of the day under the pointer (`useDropPreview`). A class or event dropped on another
 * day/time opens its edit flow (scope dialog, then the form prefilled with the dropped date and
 * time); a task dropped there gets the new due date (and time).
 */
const TYPE = "application/x-unihelper-entry";
/** shortcut: tasks have only a due time, so they take a fixed 30-minute slot; use a real duration if tasks get one. */
export const TASK_MIN = 30;

type Dragged = { name: string; color: ColorKey; startMin: number; lengthMin: number } & (
  | { kind: "session"; key: string; date: string }
  | { kind: "task"; id: string; version: number; dueTime: string | null }
);
export type DragEntry = Dragged & { grabMin: number };

/** Where a dropped session lands; passed to `/sessions/:key/edit` as router state. */
export interface MoveTo {
  date: string;
  start: string;
  end: string;
}

// ---- the drag in progress and where it would land (read while dragging: dataTransfer is not) ----

/** The day under the pointer and, in the time grid, the snapped start minute (month: null). */
export interface DropPreview {
  entry: DragEntry;
  date: string;
  startMin: number | null;
}

let preview: DropPreview | null = null;
let dragging: DragEntry | null = null;
const listeners = new Set<() => void>();

function setPreview(next: DropPreview | null) {
  if (next?.date === preview?.date && next?.startMin === preview?.startMin && next?.entry === preview?.entry) return;
  preview = next;
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useDropPreview(): DropPreview | null {
  return useSyncExternalStore(subscribe, () => preview);
}

let blank: HTMLImageElement | null = null;

/** Start a drag; the grab point (in minutes) keeps the entry under the pointer where it lands. */
export function startDrag(e: DragEvent<HTMLElement>, entry: Dragged) {
  const grabMin = ((e.clientY - e.currentTarget.getBoundingClientRect().top) / HOUR_PX) * 60;
  dragging = { ...entry, grabMin };
  e.dataTransfer.setData(TYPE, JSON.stringify(dragging));
  e.dataTransfer.effectAllowed = "move";
  // no browser drag image: the snapped preview is the moving entry
  blank ??= Object.assign(new Image(), { src: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" });
  e.dataTransfer.setDragImage?.(blank, 0, 0);
  e.currentTarget.dataset.dragging = "";
}

/** dragend on the dragged entry (dropped or cancelled). */
export function endDrag(e: DragEvent<HTMLElement>) {
  delete e.currentTarget.dataset.dragging;
  dragging = null;
  setPreview(null);
}

/** dragenter/dragover on a day: accept calendar entries and move the preview there. `column` is the
 * time-grid day column (the drop sets the time too); without it (a month cell) the time is kept. */
export function dragOver(e: DragEvent<HTMLElement>, date: string, column?: HTMLElement) {
  if (!e.dataTransfer.types.includes(TYPE)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  if (!dragging) return;
  const startMin = column ? dropStartMin(e.clientY, column, dragging.grabMin, dragging.lengthMin) : null;
  setPreview({ entry: dragging, date, startMin });
}

function droppedEntry(e: DragEvent<HTMLElement>): DragEntry | null {
  const raw = e.dataTransfer.getData(TYPE);
  if (!raw) return null;
  e.preventDefault();
  return JSON.parse(raw) as DragEntry;
}

/** Start minute under the pointer in a time-grid day column, keeping the grab offset, snapped to
 * 15 minutes and ending before midnight (an end of 24:00 isn't a valid time). */
export function dropStartMin(clientY: number, column: HTMLElement, grabMin: number, lengthMin: number): number {
  const at = ((clientY - column.getBoundingClientRect().top) / HOUR_PX) * 60 - grabMin;
  const snapped = Math.round(at / SNAP_MIN) * SNAP_MIN;
  return Math.max(0, Math.min(snapped, 24 * 60 - SNAP_MIN - lengthMin));
}

/** drop handler for a day; lands exactly where the preview showed. */
export function useCalendarDrop() {
  const navigate = useGuardedNavigate();
  const reschedule = useRescheduleTask();
  return (e: DragEvent<HTMLElement>, date: string, column?: HTMLElement) => {
    const entry = droppedEntry(e);
    setPreview(null);
    if (!entry) return;
    const at = column ? dropStartMin(e.clientY, column, entry.grabMin, entry.lengthMin) : null;
    if (entry.kind === "task") {
      reschedule.mutate({ id: entry.id, version: entry.version, dueDate: date, dueTime: at === null ? entry.dueTime : formatHHmm(at) });
      return;
    }
    const start = at ?? entry.startMin;
    if (date === entry.date && start === entry.startMin) return;
    const moveTo: MoveTo = { date, start: formatHHmm(start), end: formatHHmm(start + entry.lengthMin) };
    navigate(`/sessions/${encodeURIComponent(entry.key)}/edit`, { state: { moveTo } });
  };
}

const weekday = (iso: string) => formatDay(iso, "EEEEEE").toUpperCase() as WeekdayCode;

/**
 * The edit form's starting values after a drop. "This" (or a one-off) takes the new date; a series
 * edit keeps its start date and moves the weekday instead (Monday → Friday in the repetition).
 */
export function applyMove<T extends { startDate: string; startTime: string; endTime: string; recurrence: RecurrenceValue }>(
  value: T, to: MoveTo | undefined, series: boolean,
): T {
  if (!to) return value;
  const moved = { ...value, startTime: to.start, endTime: to.end };
  if (!series) return { ...moved, startDate: to.date };
  const r = value.recurrence;
  const from = weekday(value.startDate);
  if (r.freq !== "weekly" || !r.byWeekday.includes(from)) return moved;
  const byWeekday = [...new Set(r.byWeekday.map((d) => (d === from ? weekday(to.date) : d)))];
  return { ...moved, recurrence: { ...r, byWeekday } };
}
