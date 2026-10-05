/**
 * Lets the active page show a section under the courses in the left panel (002 workspace:
 * the session's notes and sessions). The page renders its content into `target` with a portal,
 * so the content keeps living in the page's own React tree.
 */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

export interface PanelSection {
  title: string;
  collapsed: boolean;
  onToggle: () => void;
}

interface Ctx {
  section: PanelSection | null;
  setSection: (s: PanelSection | null) => void;
  target: HTMLElement | null;
  setTarget: (el: HTMLElement | null) => void;
  panelVisible: boolean;
  showPanel: () => void;
}

const PanelSectionContext = createContext<Ctx>({
  section: null,
  setSection: () => {},
  target: null,
  setTarget: () => {},
  panelVisible: false,
  showPanel: () => {},
});

export function PanelSectionProvider({ children, panelVisible, showPanel }: { children: ReactNode; panelVisible: boolean; showPanel: () => void }) {
  const [section, setSection] = useState<PanelSection | null>(null);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  return (
    <PanelSectionContext.Provider value={{ section, setSection, target, setTarget, panelVisible, showPanel }}>
      {children}
    </PanelSectionContext.Provider>
  );
}

/** Shell side: the registered section and the element to render it into. */
export function usePanelSectionSlot() {
  const { section, setTarget } = useContext(PanelSectionContext);
  return { section, setTarget };
}

/**
 * Page side: show a section (pass null to show none). Returns the portal target (null until
 * the shell has mounted it, or while the left panel is hidden) and the panel's visibility.
 */
export function usePanelSection(section: { title: string; collapsed: boolean; onToggle: () => void } | null) {
  const { setSection, target, panelVisible, showPanel } = useContext(PanelSectionContext);
  const toggle = useRef(section?.onToggle);
  useEffect(() => {
    toggle.current = section?.onToggle;
  });
  const title = section?.title ?? null;
  const collapsed = section?.collapsed ?? false;
  useEffect(() => {
    setSection(title === null ? null : { title, collapsed, onToggle: () => toggle.current?.() });
  }, [title, collapsed, setSection]);
  useEffect(() => () => setSection(null), [setSection]);
  return { target: title === null ? null : target, panelVisible, showPanel };
}
