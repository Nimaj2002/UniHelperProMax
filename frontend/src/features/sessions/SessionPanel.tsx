/**
 * The session panel (014 US2): the right card of session and event workspaces, with Recordings
 * above Chat. Each section collapses to its header, the boundary between them resizes them, and
 * the closed panel leaves a rail with an item per section. Its layout is a per-browser
 * convenience in localStorage (FR-009).
 */
import { ChatCircleText, SidebarSimple, Waveform } from "@phosphor-icons/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { RIGHT_CARD_ID, useLayout, type RailSpec } from "@/app/shell/layout";
import { CollapsibleSection } from "@/app/shell/panelSection";
import { useActivitySignals, type ActivitySignal } from "@/app/shell/registry";
import type { RailIndicator, SideRailItem } from "@/app/shell/SideRail";
import { RIGHT_DEFAULT } from "@/app/shell/widths";
import { PanelResizeHandle } from "@/components/PanelResizeHandle";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { readLocal, writeLocal } from "@/lib/storage";
import { cn } from "@/lib/utils";
import { useChatSection, useWorkspacePanels } from "./workspace-panels";

export type SessionSection = "recordings" | "chat";

export interface SessionPanelLayout {
  open: boolean;
  width: number;
  /** Shares of the panel's height while both sections are expanded. */
  weights: Record<SessionSection, number>;
  collapsed: Record<SessionSection, boolean>;
}

export const SESSION_PANEL_KEY = "uh.sessionPanel";
export const DEFAULT_SESSION_PANEL: SessionPanelLayout = {
  open: true,
  width: RIGHT_DEFAULT,
  weights: { recordings: 1, chat: 1 },
  collapsed: { recordings: false, chat: false },
};

const SECTIONS: Record<SessionSection, { id: string; title: string }> = {
  recordings: { id: "session-recordings", title: "Recordings" },
  chat: { id: "session-chat", title: "Chat" },
};
/** A section's smallest height: its 40 px header and 120 px of content (FR-003). */
const SECTION_MIN_PX = 160;

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fallback);

/** The stored layout, or null when there is none (a damaged value counts as its defaults). */
function readStored(): SessionPanelLayout | null {
  const raw = readLocal<Partial<SessionPanelLayout> | null>(SESSION_PANEL_KEY, null);
  if (!raw || typeof raw !== "object") return null;
  const d = DEFAULT_SESSION_PANEL;
  return {
    open: typeof raw.open === "boolean" ? raw.open : d.open,
    width: num(raw.width, d.width),
    weights: { recordings: num(raw.weights?.recordings, 1), chat: num(raw.weights?.chat, 1) },
    collapsed: { recordings: raw.collapsed?.recordings === true, chat: raw.collapsed?.chat === true },
  };
}

/**
 * The panel's layout state. Without a stored value it is seeded once from the account preference
 * the audio card used before (`workspaceRightCollapsed`, pass undefined while it loads); that
 * preference is never written again.
 */
export function useSessionPanelLayout(seedCollapsed: boolean | undefined) {
  // the stored layout, or (until the student changes it) the defaults seeded by the preference
  const [own, setOwn] = useState<SessionPanelLayout | null>(readStored);
  const layout = useMemo(
    () => own ?? (seedCollapsed === undefined ? DEFAULT_SESSION_PANEL : { ...DEFAULT_SESSION_PANEL, open: !seedCollapsed }),
    [own, seedCollapsed],
  );
  const settled = own !== null || seedCollapsed !== undefined;
  useEffect(() => {
    if (settled) writeLocal(SESSION_PANEL_KEY, layout);
  }, [settled, layout]);

  const update = useCallback(
    (f: (l: SessionPanelLayout) => SessionPanelLayout) => setOwn((o) => f(o ?? layout)),
    [layout],
  );
  const setOpen = useCallback((open: boolean) => update((l) => ({ ...l, open })), [update]);
  const setWidth = useCallback((width: number) => update((l) => ({ ...l, width })), [update]);
  /** The Recordings share of the height, in percent. */
  const setShare = useCallback((p: number) => update((l) => ({ ...l, weights: { recordings: p, chat: 100 - p } })), [update]);
  const setCollapsed = useCallback(
    (section: SessionSection, value: boolean) => update((l) => ({ ...l, collapsed: { ...l.collapsed, [section]: value } })),
    [update],
  );
  return { layout, setOpen, setWidth, setShare, setCollapsed };
}

/** Focus a section's header toggle once the panel shows it (after a rail item reopened it). */
function focusSectionHeader(section: SessionSection, frames = 20) {
  const el = document.querySelector<HTMLElement>(`#panel-section-${SECTIONS[section].id}-title button`);
  if (el) return el.focus();
  if (frames > 0) requestAnimationFrame(() => focusSectionHeader(section, frames - 1));
}

/** Runs one registered activity hook and reports its state (hooks can't run in a loop). */
function SignalWatch({ signal, onChange }: { signal: ActivitySignal; onChange: (id: string, active: boolean) => void }) {
  const active = signal.useActive();
  useEffect(() => {
    onChange(signal.id, active);
    return () => onChange(signal.id, false);
  }, [signal.id, active, onChange]);
  return null;
}

const isChatSignal = (s: ActivitySignal) => s.kind === "answer" || s.kind === "unseen" || s.id === "chat";
const INDICATOR: Record<ActivitySignal["kind"], RailIndicator> = { recording: "recording", transcription: "running", answer: "running", unseen: "unseen" };

/** One rail item's indicator: the most urgent active signal's shape, all their descriptions. */
function itemState(active: ActivitySignal[], order: ActivitySignal["kind"][]): Pick<SideRailItem, "indicator" | "status"> {
  if (!active.length) return {};
  const first = order.find((k) => active.some((s) => s.kind === k)) ?? active[0].kind;
  return { indicator: INDICATOR[first], status: active.map((s) => s.description).join(", ") };
}

/**
 * The closed panel's rail (FR-005, FR-006): Recordings shows a recording or transcription in
 * progress, Chat an answer being generated or a new one. Activating an item expands its section.
 * Render `watchers` anywhere in the page: they run the registered activity hooks.
 */
export function useSessionRail(expand: (section: SessionSection) => void): { rail: RailSpec; watchers: ReactNode } {
  const signals = useActivitySignals();
  const [running, setRunning] = useState<Record<string, boolean>>({});
  const onChange = useCallback((id: string, on: boolean) => setRunning((r) => (r[id] === on ? r : { ...r, [id]: on })), []);
  const active = signals.filter((s) => running[s.id]);
  const recordings = itemState(active.filter((s) => !isChatSignal(s)), ["recording", "transcription"]);
  const chat = itemState(active.filter(isChatSignal), ["answer", "unseen"]);
  const key = JSON.stringify([recordings, chat]);
  const rail = useMemo<RailSpec>(() => {
    const [rec, ch] = JSON.parse(key) as [typeof recordings, typeof chat];
    const item = (section: SessionSection, icon: SideRailItem["icon"], state: typeof rec): SideRailItem => ({
      id: section,
      icon,
      name: SECTIONS[section].title,
      ...state,
      onActivate: () => {
        expand(section);
        requestAnimationFrame(() => focusSectionHeader(section));
      },
    });
    return {
      label: "Session panel rail",
      reopenLabel: "Show session panel",
      items: [item("recordings", Waveform, rec), item("chat", ChatCircleText, ch)],
    };
  }, [key, expand]);
  const watchers = signals.map((s) => <SignalWatch key={s.id} signal={s} onChange={onChange} />);
  return { rail, watchers };
}

function CloseButton() {
  const { toggleRight } = useLayout();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8" onClick={toggleRight} aria-controls={RIGHT_CARD_ID} aria-label="Close session panel" aria-keyshortcuts="Alt+BracketRight">
          <SidebarSimple size={18} className="-scale-x-100" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        Close session panel <kbd className="ml-1 font-mono">Alt+]</kbd>
      </TooltipContent>
    </Tooltip>
  );
}

/** Everything the audio card showed before 014: the registered panels (feature 003 recordings). */
function RecordingsBody({ sessionKey }: { sessionKey: string }) {
  const panels = useWorkspacePanels();
  if (!panels.length)
    return (
      <section aria-label="Audio" className="grid gap-2 p-4">
        <p className="text-sm leading-relaxed text-muted-foreground">Recordings arrive in the next update.</p>
      </section>
    );
  return (
    <>
      {panels.map(({ id, title, component: P }) => (
        <section key={id} aria-label={title} className="min-h-0 min-w-0">
          <P sessionKey={sessionKey} />
        </section>
      ))}
    </>
  );
}

interface Props {
  sessionKey: string;
  layout: SessionPanelLayout;
  setShare: (percent: number) => void;
  setCollapsed: (section: SessionSection, value: boolean) => void;
}

/** The panel's body: Recordings and Chat with the boundary between them (FR-001–FR-004). */
export function SessionPanel({ sessionKey, layout, setShare, setCollapsed }: Props) {
  const panels = useWorkspacePanels();
  const chat = useChatSection();
  const { weights, collapsed } = layout;
  const both = !collapsed.recordings && !collapsed.chat;
  const stored = Math.round((100 * weights.recordings) / (weights.recordings + weights.chat));
  // the layout reaches this component through the shell one render late: quick arrow presses
  // build on the share just chosen, not on the one still on its way back
  const [pending, setPending] = useState<{ value: number; base: number } | null>(null);
  const share = pending && pending.base === stored ? pending.value : stored;
  const commitShare = (p: number) => {
    setPending({ value: p, base: stored });
    setShare(p);
  };

  // the sections' elements (live resizing) and the panel's height (each section's minimum share)
  const box = useRef<HTMLDivElement>(null);
  const recEl = useRef<HTMLElement>(null);
  const chatEl = useRef<HTMLElement>(null);
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    setHeight(el.clientHeight);
    const ro = new ResizeObserver(([e]) => setHeight(e.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const minShare = height > 0 ? Math.min(50, Math.max(10, Math.ceil((100 * SECTION_MIN_PX) / height))) : 10;

  const grow = (section: SessionSection) => (collapsed[section] ? undefined : { flex: `${both ? weights[section] : 1} 1 0` });
  const sectionClass = (section: SessionSection) => (collapsed[section] ? "shrink-0" : "min-h-[160px]");
  const header = "h-10 shrink-0 pl-1";
  const ChatBody = chat?.component;
  const ChatActions = chat?.headerActions;

  return (
    <div ref={box} className="flex min-h-0 flex-1 flex-col">
      <CollapsibleSection
        id={SECTIONS.recordings.id}
        title={SECTIONS.recordings.title}
        actionNames
        collapsed={collapsed.recordings}
        onToggle={() => setCollapsed("recordings", !collapsed.recordings)}
        sectionRef={recEl}
        headerClassName={header}
        bodyClassName="overflow-x-hidden overflow-y-auto border-t border-divider [scroll-padding-block:8px]"
        className={sectionClass("recordings")}
        style={grow("recordings")}
        actions={
          <>
            {panels.map(({ id, headerActions: Actions }) => Actions && <Actions key={id} sessionKey={sessionKey} />)}
            <CloseButton />
          </>
        }
      >
        <RecordingsBody sessionKey={sessionKey} />
      </CollapsibleSection>
      <CollapsibleSection
        id={SECTIONS.chat.id}
        title={SECTIONS.chat.title}
        actionNames
        collapsed={collapsed.chat}
        onToggle={() => setCollapsed("chat", !collapsed.chat)}
        sectionRef={chatEl}
        headerClassName={header}
        bodyClassName="flex flex-col overflow-hidden border-t border-divider"
        className={cn("border-t border-divider", sectionClass("chat"))}
        style={grow("chat")}
        actions={ChatActions && <ChatActions sessionKey={sessionKey} />}
        handle={
          both && (
            <PanelResizeHandle
              value={share}
              min={minShare}
              max={100 - minShare}
              defaultValue={50}
              onResize={commitShare}
              onDrag={(p) => {
                recEl.current?.style.setProperty("flex-grow", String(p));
                chatEl.current?.style.setProperty("flex-grow", String(100 - p));
              }}
              // the value is the Recordings share: dragging the boundary down makes it larger
              grow="down"
              step={5}
              unitsPerPx={() => 100 / ((recEl.current?.clientHeight ?? 0) + (chatEl.current?.clientHeight ?? 0) || 1)}
              label="Resize Recordings and Chat"
              controls={`panel-section-${SECTIONS.recordings.id}-body`}
              className="top-0"
            />
          )
        }
      >
        {ChatBody && <ChatBody sessionKey={sessionKey} />}
      </CollapsibleSection>
    </div>
  );
}
