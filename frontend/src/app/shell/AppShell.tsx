import { SidebarSimple } from "@phosphor-icons/react";
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { Outlet } from "react-router";
import { PanelResizeHandle } from "@/components/PanelResizeHandle";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { hasModifier, isTypingTarget } from "@/lib/shortcuts";
import { readLocal, writeLocal } from "@/lib/storage";
import { cn } from "@/lib/utils";
import { ActivityPills } from "./ActivityPills";
import { Card } from "./Card";
import { LayoutProvider, LEFT_CARD_ID, RIGHT_CARD_ID, SHOW_LEFT_ID, SHOW_RIGHT_ID, useLayout, type RightCard } from "./layout";
import { LeftCard } from "./LeftCard";
import { CreditStrip } from "./MadeBy";
import { PanelSectionProvider } from "./panelSection";
import { Rail } from "./Rail";
import { useGlobalHosts } from "./registry";
import { SideRail } from "./SideRail";
import {
  clampLeft, clampRight, GAP, LEFT_DEFAULT, LEFT_MAX, LEFT_MIN, layoutWidths, RIGHT_DEFAULT, RIGHT_MAX, RIGHT_MIN,
} from "./widths";

const LEFT_WIDTH_KEY = "uh.panel.width";

function GlobalHosts() {
  const hosts = useGlobalHosts();
  return (
    <>
      {hosts.map(({ id, component: C }) => (
        <C key={id} />
      ))}
    </>
  );
}

function useViewportWidth() {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener("resize", onChange);
      return () => window.removeEventListener("resize", onChange);
    },
    () => window.innerWidth,
    () => 1366,
  );
}

/** Focus an element once it exists (e.g. the course search right after its card opens). */
function focusWhenMounted(id: string, frames = 12) {
  const el = document.getElementById(id);
  if (el) return el.focus();
  if (frames > 0) requestAnimationFrame(() => focusWhenMounted(id, frames - 1));
}

function RightCardView({ card, className }: { card: RightCard; className?: string }) {
  return (
    <Card as="aside" id={RIGHT_CARD_ID} label={card.label} header={card.header} body={card.header ? "scroll" : "fill"} className={cn("h-full", className)}>
      {card.body}
    </Card>
  );
}

/** The closed right card's rail (014 FR-005): reopen, then one item per section. */
function RightRail({ card, onOpen }: { card: RightCard; onOpen: () => void }) {
  const rail = card.rail!;
  return (
    <SideRail
      side="right"
      label={rail.label}
      reopen={{
        id: SHOW_RIGHT_ID,
        label: rail.reopenLabel,
        shortcut: "Alt+BracketRight",
        shortcutHint: "Alt+]",
        icon: SidebarSimple,
        mirrored: true,
        controls: RIGHT_CARD_ID,
        onActivate: onOpen,
      }}
      items={rail.items.map((item) => ({
        ...item,
        onActivate: () => {
          item.onActivate();
          onOpen();
        },
      }))}
    />
  );
}

/**
 * An opened overlay takes focus itself, not its first button (a focused button would open its
 * tooltip, and the first Escape would only close that tooltip). Closing returns focus to the
 * control that opened it, or to the card's opener button (FR-030, US7).
 */
let overlayOpener: HTMLElement | null = null;
const focusSheet = (e: Event) => {
  e.preventDefault();
  overlayOpener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
  (e.currentTarget as HTMLElement | null)?.focus();
};
const returnFocus = (fallbackId: string) => (e: Event) => {
  e.preventDefault();
  const target = overlayOpener?.isConnected ? overlayOpener : document.getElementById(fallbackId);
  overlayOpener = null;
  target?.focus();
};

/** Narrow windows: a side card floats over the main card (008 FR-030). */
const OVERLAY_CARD =
  "inset-y-2 h-auto max-w-none gap-0 border-0 bg-transparent p-0 shadow-xl sm:max-w-none data-[state=closed]:duration-200 data-[state=open]:duration-200";

function Shell() {
  const layout = useLayout();
  const { mode, focus, leftClosed, overlay, setOverlay, rightCard, toggleLeft, showLeft, showRight, toggleFocus, bareMain, setRightDockable, creditStrip } = layout;
  const viewport = useViewportWidth();
  const [leftWidth, setLeftWidth] = useState(() => clampLeft(readLocal(LEFT_WIDTH_KEY, LEFT_DEFAULT)));
  // the page remembers its right card's width (014: the session panel's layout); else the default
  const [ownRightWidth, setOwnRightWidth] = useState(RIGHT_DEFAULT);
  const rightWidth = rightCard?.width ?? ownRightWidth;
  const setRightWidth = rightCard?.setWidth ?? setOwnRightWidth;
  useEffect(() => writeLocal(LEFT_WIDTH_KEY, leftWidth), [leftWidth]);
  const grid = useRef<HTMLDivElement>(null);

  const widths = layoutWidths({
    viewport,
    mode,
    focus,
    leftClosed,
    leftWidth,
    rightPresent: !!rightCard,
    rightClosed: !rightCard?.open,
    rightWidth,
    rightHasRail: !!rightCard?.rail,
  });
  // a right card that doesn't fit docked opens over the main card (014 FR-010)
  useEffect(() => setRightDockable(widths.rightFits), [widths.rightFits, setRightDockable]);

  // the window never scrolls; each card scrolls its own content (FR-004)
  useEffect(() => {
    document.documentElement.dataset.shell = "";
    return () => {
      delete document.documentElement.dataset.shell;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (hasModifier(e) || isTypingTarget(e.target)) return;
      // "[" side panel (001 FR-023), "/" course search (FR-023), "\" focus mode (008 FR-024).
      // Bare "\" is free: split view is Alt+\ (useWorkspaceKeyboard), and the editor, PDF reader,
      // audio player and calendar keymaps don't bind it.
      if (e.key === "[") toggleLeft();
      else if (e.key === "\\") toggleFocus();
      else if (e.key === "/" && !document.getElementById("course-search")) {
        showLeft();
        focusWhenMounted("course-search");
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleLeft, toggleFocus, showLeft]);

  const resizing = (on: boolean) => {
    if (grid.current) grid.current.dataset.resizing = on ? "true" : "false";
  };
  const leftShown = widths.leftEff > 0;
  const rightShown = widths.rightEff > 0 && !!rightCard;
  const rightRail = rightShown && widths.rightRail && !!rightCard?.rail;
  const leftOpen = leftShown && !leftClosed;

  return (
    <PanelSectionProvider panelVisible={layout.leftVisible} showPanel={showLeft}>
      <div
        ref={grid}
        data-resizing="false"
        className="grid h-dvh overflow-hidden bg-surface p-2 transition-[grid-template-columns] duration-200 ease-out data-[resizing=true]:transition-none"
        style={
          {
            "--left-eff": `${widths.leftEff}px`,
            "--right-eff": `${widths.rightEff}px`,
            gridTemplateColumns: `calc(var(--left-eff) + ${leftShown ? GAP : 0}px) minmax(0,1fr) calc(var(--right-eff) + ${rightShown ? GAP : 0}px)`,
          } as CSSProperties
        }
      >
        <div className="relative min-h-0 min-w-0 overflow-hidden">
          {leftShown && (
            <div className="h-full" style={{ width: "var(--left-eff)" }}>
              {leftClosed ? <Rail /> : <LeftCard />}
            </div>
          )}
          {leftOpen && (
            <PanelResizeHandle
              value={clampLeft(leftWidth)}
              min={LEFT_MIN}
              max={LEFT_MAX}
              limit={() => widths.leftLimit}
              defaultValue={LEFT_DEFAULT}
              onResize={(w) => {
                resizing(false);
                setLeftWidth(w);
              }}
              onDrag={(w) => {
                resizing(true);
                grid.current?.style.setProperty("--left-eff", `${w}px`);
              }}
              grow="right"
              label="Resize course panel"
              controls={LEFT_CARD_ID}
              className="left-[calc(100%-4px)]"
            />
          )}
        </div>

        {/* the home page lays out its own cards here (bareMain): same tree, so the page keeps its state */}
        <div className="flex min-h-0 min-w-0 flex-col gap-2">
          <Card as="main" id="main" label="Workspace" body="fill" chrome={!bareMain} className="@container/main min-h-0 flex-1">
            <div className={cn("flex min-h-0 min-w-0 flex-1", bareMain ? "h-full flex-row gap-2" : "flex-col")}>
              <Outlet />
            </div>
            <ActivityPills />
          </Card>
          {/* Settings' credit bar: fixed height, as wide as the main card (useCreditStrip) */}
          {creditStrip && !focus && <CreditStrip />}
        </div>

        <div className="relative min-h-0 min-w-0 overflow-hidden">
          {rightRail && rightCard && (
            <div className="ml-auto h-full" style={{ width: "var(--right-eff)" }}>
              <RightRail card={rightCard} onOpen={showRight} />
            </div>
          )}
          {rightShown && !rightRail && rightCard && (
            <>
              <PanelResizeHandle
                value={clampRight(rightWidth, viewport)}
                min={RIGHT_MIN}
                max={RIGHT_MAX}
                limit={() => widths.rightLimit}
                defaultValue={RIGHT_DEFAULT}
                onResize={(w) => {
                  resizing(false);
                  setRightWidth(w);
                }}
                onDrag={(w) => {
                  resizing(true);
                  grid.current?.style.setProperty("--right-eff", `${w}px`);
                }}
                grow="left"
                label={`Resize ${rightCard.label.toLowerCase()}`}
                controls={RIGHT_CARD_ID}
                className="left-1"
              />
              <div className="ml-auto h-full" style={{ width: "var(--right-eff)" }}>
                <RightCardView card={rightCard} />
              </div>
            </>
          )}
        </div>
      </div>

      <GlobalHosts />

      {mode === "overlay" && (
        <>
          <Sheet open={overlay === "left"} onOpenChange={(o) => !o && setOverlay("none")}>
            <SheetContent side="left" showCloseButton={false} onOpenAutoFocus={focusSheet} onCloseAutoFocus={returnFocus(SHOW_LEFT_ID)} className={cn(OVERLAY_CARD, "left-2")} style={{ width: `min(${clampLeft(leftWidth)}px, calc(100vw - 1rem))` }}>
              <SheetTitle className="sr-only">Side panel</SheetTitle>
              <SheetDescription className="sr-only">Courses, sessions and notes</SheetDescription>
              <LeftCard onNavigate={() => setOverlay("none")} />
            </SheetContent>
          </Sheet>
        </>
      )}
      {/* narrow windows, or no room to dock it: the right card opens over the main card */}
      {rightCard && (
        <Sheet open={overlay === "right"} onOpenChange={(o) => !o && setOverlay("none")}>
          <SheetContent side="right" showCloseButton={false} onOpenAutoFocus={focusSheet} onCloseAutoFocus={returnFocus(SHOW_RIGHT_ID)} className={cn(OVERLAY_CARD, "right-2")} style={{ width: `min(${clampRight(rightWidth)}px, calc(100vw - 1rem))` }}>
            <SheetTitle className="sr-only">{rightCard.label}</SheetTitle>
            <SheetDescription className="sr-only">{rightCard.description ?? rightCard.label}</SheetDescription>
            <RightCardView card={rightCard} />
          </SheetContent>
        </Sheet>
      )}
    </PanelSectionProvider>
  );
}

/**
 * The app as floating cards on the theme's background (008): side panel | page | the page's right
 * card (the session panel, or its rail), with the page's activity floating over the main card.
 */
export function AppShell() {
  return (
    <LayoutProvider>
      <Shell />
    </LayoutProvider>
  );
}
