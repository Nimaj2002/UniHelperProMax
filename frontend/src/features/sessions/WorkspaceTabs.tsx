import { ChatCircleText, CheckCircle, CircleNotch, Columns, FilePdf, WarningCircle, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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

/** A note's save state; `iconOnly` keeps the words for screen readers (the compact tab row). */
export function StatusLabel({ noteId, className, iconOnly = false }: { noteId: string; className?: string; iconOnly?: boolean }) {
  const snap = useSaveStatus(getSaver(noteId));
  const status = snap?.status ?? "saved";
  const Icon = status === "saved" ? CheckCircle : status === "error" || status === "conflict" ? WarningCircle : CircleNotch;
  return (
    <span className={cn("inline-flex items-center gap-1", status === "error" || status === "conflict" ? "text-danger" : "text-muted-foreground", className)}>
      <Icon size={iconOnly ? 12 : 14} aria-hidden className={status === "saving" || status === "dirty" ? "animate-spin [animation-duration:1.5s] motion-reduce:animate-none" : undefined} />
      <span className={iconOnly ? "sr-only" : undefined}>{STATUS[status]}</span>
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
  /** Controls between the tabs and the split toggle (Live/Raw, session chip). */
  actions?: ReactNode;
  /** Controls after the split toggle (audio reopen, focus mode). */
  end?: ReactNode;
  /** Controls before the tabs (side panel opener on narrow windows). */
  start?: ReactNode;
  /** Control right after the last tab (open a PDF or note). */
  add?: ReactNode;
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
export function WorkspaceTabs({ state, titleOf, splitAvailable, onSelect, onClose, onToggleSplit, onMoveToOtherPane, actions, end, start, add }: Props) {
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

  // the active tab stays in view when many tabs scroll sideways (008 edge case)
  const activeKey = state.active ? tabKey(state.active) : null;
  useEffect(() => {
    if (!activeKey) return;
    listRef.current?.querySelector<HTMLElement>(`[data-tab="${CSS.escape(activeKey)}"]`)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [activeKey, tabs.length]);

  // the main card's only fixed bar in the session workspace (008 FR-015): 40 px
  return (
    <div className="flex h-10 min-w-0 shrink-0 items-center gap-1 border-b border-divider px-1">
      {start}
      <div className="flex h-full min-w-0 flex-1 items-center gap-0.5">
      {tabs.length > 0 && (
      <div
        ref={listRef}
        role="tablist"
        aria-label="Open notes and documents"
        tabIndex={-1}
        onKeyDown={onKey}
        className="flex h-full min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
                  "group flex h-8 max-w-60 items-center gap-1.5 rounded-md pr-1 pl-2.5 text-left text-sm",
                  selected ? "bg-surface-sunken text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {t.kind === "document" && <FilePdf size={15} aria-hidden className="shrink-0" />}
                {t.kind === "chat" && <ChatCircleText size={15} aria-hidden className="shrink-0" />}
                <span className="flex min-w-0 max-w-48 items-baseline gap-1">
                  <span className={cn("truncate", selected && "font-medium")}>{name}</span>
                  {side && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      <span aria-hidden>{SIDE_TEXT[side].mark}</span>
                      <span className="sr-only">{SIDE_TEXT[side].sr}</span>
                    </span>
                  )}
                  {t.kind === "document" && <span className="sr-only">PDF</span>}
                </span>
                {t.kind === "note" && <StatusLabel noteId={t.id} iconOnly className="shrink-0" />}
                {/* pointer shortcut; keyboard users press Delete (or Alt+W) on the tab */}
                <span
                  aria-hidden
                  data-close-tab={t.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(t);
                  }}
                  className={cn(
                    "grid size-5 place-items-center rounded text-muted-foreground hover:bg-surface-sunken hover:text-foreground",
                    !selected && "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
                  )}
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
      )}
      {add}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {actions}
        {splitAvailable && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Split"
                aria-pressed={splitOn}
                aria-keyshortcuts="Alt+Backslash"
                onClick={onToggleSplit}
                className={cn(
                  "inline-flex size-8 shrink-0 items-center justify-center rounded-md",
                  splitOn ? "bg-surface-hover text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <Columns size={18} aria-hidden />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              Split view <kbd className="ml-1 font-mono">Alt+\</kbd>
            </TooltipContent>
          </Tooltip>
        )}
        {end}
      </div>
    </div>
  );
}
