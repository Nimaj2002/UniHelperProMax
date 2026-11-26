/** 026: the Simple sidebar. General areas everywhere; inside a session it adds the session's sections and tools. */
import { SidebarSimple } from "@phosphor-icons/react";
import { useState } from "react";
import { Link, useLocation } from "react-router";
import { AccountMenu } from "@/app/shell/AccountMenu";
import { useLayout } from "@/app/shell/layout";
import { CollapsibleSection, usePanelSectionSlot } from "@/app/shell/panelSection";
import { usePanelActions } from "@/app/shell/registry";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { GENERAL_ENTRIES, isCurrent, SESSION_BACK_ENTRIES, type SidebarEntry } from "./sidebarModel";

const ITEM =
  "flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-sm text-left hover:bg-accent hover:text-foreground aria-[current=page]:bg-accent aria-[current=page]:font-medium";

function EntryLink({ entry, collapsed, onNavigate }: { entry: SidebarEntry; collapsed: boolean; onNavigate?: () => void }) {
  const { pathname } = useLocation();
  const Icon = entry.icon;
  const link = (
    <Link to={entry.to} aria-current={isCurrent(entry, pathname) ? "page" : undefined} aria-label={collapsed ? entry.label : undefined} className={cn(ITEM, collapsed && "justify-center px-0")} onClick={onNavigate}>
      <Icon size={18} aria-hidden className="shrink-0" />
      {!collapsed && <span className="truncate">{entry.label}</span>}
    </Link>
  );
  if (!collapsed) return link;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{entry.label}</TooltipContent>
    </Tooltip>
  );
}

/** The session's tools (Recordings, Chat, Teacher, Time), each opening in the main area: the items of the page's session panel rail. */
function SessionTools({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const { rightCard } = useLayout();
  const items = rightCard?.rail?.items ?? [];
  return (
    <ul className="grid gap-0.5">
      {items.map((item) => {
        const Icon = item.icon;
        const status = item.indicator && item.status ? `, ${item.status}` : "";
        return (
          <li key={item.id}>
            <button
              type="button"
              className={cn(ITEM, collapsed && "justify-center px-0")}
              aria-label={collapsed ? `${item.name}${status}` : undefined}
              onClick={() => {
                item.onActivate();
                onNavigate?.();
              }}
            >
              <span className="relative shrink-0">
                <Icon size={18} aria-hidden />
                {item.indicator && <span aria-hidden className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-primary" />}
              </span>
              {!collapsed && <span className="truncate">{item.name}</span>}
              {!collapsed && status && <span className="sr-only">{status}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** The page's own sections (Notes, Documents, course Tasks): portals the page fills, as in Ultimate's side panel. */
function SessionSections() {
  const { sections, setTarget, collapsed, setCollapsed } = usePanelSectionSlot();
  // one stable ref callback per section: a new function each render would detach and re-attach the ref forever
  const [refs] = useState(() => new Map<string, (el: HTMLDivElement | null) => void>());
  const refFor = (id: string) => {
    let r = refs.get(id);
    if (!r) {
      r = (el) => setTarget(id, el);
      refs.set(id, r);
    }
    return r;
  };
  return (
    <>
      {sections.map(({ id, title }) => (
        <CollapsibleSection
          key={id}
          id={id}
          title={title}
          collapsed={collapsed[id] ?? false}
          onToggle={() => setCollapsed([id], !(collapsed[id] ?? false))}
          bodyRef={refFor(id)}
          bodyClassName="max-h-72 overflow-x-hidden overflow-y-auto"
          className="mt-1 border-t border-divider pt-1"
        />
      ))}
    </>
  );
}

function Footer({ collapsed }: { collapsed: boolean }) {
  const actions = usePanelActions("footer");
  return (
    <div className={cn("flex shrink-0 items-center gap-1 border-t border-divider px-2 py-2", collapsed && "flex-col")}>
      <div className="min-w-0 flex-1">
        <AccountMenu variant={collapsed ? "icon" : "full"} />
      </div>
      {actions.map(({ id, component: C }) => (
        <C key={id} variant={collapsed ? "icon" : "full"} />
      ))}
    </div>
  );
}

interface Props {
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  /** The drawer closes after a choice. */
  onNavigate?: () => void;
}

export function SimpleSidebar({ collapsed = false, onToggleCollapsed, onNavigate }: Props) {
  const { rightCard } = useLayout();
  const { sections } = usePanelSectionSlot();
  const inSession = !!rightCard || sections.length > 0;
  const entries = inSession ? SESSION_BACK_ENTRIES : GENERAL_ENTRIES;
  return (
    <nav aria-label="Main" className="flex h-full min-h-0 flex-col">
      <div className={cn("flex shrink-0 items-center gap-2 px-3 pt-3 pb-2", collapsed && "justify-center px-1")}>
        {!collapsed && (
          <Link to="/" className="flex min-w-0 items-center gap-2 rounded-md text-[15px] font-semibold tracking-tight" onClick={onNavigate}>
            <img src="/app-icon-192.png" alt="" aria-hidden width={24} height={24} className="size-6 shrink-0" />
            <span className="truncate">UniHelperProMax</span>
          </Link>
        )}
        {onToggleCollapsed && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className={cn("size-8", !collapsed && "ml-auto")} onClick={onToggleCollapsed} aria-expanded={!collapsed} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
                <SidebarSimple size={18} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">{collapsed ? "Expand sidebar" : "Collapse sidebar"}</TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2">
        <ul className="grid gap-0.5">
          {entries.map((e) => (
            <li key={e.id}>
              <EntryLink entry={e} collapsed={collapsed} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>
        {inSession && (
          <>
            <div className="mt-0.5">
              <SessionTools collapsed={collapsed} onNavigate={onNavigate} />
            </div>
            {!collapsed && <SessionSections />}
          </>
        )}
      </div>
      <Footer collapsed={collapsed} />
    </nav>
  );
}
