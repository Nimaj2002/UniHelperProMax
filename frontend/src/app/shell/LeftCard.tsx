import { CalendarBlank, SidebarSimple } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { PanelResizeHandle } from "@/components/PanelResizeHandle";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ShortcutKbd, useShortcut } from "@/lib/keymap";
import { readLocal, writeLocal } from "@/lib/storage";
import { cn } from "@/lib/utils";
import { AccountMenu } from "./AccountMenu";
import { Card } from "./Card";
import { CoursePanelSlot, CourseSearchSlot } from "./CoursePanelSlot";
import { LEFT_CARD_ID, useLayout } from "./layout";
import { MadeBy } from "./MadeBy";
import { CollapsibleSection, usePanelSectionSlot } from "./panelSection";
import { usePanelActions } from "./registry";

/** Share of an open section in the space it splits with the open section above it (%). */
const PAIR_MIN = 10;
const PAIR_MAX = 90;
const COURSES = { id: "courses", title: "Courses" };

/** The app mark: the app icon (icons/png/app-icon-192.png). */
export function AppMark() {
  return <img src="/app-icon-192.png" alt="" aria-hidden width={24} height={24} className="size-6 shrink-0" />;
}

function PanelActions({ slot, variant }: { slot: "courses-heading" | "footer"; variant: "full" | "icon" }) {
  const actions = usePanelActions(slot);
  return (
    <>
      {actions.map(({ id, component: C }) => (
        <C key={id} variant={variant} />
      ))}
    </>
  );
}

/**
 * Sections of the side panel: the courses, then the current page's sections. Open sections share
 * the card's height; the edge between two open sections resizes them.
 */
function Sections() {
  const { sections: pageSections, setTarget, collapsed, setCollapsed } = usePanelSectionSlot();
  const [weights, setWeights] = useState<Record<string, number>>(() => readLocal("uh.panel.sectionWeights", {}));
  useEffect(() => writeLocal("uh.panel.sectionWeights", weights), [weights]);
  // section elements, for live resizing; stable ref callbacks per section
  const [elements] = useState(() => new Map<string, HTMLElement>());
  const [refs] = useState(() => new Map<string, { section: (el: HTMLElement | null) => void; body: (el: HTMLDivElement | null) => void }>());
  const refsFor = (id: string) => {
    let r = refs.get(id);
    if (!r) {
      r = {
        section: (el) => void (el ? elements.set(id, el) : elements.delete(id)),
        body: (el) => setTarget(id, el),
      };
      refs.set(id, r);
    }
    return r;
  };
  const sections = [COURSES, ...pageSections];
  const weight = (id: string) => weights[id] ?? 1;
  let previousOpen: string | null = null;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {sections.map(({ id, title }, i) => {
        const isCollapsed = collapsed[id] ?? false;
        const above = isCollapsed ? null : previousOpen;
        if (!isCollapsed) previousOpen = id;
        const pair = () => weight(id) + (above ? weight(above) : 0);
        const share = above ? Math.round((100 * weight(id)) / pair()) : 0;
        const bodyId = `panel-section-${id}-body`;
        return (
          <CollapsibleSection
            key={id}
            id={id}
            title={title}
            collapsed={isCollapsed}
            onToggle={() => setCollapsed([id], !isCollapsed)}
            sectionRef={refsFor(id).section}
            bodyRef={id === COURSES.id ? undefined : refsFor(id).body}
            bodyClassName={id === COURSES.id ? "overflow-hidden" : "overflow-x-hidden overflow-y-auto"}
            actions={id === COURSES.id ? <PanelActions slot="courses-heading" variant="icon" /> : undefined}
            className={cn(i > 0 && "mt-1 border-t border-divider pt-1", isCollapsed && "shrink-0")}
            style={isCollapsed ? undefined : { flex: `${weight(id)} 1 0` }}
            handle={
              above && (
                <PanelResizeHandle
                  value={share}
                  min={PAIR_MIN}
                  max={PAIR_MAX}
                  defaultValue={50}
                  onResize={(p) => {
                    const total = pair();
                    setWeights((w) => ({ ...w, [id]: (total * p) / 100, [above]: (total * (100 - p)) / 100 }));
                  }}
                  onDrag={(p) => {
                    const total = pair();
                    elements.get(id)?.style.setProperty("flex-grow", String((total * p) / 100));
                    elements.get(above)?.style.setProperty("flex-grow", String((total * (100 - p)) / 100));
                  }}
                  grow="up"
                  step={5}
                  unitsPerPx={() => 100 / ((elements.get(id)?.clientHeight ?? 0) + (elements.get(above)?.clientHeight ?? 0) || 1)}
                  label={`Resize ${title.toLowerCase()}`}
                  controls={bodyId}
                  className="top-0"
                />
              )
            }
          >
            {id === COURSES.id && <CoursePanelSlot />}
          </CollapsibleSection>
        );
      })}
    </div>
  );
}

/**
 * The side panel card (008 FR-007): app name and close button, course search, courses with
 * "New class", the page's sections, and Account and Settings pinned to the bottom.
 */
export function LeftCard({ className, onNavigate }: { className?: string; onNavigate?: () => void }) {
  const { toggleLeft } = useLayout();
  const { aria } = useShortcut("shell.toggleSidePanel");
  return (
    <Card
      as="aside"
      id={LEFT_CARD_ID}
      label="Side panel"
      className={cn("h-full", className)}
      body="fill"
      header={
        <div className="flex shrink-0 items-center gap-2 px-3 pt-3 pb-2">
          <Link to="/" title="Go to home" className="flex min-w-0 items-center gap-2 rounded-md text-[15px] font-semibold tracking-tight" onClick={onNavigate}>
            <CalendarBlank size={18} className="shrink-0" aria-hidden />
            <span className="truncate">UniHelperProMax</span>
          </Link>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="ml-auto size-8" onClick={toggleLeft} aria-controls={LEFT_CARD_ID} aria-label="Hide side panel" aria-keyshortcuts={aria}>
                <SidebarSimple size={18} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Hide side panel <ShortcutKbd id="shell.toggleSidePanel" />
            </TooltipContent>
          </Tooltip>
        </div>
      }
      footer={
        <div className="flex shrink-0 flex-col gap-1 border-t border-divider px-2 py-2">
          <div className="flex items-center gap-1">
            <div className="min-w-0 flex-1">
              <AccountMenu variant="full" />
            </div>
            <PanelActions slot="footer" variant="full" />
          </div>
          <MadeBy variant="full" />
        </div>
      }
    >
      <div className="shrink-0 px-2 pb-2">
        <CourseSearchSlot />
      </div>
      <div
        className="flex min-h-0 flex-1 flex-col px-1"
        onClickCapture={(e) => {
          if (onNavigate && (e.target as HTMLElement).closest("a")) onNavigate();
        }}
      >
        <Sections />
      </div>
    </Card>
  );
}
