/**
 * The session panel (014 US2): the right card of session and event workspaces. Like the home
 * page's columns, a header card with a Recordings / Chat switch above one body card at a time;
 * the closed panel leaves a rail with an item per section. Its layout is a per-browser
 * convenience in localStorage (FR-009).
 */
import { ChatCircleText, SidebarSimple, Waveform } from "@phosphor-icons/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { RIGHT_CARD_ID, useLayout, type RailSpec } from "@/app/shell/layout";
import { Card } from "@/app/shell/Card";
import { useActivitySignals, type ActivitySignal } from "@/app/shell/registry";
import type { RailIndicator, SideRailItem } from "@/app/shell/SideRail";
import { RIGHT_DEFAULT } from "@/app/shell/widths";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ShortcutKbd, useShortcut } from "@/lib/keymap";
import { readLocal, writeLocal } from "@/lib/storage";
import { cn } from "@/lib/utils";
import { useChatSection, useWorkspacePanels } from "./workspace-panels";

export type SessionSection = "recordings" | "chat";

export interface SessionPanelLayout {
  open: boolean;
  width: number;
  /** The section shown; the other stays mounted but hidden (a recording or a draft survives). */
  section: SessionSection;
}

export const SESSION_PANEL_KEY = "uh.sessionPanel";
export const DEFAULT_SESSION_PANEL: SessionPanelLayout = {
  open: true,
  width: RIGHT_DEFAULT,
  section: "recordings",
};

const SECTIONS: Record<SessionSection, { id: string; title: string }> = {
  recordings: { id: "session-recordings", title: "Recordings" },
  chat: { id: "session-chat", title: "Chat" },
};

const num = (v: unknown, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fallback;

/** The stored layout, or null when there is none (a damaged value counts as its defaults). */
function readStored(): SessionPanelLayout | null {
  const raw = readLocal<Partial<SessionPanelLayout> | null>(
    SESSION_PANEL_KEY,
    null,
  );
  if (!raw || typeof raw !== "object") return null;
  const d = DEFAULT_SESSION_PANEL;
  return {
    open: typeof raw.open === "boolean" ? raw.open : d.open,
    width: num(raw.width, d.width),
    section: raw.section === "chat" ? "chat" : "recordings",
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
    () =>
      own ??
      (seedCollapsed === undefined
        ? DEFAULT_SESSION_PANEL
        : { ...DEFAULT_SESSION_PANEL, open: !seedCollapsed }),
    [own, seedCollapsed],
  );
  const settled = own !== null || seedCollapsed !== undefined;
  useEffect(() => {
    if (settled) writeLocal(SESSION_PANEL_KEY, layout);
  }, [settled, layout]);

  const update = useCallback(
    (f: (l: SessionPanelLayout) => SessionPanelLayout) =>
      setOwn((o) => f(o ?? layout)),
    [layout],
  );
  const setOpen = useCallback(
    (open: boolean) => update((l) => ({ ...l, open })),
    [update],
  );
  const setWidth = useCallback(
    (width: number) => update((l) => ({ ...l, width })),
    [update],
  );
  const setSection = useCallback(
    (section: SessionSection) => update((l) => ({ ...l, section })),
    [update],
  );
  return { layout, setOpen, setWidth, setSection };
}

/** The header switch's button for each section. */
export const SESSION_SWITCH_ID: Record<SessionSection, string> = {
  recordings: "session-switch-recordings",
  chat: "session-switch-chat",
};

/** Focus a section's switch button once the panel shows it (after a rail item reopened it). */
function focusSectionHeader(section: SessionSection, frames = 20) {
  const el = document.getElementById(SESSION_SWITCH_ID[section]);
  if (el) return el.focus();
  if (frames > 0)
    requestAnimationFrame(() => focusSectionHeader(section, frames - 1));
}

/** Runs one registered activity hook and reports its state (hooks can't run in a loop). */
function SignalWatch({
  signal,
  onChange,
}: {
  signal: ActivitySignal;
  onChange: (id: string, active: boolean) => void;
}) {
  const active = signal.useActive();
  useEffect(() => {
    onChange(signal.id, active);
    return () => onChange(signal.id, false);
  }, [signal.id, active, onChange]);
  return null;
}

const isChatSignal = (s: ActivitySignal) =>
  s.kind === "answer" || s.kind === "unseen" || s.id === "chat";
const INDICATOR: Record<ActivitySignal["kind"], RailIndicator> = {
  recording: "recording",
  transcription: "running",
  answer: "running",
  unseen: "unseen",
};

/** One rail item's indicator: the most urgent active signal's shape, all their descriptions. */
function itemState(
  active: ActivitySignal[],
  order: ActivitySignal["kind"][],
): Pick<SideRailItem, "indicator" | "status"> {
  if (!active.length) return {};
  const first =
    order.find((k) => active.some((s) => s.kind === k)) ?? active[0].kind;
  return {
    indicator: INDICATOR[first],
    status: active.map((s) => s.description).join(", "),
  };
}

/**
 * The closed panel's rail (FR-005, FR-006): Recordings shows a recording or transcription in
 * progress, Chat an answer being generated or a new one. Activating an item shows its section.
 * Render `watchers` anywhere in the page: they run the registered activity hooks.
 */
export function useSessionRail(expand: (section: SessionSection) => void): {
  rail: RailSpec;
  watchers: ReactNode;
} {
  const signals = useActivitySignals();
  const [running, setRunning] = useState<Record<string, boolean>>({});
  const onChange = useCallback(
    (id: string, on: boolean) =>
      setRunning((r) => (r[id] === on ? r : { ...r, [id]: on })),
    [],
  );
  const active = signals.filter((s) => running[s.id]);
  const recordings = itemState(
    active.filter((s) => !isChatSignal(s)),
    ["recording", "transcription"],
  );
  const chat = itemState(active.filter(isChatSignal), ["answer", "unseen"]);
  const key = JSON.stringify([recordings, chat]);
  const rail = useMemo<RailSpec>(() => {
    const [rec, ch] = JSON.parse(key) as [typeof recordings, typeof chat];
    const item = (
      section: SessionSection,
      icon: SideRailItem["icon"],
      state: typeof rec,
    ): SideRailItem => ({
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
      items: [
        item("recordings", Waveform, rec),
        item("chat", ChatCircleText, ch),
      ],
    };
  }, [key, expand]);
  const watchers = signals.map((s) => (
    <SignalWatch key={s.id} signal={s} onChange={onChange} />
  ));
  return { rail, watchers };
}

function CloseButton() {
  const { toggleRight } = useLayout();
  const { aria } = useShortcut("workspace.toggleRight");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          onClick={toggleRight}
          aria-controls={RIGHT_CARD_ID}
          aria-label="Close session panel"
          aria-keyshortcuts={aria}
        >
          <SidebarSimple size={18} className="-scale-x-100" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        Close session panel <ShortcutKbd id="workspace.toggleRight" />
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
        <p className="text-sm leading-relaxed text-muted-foreground">
          Recordings arrive in the next update.
        </p>
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
  setSection: (section: SessionSection) => void;
}

/** The panel's body: the header card with the switch, then Recordings or Chat (FR-001–FR-004). */
export function SessionPanel({ sessionKey, layout, setSection }: Props) {
  const panels = useWorkspacePanels();
  const chat = useChatSection();
  const { section } = layout;
  const shown = (s: SessionSection) => (section === s ? "contents" : "hidden");
  const ChatBody = chat?.component;
  const ChatActions = chat?.headerActions;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <Card className="shrink-0" body="fill">
        <div
          data-panel-header
          className="flex h-10 min-w-0 shrink-0 items-center gap-1 px-1.5"
        >
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={section}
            onValueChange={(v) => v && setSection(v as SessionSection)}
            aria-label="Recordings or chat"
            className="h-7 shrink-0"
          >
            <ToggleGroupItem
              id={SESSION_SWITCH_ID.recordings}
              value="recordings"
              aria-label="Recordings"
              title="Recordings"
              className="h-7 px-2"
            >
              <Waveform size={14} aria-hidden />
            </ToggleGroupItem>
            <ToggleGroupItem
              id={SESSION_SWITCH_ID.chat}
              value="chat"
              aria-label="Chat"
              title="Chat"
              className="h-7 px-2"
            >
              <ChatCircleText size={14} aria-hidden />
            </ToggleGroupItem>
          </ToggleGroup>
          <h2 className="min-w-0 flex-1 truncate px-1 text-sm font-semibold tracking-tight">
            {SECTIONS[section].title}
          </h2>
          {/* both sections' actions stay mounted, like their bodies */}
          <div className={shown("recordings")}>
            {panels.map(
              ({ id, headerActions: Actions }) =>
                Actions && <Actions key={id} sessionKey={sessionKey} />,
            )}
          </div>
          <div className={shown("chat")}>
            {ChatActions && <ChatActions sessionKey={sessionKey} />}
          </div>
          <CloseButton />
        </div>
      </Card>
      <Card
        as="section"
        id={SECTIONS.recordings.id}
        label={SECTIONS.recordings.title}
        className={cn("flex-1", section !== "recordings" && "hidden")}
        bodyClassName="overflow-x-hidden"
      >
        <RecordingsBody sessionKey={sessionKey} />
      </Card>
      <Card
        as="section"
        id={SECTIONS.chat.id}
        label={SECTIONS.chat.title}
        className={cn("flex-1", section !== "chat" && "hidden")}
        body="fill"
        bodyClassName="overflow-hidden"
      >
        {ChatBody && <ChatBody sessionKey={sessionKey} />}
      </Card>
    </div>
  );
}
