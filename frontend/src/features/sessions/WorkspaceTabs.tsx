import { CheckCircle, CircleNotch, Columns, FilePdf, WarningCircle, X } from "@phosphor-icons/react";
import { useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { getSaver, useSaveStatus, type SaveStatus } from "./autosave";
import { paneOf, same, tabKey, type Side, type TabRef, type WorkspaceTabs as TabsState } from "./tabState";

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

export const paneId = (side: Side) => `workspace-pane-${side}`;
export const tabDomId = (t: TabRef) => `tab-${t.id}`;

interface Props {
  state: TabsState;
  /** Display name of a tab, or undefined while its note/document is unknown (not shown). */
  titleOf: (t: TabRef) => string | undefined;
  /** Split view is offered (main area wide enough, 007 FR-014a). */
  splitAvailable: boolean;
  onSelect: (t: TabRef) => void;
  onClose: (t: TabRef) => void;
  onToggleSplit: () => void;
  onMoveToOtherPane: (t: TabRef) => void;
}

const SIDE_TEXT: Record<Side, { mark: string; sr: string }> = {
  left: { mark: "· L", sr: "shown in left pane" },
  right: { mark: "· R", sr: "shown in right pane" },
};

/**
 * The workspace's only tab bar (002 FR-017, 007 FR-011–FR-014): notes and documents side by
 * side; arrow keys move between tabs, Delete closes, the context menu (or Shift+F10) offers
 * "Show in other pane"; the split toggle sits at the end.
 */
export function WorkspaceTabs({ state, titleOf, splitAvailable, onSelect, onClose, onToggleSplit, onMoveToOtherPane }: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  const [menuFor, setMenuFor] = useState<TabRef | null>(null);
  const tabs = state.tabs.filter((t) => titleOf(t) !== undefined);
  const splitOn = splitAvailable && !!state.split?.enabled;
  const focusTab = (t: TabRef) =>
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-tab="${CSS.escape(tabKey(t))}"]`)?.focus());

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.findIndex((t) => same(t, state.active));
    const next = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : null;
    if (next === null || !tabs.length) return;
    e.preventDefault();
    const t = tabs[(next + tabs.length) % tabs.length];
    onSelect(t);
    focusTab(t);
  };

  if (!tabs.length) return null;
  return (
    <div className="flex min-w-0 flex-1 items-end">
      <div
        ref={listRef}
        role="tablist"
        aria-label="Open notes and documents"
        tabIndex={-1}
        onKeyDown={onKey}
        className="flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto border-b border-divider px-2 [scrollbar-width:thin]"
      >
        {tabs.map((t) => {
          const selected = same(t, state.active);
          const side = splitOn ? paneOf(state, t) : null;
          const name = titleOf(t)!;
          const openMenu = (e: MouseEvent | KeyboardEvent) => {
            e.preventDefault();
            setMenuFor(t);
          };
          return (
            <span key={tabKey(t)} className="relative flex shrink-0">
              <button
                type="button"
                role="tab"
                id={tabDomId(t)}
                data-tab={tabKey(t)}
                aria-selected={selected}
                aria-controls={paneId(side ?? "left")}
                aria-keyshortcuts="Delete Shift+F10"
                aria-haspopup="menu"
                tabIndex={selected ? 0 : -1}
                title={name}
                onClick={() => onSelect(t)}
                onContextMenu={openMenu}
                onKeyDown={(e) => {
                  if (e.key === "Delete") {
                    e.preventDefault();
                    onClose(t);
                  } else if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) openMenu(e);
                }}
                className={cn(
                  "group flex max-w-60 items-center gap-1 rounded-t-md border border-b-0 border-transparent py-1.5 pr-1 pl-3 text-left",
                  selected ? "border-divider bg-surface-elevated" : "hover:bg-accent",
                )}
              >
                {t.kind === "document" && <FilePdf size={16} aria-hidden className="shrink-0 text-muted-foreground" />}
                <span className="flex min-w-0 flex-col items-start">
                  <span className="flex max-w-48 items-baseline gap-1 text-sm">
                    <span className={cn("truncate", selected && "font-medium")}>{name}</span>
                    {side && (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        <span aria-hidden>{SIDE_TEXT[side].mark}</span>
                        <span className="sr-only">{SIDE_TEXT[side].sr}</span>
                      </span>
                    )}
                  </span>
                  {t.kind === "note" ? (
                    <StatusLabel noteId={t.id} className="text-[11px]" />
                  ) : (
                    <span className="text-[11px] text-muted-foreground">PDF</span>
                  )}
                </span>
                {/* pointer shortcut; keyboard users press Delete (or Alt+W) on the tab */}
                <span
                  aria-hidden
                  data-close-tab={t.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(t);
                  }}
                  className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                >
                  <X size={12} />
                </span>
              </button>
              <DropdownMenu open={same(menuFor, t)} onOpenChange={(o) => !o && setMenuFor(null)}>
                <DropdownMenuTrigger asChild>
                  <span aria-hidden tabIndex={-1} className="pointer-events-none absolute bottom-0 left-2 size-0" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" onCloseAutoFocus={(e) => (e.preventDefault(), focusTab(t))}>
                  {splitAvailable && <DropdownMenuItem onSelect={() => onMoveToOtherPane(t)}>Show in other pane</DropdownMenuItem>}
                  <DropdownMenuItem onSelect={() => onClose(t)}>Close tab</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </span>
          );
        })}
      </div>
      {splitAvailable && (
        <button
          type="button"
          aria-pressed={splitOn}
          aria-keyshortcuts="Alt+Backslash"
          title="Split view (Alt+\)"
          onClick={onToggleSplit}
          className={cn(
            "mb-1 ml-1 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2 text-sm",
            splitOn ? "border-primary bg-accent text-foreground" : "border-divider text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          <Columns size={16} aria-hidden />
          Split
        </button>
      )}
    </div>
  );
}
