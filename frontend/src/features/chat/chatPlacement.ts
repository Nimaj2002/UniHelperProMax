/**
 * 014 US5 (research R13): where a session's chats show — the session panel's Chat section (its
 * state in localStorage `uh.chat.panel.<sessionKey>` = {chatId, view}) or a workspace chat tab
 * (`TabRef {kind:"chat", id}`). One reducer keeps the rule "a chat is in one place at a time":
 * Expand moves the panel's chat into a tab, choosing an "Open in tab" chat focuses its tab, Dock
 * moves it back, and closing a tab returns its chat to the history list. Moves never touch the
 * run store, so an answer keeps streaming through them (FR-045).
 */
import { useCallback, useSyncExternalStore } from "react";
import { useLayout } from "@/app/shell/layout";
import { readLocal, writeLocal } from "@/lib/storage";
import { isNewChatId, newChatId } from "./api";

export type ChatView = "history" | "conversation";
export interface PanelChat {
  /** The chat shown in the panel's Conversation view (null: the new-chat box). */
  chatId: string | null;
  view: ChatView;
}
export const HISTORY: PanelChat = { chatId: null, view: "history" };

export interface Placement {
  panel: PanelChat;
  /** Ids of the session's chat tabs (a `new:<uuid>` id for a chat not sent yet). */
  tabs: string[];
}

export type PlacementAction =
  | { type: "expand"; newId?: string }
  | { type: "openFromHistory"; chatId: string }
  | { type: "dock"; tabId: string }
  | { type: "closeTab"; tabId: string }
  | { type: "sent"; from: string; to: string }
  | { type: "retain"; valid: (chatId: string) => boolean };

export interface PlacementEffects {
  openTab?: string;
  focusTab?: string;
  closeTabs?: string[];
  replaceTab?: { from: string; to: string };
  closePanel?: boolean;
  openPanel?: boolean;
  /** Where the message box should take focus. */
  focus?: { place: "panel" } | { place: "tab"; id: string };
}

/** The panel never shows a chat that is open in a tab. */
function normalize(p: Placement): Placement {
  return p.panel.chatId && p.tabs.includes(p.panel.chatId) ? { ...p, panel: HISTORY } : p;
}

export function reducePlacement(state: Placement, action: PlacementAction): { state: Placement; effects: PlacementEffects } {
  const s = normalize(state);
  switch (action.type) {
    case "expand": {
      const id = s.panel.view === "conversation" && s.panel.chatId ? s.panel.chatId : (action.newId ?? newChatId());
      return {
        state: { panel: HISTORY, tabs: s.tabs.includes(id) ? s.tabs : [...s.tabs, id] },
        effects: { openTab: id, closePanel: true, focus: { place: "tab", id } },
      };
    }
    case "openFromHistory":
      if (s.tabs.includes(action.chatId)) return { state: s, effects: { focusTab: action.chatId, focus: { place: "tab", id: action.chatId } } };
      return { state: { ...s, panel: { chatId: action.chatId, view: "conversation" } }, effects: {} };
    case "dock": {
      const tabs = s.tabs.filter((t) => t !== action.tabId);
      const panel: PanelChat = isNewChatId(action.tabId) ? HISTORY : { chatId: action.tabId, view: "conversation" };
      return { state: { panel, tabs }, effects: { closeTabs: [action.tabId], openPanel: true, focus: { place: "panel" } } };
    }
    case "closeTab":
      // the chat goes back to the history list; its answer goes on (FR-045)
      return { state: { ...s, tabs: s.tabs.filter((t) => t !== action.tabId) }, effects: { closeTabs: [action.tabId] } };
    case "sent":
      return {
        state: normalize({ ...s, tabs: s.tabs.map((t) => (t === action.from ? action.to : t)) }),
        effects: { replaceTab: { from: action.from, to: action.to }, focus: { place: "tab", id: action.to } },
      };
    case "retain": {
      const dropped = s.tabs.filter((t) => !isNewChatId(t) && !action.valid(t));
      const panel = s.panel.chatId && !action.valid(s.panel.chatId) ? HISTORY : s.panel;
      if (!dropped.length && panel === s.panel) return { state: s, effects: {} };
      return { state: { panel, tabs: s.tabs.filter((t) => !dropped.includes(t)) }, effects: dropped.length ? { closeTabs: dropped } : {} };
    }
  }
}

// ---- the panel's chat per session (localStorage) -------------------------------------------------

export const panelKey = (sessionKey: string) => `uh.chat.panel.${sessionKey}`;
const panelState = new Map<string, PanelChat>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export function getPanelChat(sessionKey: string): PanelChat {
  let p = panelState.get(sessionKey);
  if (!p) {
    const raw = readLocal<Partial<PanelChat> | null>(panelKey(sessionKey), null);
    p =
      raw && typeof raw === "object" && (raw.view === "history" || raw.view === "conversation")
        ? { chatId: typeof raw.chatId === "string" && !isNewChatId(raw.chatId) ? raw.chatId : null, view: raw.view }
        : HISTORY;
    if (p.view === "conversation" && !p.chatId) p = HISTORY;
    panelState.set(sessionKey, p);
  }
  return p;
}

export function setPanelChat(sessionKey: string, next: PanelChat) {
  const cur = getPanelChat(sessionKey);
  if (cur.chatId === next.chatId && cur.view === next.view) return;
  panelState.set(sessionKey, next);
  writeLocal(panelKey(sessionKey), next);
  notify();
}

export function usePanelChat(sessionKey: string): PanelChat {
  return useSyncExternalStore(subscribe, () => getPanelChat(sessionKey), () => getPanelChat(sessionKey));
}

// ---- per-place UI state shared by a section's header and body (not kept) --------------------------

const searchOpen = new Map<string, boolean>();
export function setSearchOpen(place: string, open: boolean) {
  if ((searchOpen.get(place) ?? false) === open) return;
  searchOpen.set(place, open);
  notify();
}
export function useSearchOpen(place: string): boolean {
  return useSyncExternalStore(subscribe, () => searchOpen.get(place) ?? false, () => false);
}

// ---- the workspace's chat tabs (WorkspacePage provides them) -------------------------------------

export interface ChatTabsHost {
  sessionKey: string;
  tabs: string[];
  open: (id: string) => void;
  focus: (id: string) => void;
  close: (id: string) => void;
  replace: (from: string, to: string) => void;
  /** The note open in the workspace (the active note tab, else the last one), for "attach the open note". */
  openNoteId?: string | null;
}

let host: ChatTabsHost | null = null;
export function setChatTabsHost(h: ChatTabsHost | null) {
  host = h;
  notify();
}
const NO_TABS: string[] = [];
export function useChatTabs(sessionKey: string): string[] {
  return useSyncExternalStore(subscribe, () => (host?.sessionKey === sessionKey ? host.tabs : NO_TABS), () => NO_TABS);
}

/** The note open in the session's workspace (US6 "attach the open note"). */
export function useOpenNoteId(sessionKey: string): string | null {
  return useSyncExternalStore(subscribe, () => (host?.sessionKey === sessionKey ? (host.openNoteId ?? null) : null), () => null);
}

/** DOM id of a place's message box. */
export const boxId = (place: { place: "panel" } | { place: "tab"; id: string }) =>
  place.place === "panel" ? "chat-box-panel" : `chat-box-tab-${place.id}`;

/** Focus a message box once it exists (it may mount a few frames after a move). */
export function focusBox(place: { place: "panel" } | { place: "tab"; id: string }, frames = 30) {
  const el = document.getElementById(boxId(place));
  if (el && el.offsetParent !== null) return el.focus();
  if (frames > 0) requestAnimationFrame(() => focusBox(place, frames - 1));
  else el?.focus();
}

/** Apply placement actions for one session: the panel state, the tabs and the panel's visibility. */
export function useChatPlacement(sessionKey: string) {
  const layout = useLayout();
  return useCallback(
    (action: PlacementAction) => {
      const tabs = host?.sessionKey === sessionKey ? host.tabs : [];
      const { state, effects } = reducePlacement({ panel: getPanelChat(sessionKey), tabs }, action);
      setPanelChat(sessionKey, state.panel);
      const h = host?.sessionKey === sessionKey ? host : null;
      if (effects.closePanel) {
        if (layout.overlay === "right") layout.setOverlay("none");
        else layout.rightCard?.setOpen(false);
      }
      if (h) {
        if (effects.replaceTab) h.replace(effects.replaceTab.from, effects.replaceTab.to);
        effects.closeTabs?.forEach((id) => h.close(id));
        if (effects.openTab) h.open(effects.openTab);
        if (effects.focusTab) h.focus(effects.focusTab);
      }
      if (effects.openPanel) layout.showRight();
      if (effects.focus) {
        const f = effects.focus;
        requestAnimationFrame(() => focusBox(f));
      }
    },
    [sessionKey, layout],
  );
}
