/**
 * The left panel is a stack of collapsible sections: the shell's academic years (courses), and
 * under them the sections the active page adds (002 workspace: notes, documents, sessions). The
 * page renders each section's content into its `target` with a portal, so the content keeps
 * living in the page's own React tree.
 */
import { CaretDown } from "@phosphor-icons/react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type CSSProperties, type ReactNode, type Ref } from "react";
import { readLocal, writeLocal } from "@/lib/storage";
import { cn } from "@/lib/utils";

export interface PanelSection {
  id: string;
  title: string;
}

const COLLAPSED_KEY = "uh.panel.sectionsCollapsed";

interface Ctx {
  sections: PanelSection[];
  setSections: (s: PanelSection[]) => void;
  targets: Record<string, HTMLElement | null>;
  setTarget: (id: string, el: HTMLElement | null) => void;
  collapsed: Record<string, boolean>;
  setCollapsed: (ids: string[], value: boolean) => void;
  panelVisible: boolean;
  showPanel: () => void;
}

const PanelSectionContext = createContext<Ctx>({
  sections: [],
  setSections: () => {},
  targets: {},
  setTarget: () => {},
  collapsed: {},
  setCollapsed: () => {},
  panelVisible: false,
  showPanel: () => {},
});

export function PanelSectionProvider({ children, panelVisible, showPanel }: { children: ReactNode; panelVisible: boolean; showPanel: () => void }) {
  const [sections, setSections] = useState<PanelSection[]>([]);
  const [targets, setTargets] = useState<Record<string, HTMLElement | null>>({});
  const [collapsed, setCollapsedState] = useState<Record<string, boolean>>(() => readLocal(COLLAPSED_KEY, {}));
  useEffect(() => writeLocal(COLLAPSED_KEY, collapsed), [collapsed]);
  const setTarget = useCallback((id: string, el: HTMLElement | null) => setTargets((t) => (t[id] === el ? t : { ...t, [id]: el })), []);
  const setCollapsed = useCallback(
    (ids: string[], value: boolean) => setCollapsedState((c) => ({ ...c, ...Object.fromEntries(ids.map((id) => [id, value])) })),
    [],
  );
  const value = useMemo(
    () => ({ sections, setSections, targets, setTarget, collapsed, setCollapsed, panelVisible, showPanel }),
    [sections, targets, setTarget, collapsed, setCollapsed, panelVisible, showPanel],
  );
  return <PanelSectionContext.Provider value={value}>{children}</PanelSectionContext.Provider>;
}

/** Shell side: the page's sections, their collapsed state and where to render them. */
export function usePanelSectionSlot() {
  const { sections, setTarget, collapsed, setCollapsed } = useContext(PanelSectionContext);
  return { sections, setTarget, collapsed, setCollapsed };
}

/**
 * Page side: show these sections under the academic years (pass null to show none). Returns each
 * section's portal target (null until the shell has mounted it, or while the left panel is
 * hidden), the sections' collapsed state, and the panel's visibility.
 */
export function usePanelSections(sections: PanelSection[] | null) {
  const { setSections, targets, collapsed, setCollapsed, panelVisible, showPanel } = useContext(PanelSectionContext);
  const sig = sections ? JSON.stringify(sections.map((s) => [s.id, s.title])) : null;
  useEffect(() => {
    setSections(sig ? (JSON.parse(sig) as [string, string][]).map(([id, title]) => ({ id, title })) : []);
  }, [sig, setSections]);
  useEffect(() => () => setSections([]), [setSections]);
  return { targets: sig ? targets : {}, collapsed, setCollapsed, panelVisible, showPanel };
}

interface SectionProps {
  id: string;
  title: string;
  collapsed: boolean;
  onToggle: () => void;
  children?: ReactNode;
  /** The section's body (a portal target for a page's section). */
  bodyRef?: Ref<HTMLDivElement>;
  bodyClassName?: string;
  sectionRef?: Ref<HTMLElement>;
  style?: CSSProperties;
  /** A resize handle on the section's top edge. */
  handle?: ReactNode;
  /** Small buttons beside the heading (e.g. "New class" beside Courses). */
  actions?: ReactNode;
  className?: string;
  headerClassName?: string;
  /**
   * Name the toggle by its action ("Collapse Recordings" / "Expand Recordings", 014 session
   * panel). The section is then not a named region (its content names its own regions).
   */
  actionNames?: boolean;
}

/** One collapsible section of the left panel: a header that collapses and expands the body. */
export function CollapsibleSection({
  id, title, collapsed, onToggle, children, bodyRef, bodyClassName, sectionRef, style, handle, actions, className, headerClassName, actionNames,
}: SectionProps) {
  const headingId = `panel-section-${id}-title`;
  const bodyId = `panel-section-${id}-body`;
  return (
    <section
      ref={sectionRef}
      aria-labelledby={actionNames ? undefined : headingId}
      className={cn("relative flex min-h-0 flex-col", className)}
      style={style}
    >
      {handle}
      <div className={cn("flex items-center gap-1 pr-1", headerClassName)}>
        <h2 id={headingId} className="min-w-0 flex-1">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={!collapsed}
            aria-controls={bodyId}
            aria-label={actionNames ? `${collapsed ? "Expand" : "Collapse"} ${title}` : undefined}
            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[11px] font-semibold tracking-wide text-muted-foreground uppercase hover:bg-accent hover:text-foreground"
          >
            <CaretDown size={12} weight="bold" aria-hidden className={cn("transition-transform motion-reduce:transition-none", collapsed && "-rotate-90")} />
            {title}
          </button>
        </h2>
        {actions}
      </div>
      <div id={bodyId} ref={bodyRef} hidden={collapsed} className={cn("min-h-0 flex-1", bodyClassName)}>
        {children}
      </div>
    </section>
  );
}
