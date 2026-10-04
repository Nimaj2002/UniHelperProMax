import { CheckCircle, CircleNotch, WarningCircle, X } from "@phosphor-icons/react";
import { useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { getSaver, useSaveStatus, type SaveStatus } from "./autosave";
import type { NoteMeta } from "./api";

const STATUS: Record<SaveStatus, string> = {
  saved: "Saved",
  dirty: "Saving…",
  saving: "Saving…",
  error: "Not saved — retrying",
  conflict: "Conflict",
};

export function StatusLabel({ noteId, className }: { noteId: string; className?: string }) {
  const snap = useSaveStatus(getSaver(noteId));
  const status = snap?.status ?? "saved";
  const Icon = status === "saved" ? CheckCircle : status === "error" || status === "conflict" ? WarningCircle : CircleNotch;
  return (
    <span className={cn("inline-flex items-center gap-1", status === "error" || status === "conflict" ? "text-danger" : "text-muted-foreground", className)}>
      <Icon size={14} aria-hidden className={status === "saving" || status === "dirty" ? "animate-spin [animation-duration:1.5s]" : undefined} />
      {STATUS[status]}
    </span>
  );
}

interface Props {
  notes: NoteMeta[];
  openIds: string[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}

/** One tab per open note (FR-017); arrow keys move between tabs; status per tab (FR-018). */
export function NoteTabs({ notes, openIds, activeId, onSelect, onClose }: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  const byId = new Map(notes.map((n) => [n.id, n]));
  const tabs = openIds.map((id) => byId.get(id)).filter((n): n is NoteMeta => !!n);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.findIndex((t) => t.id === activeId);
    const next = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : null;
    if (next === null || !tabs.length) return;
    e.preventDefault();
    const t = tabs[(next + tabs.length) % tabs.length];
    onSelect(t.id);
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-tab="${CSS.escape(t.id)}"]`)?.focus());
  };

  if (!tabs.length) return null;
  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label="Open notes"
      tabIndex={-1}
      onKeyDown={onKey}
      className="flex min-w-0 items-end gap-0.5 overflow-x-auto border-b border-divider px-2 [scrollbar-width:thin]"
    >
      {tabs.map((t) => {
        const selected = t.id === activeId;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            data-tab={t.id}
            aria-selected={selected}
            aria-controls="note-editor-panel"
            aria-keyshortcuts="Delete"
            tabIndex={selected ? 0 : -1}
            title={t.name}
            onClick={() => onSelect(t.id)}
            onKeyDown={(e) => {
              if (e.key === "Delete") {
                e.preventDefault();
                onClose(t.id);
              }
            }}
            className={cn(
              "group flex max-w-60 shrink-0 items-center gap-1 rounded-t-md border border-b-0 border-transparent py-1.5 pr-1 pl-3 text-left",
              selected ? "border-divider bg-surface-elevated" : "hover:bg-accent",
            )}
          >
            <span className="flex min-w-0 flex-col items-start">
              <span className={cn("max-w-48 truncate text-sm", selected && "font-medium")}>{t.name}</span>
              <StatusLabel noteId={t.id} className="text-[11px]" />
            </span>
            {/* pointer shortcut; keyboard users press Delete (or Alt+W) on the tab */}
            <span
              aria-hidden
              data-close-tab={t.id}
              onClick={(e) => {
                e.stopPropagation();
                onClose(t.id);
              }}
              className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-surface-hover hover:text-foreground"
            >
              <X size={12} />
            </span>
          </button>
        );
      })}
    </div>
  );
}
