/**
 * Card layout state (008 data-model): docked vs overlay mode, the left card's closed state, the
 * right card slot (the session workspace's session panel), the open overlay on narrow windows and
 * focus mode. Stored preferences describe the wide-window layout; overlay and focus mode never
 * write them.
 */
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { readLocal, writeLocal } from "@/lib/storage";
import { useMediaQuery, WIDE_QUERY } from "@/lib/useMediaQuery";
import type { SideRailItem } from "./SideRail";
import type { LayoutMode } from "./widths";

/** What a closed right card leaves on the window's edge (014 FR-005: the session panel rail). */
export interface RailSpec {
  /** The rail's landmark name, e.g. "Session panel rail". */
  label: string;
  /** The reopen button's name, e.g. "Show session panel". */
  reopenLabel: string;
  /** Each item reopens the card (the shell opens it after `onActivate`). */
  items: SideRailItem[];
}

/** A page's right card (shown while the page is mounted). */
export interface RightCard {
  /** The card's landmark name (also the overlay's title), e.g. "Session panel". */
  label: string;
  /** The overlay's description for assistive tech. */
  description?: string;
  /** Fixed header of the card (title, actions, close button); omitted when the body has its own. */
  header?: ReactNode;
  body: ReactNode;
  /** Remembered open state on wide windows (the page owns where it is stored). */
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Remembered width (the page owns where it is stored); without it the shell's default. */
  width?: number;
  setWidth?: (width: number) => void;
  /** Closed, the card leaves this rail instead of disappearing. */
  rail?: RailSpec;
}

export type Overlay = "none" | "left" | "right";

/** Controls that take focus when a card closes around the focused element (FR-038). */
export const SHOW_LEFT_ID = "show-side-panel";
export const SHOW_RIGHT_ID = "show-session-panel";
export const FOCUS_BUTTON_ID = "focus-mode-button";
export const LEFT_CARD_ID = "course-panel";
export const RIGHT_CARD_ID = "workspace-session-panel";

interface Layout {
  mode: LayoutMode;
  /** Left card closed to the rail (wide windows; the remembered state). */
  leftClosed: boolean;
  overlay: Overlay;
  setOverlay: (o: Overlay | ((prev: Overlay) => Overlay)) => void;
  focus: boolean;
  toggleFocus: () => void;
  /** The left card is on screen (docked and open, or open as an overlay). */
  leftVisible: boolean;
  toggleLeft: () => void;
  /** Opens the left card (e.g. before focusing the course search). */
  showLeft: () => void;
  rightCard: RightCard | null;
  setRightCard: (card: RightCard | null) => void;
  rightVisible: boolean;
  toggleRight: () => void;
  showRight: () => void;
  /** Shell side: whether the right card fits docked now (else it opens as an overlay, 014 FR-010). */
  setRightDockable: (fits: boolean) => void;
  /** The page lays out the main column itself (the home page's panels): no main card chrome. */
  bareMain: boolean;
  setBareMain: (bare: boolean) => void;
}

const LayoutContext = createContext<Layout | null>(null);

function within(id: string) {
  const el = document.getElementById(id);
  return !!el && el.contains(document.activeElement);
}

/**
 * After a card closes around the focused element, focus its reopen control (or the focus button).
 * The control may appear a few frames later (the rail mounts after the card unmounts), so this
 * waits up to ~20 frames for the focus to drop and the control to appear.
 */
function moveFocusAfterClose(fallbackIds: string[], frames = 20) {
  requestAnimationFrame(() => {
    const dropped = !document.activeElement || document.activeElement === document.body;
    const target = fallbackIds.map((id) => document.getElementById(id)).find(Boolean);
    if (dropped && target) return target.focus();
    if (frames > 0) moveFocusAfterClose(fallbackIds, frames - 1);
  });
}

export function LayoutProvider({ children }: { children: ReactNode }) {
  const mode: LayoutMode = useMediaQuery(WIDE_QUERY) ? "docked" : "overlay";
  const [leftClosed, setLeftClosed] = useState(() => readLocal("uh.panel.collapsed", false));
  // an overlay belongs to the narrow layout it was opened in: changing mode closes it (FR-030)
  const [opened, setOpened] = useState<{ overlay: Overlay; mode: LayoutMode }>({ overlay: "none", mode });
  const [focus, setFocus] = useState(false);
  const [rightCard, setRightCard] = useState<RightCard | null>(null);
  const [bareMain, setBareMain] = useState(false);
  const [rightDockable, setRightDockable] = useState(true);

  useEffect(() => writeLocal("uh.panel.collapsed", leftClosed), [leftClosed]);
  const raw = opened.mode === mode ? opened.overlay : "none";
  const docked = mode === "docked";
  // a right card docks when it fits; otherwise it opens over the main card like on narrow windows
  const rightDocks = docked && rightDockable;
  // the overlay of a card that no longer exists (or now fits docked) is closed
  const overlay: Overlay = raw === "right" && (!rightCard || rightDocks) ? "none" : raw;
  const setOverlay = useCallback(
    (o: Overlay | ((prev: Overlay) => Overlay)) =>
      setOpened((prev) => {
        const cur = prev.mode === mode ? prev.overlay : "none";
        return { overlay: typeof o === "function" ? o(cur) : o, mode };
      }),
    [mode],
  );

  const leftVisible = !focus && (docked ? !leftClosed : overlay === "left");
  const rightVisible = !!rightCard && !focus && (rightDocks ? rightCard.open : overlay === "right");

  const toggleFocus = useCallback(() => {
    if (!focus && (within(LEFT_CARD_ID) || within(RIGHT_CARD_ID))) moveFocusAfterClose([FOCUS_BUTTON_ID]);
    setFocus(!focus);
    setOverlay("none");
  }, [focus, setOverlay]);

  const toggleLeft = useCallback(() => {
    // in focus mode, leave it first (the cards come back), then toggle (contracts §6)
    if (focus) setFocus(false);
    if (!docked) return setOverlay((o) => (o === "left" ? "none" : "left"));
    if (!leftClosed && within(LEFT_CARD_ID)) moveFocusAfterClose([SHOW_LEFT_ID]);
    setLeftClosed((c) => !c);
  }, [docked, focus, leftClosed, setOverlay]);

  const showLeft = useCallback(() => {
    if (focus) setFocus(false);
    if (docked) setLeftClosed(false);
    else setOverlay("left");
  }, [docked, focus, setOverlay]);

  const toggleRight = useCallback(() => {
    if (!rightCard) return;
    if (focus) setFocus(false);
    if (!rightDocks) return setOverlay((o) => (o === "right" ? "none" : "right"));
    if (rightCard.open && within(RIGHT_CARD_ID)) moveFocusAfterClose([SHOW_RIGHT_ID, FOCUS_BUTTON_ID]);
    rightCard.setOpen(!rightCard.open);
  }, [rightDocks, focus, rightCard, setOverlay]);

  const showRight = useCallback(() => {
    if (!rightCard) return;
    if (focus) setFocus(false);
    if (!rightDocks) setOverlay("right");
    else if (!rightCard.open) rightCard.setOpen(true);
  }, [rightDocks, focus, rightCard, setOverlay]);

  const value = useMemo<Layout>(
    () => ({
      mode, leftClosed, overlay, setOverlay, focus, toggleFocus, leftVisible, toggleLeft, showLeft,
      rightCard, setRightCard, rightVisible, toggleRight, showRight, setRightDockable, bareMain, setBareMain,
    }),
    [mode, leftClosed, overlay, setOverlay, focus, toggleFocus, leftVisible, toggleLeft, showLeft, rightCard, rightVisible, toggleRight, showRight, bareMain],
  );
  return <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>;
}

const OUTSIDE: Layout = {
  mode: "docked",
  leftClosed: false,
  overlay: "none",
  setOverlay: () => {},
  focus: false,
  toggleFocus: () => {},
  leftVisible: false,
  toggleLeft: () => {},
  showLeft: () => {},
  rightCard: null,
  setRightCard: () => {},
  rightVisible: false,
  toggleRight: () => {},
  showRight: () => {},
  setRightDockable: () => {},
  bareMain: false,
  setBareMain: () => {},
};

/** The card layout; outside the shell (tests, auth pages) a no-op layout. */
export function useLayout(): Layout {
  return useContext(LayoutContext) ?? OUTSIDE;
}

/**
 * Page side: show this right card while the page is mounted (pass null for none). The card's
 * contents re-render with the page.
 */
export function useRightCard(card: RightCard | null) {
  const { setRightCard } = useLayout();
  useEffect(() => {
    setRightCard(card);
  }, [card, setRightCard]);
  useEffect(() => () => setRightCard(null), [setRightCard]);
}

/**
 * Page side: while the calling page is mounted the main column has no card chrome, so the page
 * can render its own cards in it (the home page's Calendar and Tasks panels, 012 R10).
 */
export function useBareMain() {
  const { setBareMain } = useLayout();
  useLayoutEffect(() => {
    setBareMain(true);
    return () => setBareMain(false);
  }, [setBareMain]);
}
