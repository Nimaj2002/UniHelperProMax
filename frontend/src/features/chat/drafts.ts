/**
 * 014 FR-032: the message box drafts of a session — one per chat plus the new-chat box — kept on
 * the server, so they survive view switches, tabs, sessions and restarts. Loaded once per session;
 * typing updates a module cache at once (every view of the chat shares it) and saves after 400 ms;
 * `pagehide` sends what is pending with `keepalive`.
 */
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { fetchDrafts, isNewChatId, putDraft, type ChatDraft, type ContextItemRef } from "./api";

export interface DraftValue {
  text: string;
  attachments: ContextItemRef[];
}

const EMPTY: DraftValue = { text: "", attachments: [] };
export const SAVE_DELAY_MS = 400;

interface SessionDrafts {
  load: Promise<void> | null;
  values: Map<string, DraftValue>;
  /** Keys changed here since the load started (they win over the loaded value). */
  touched: Set<string>;
}

const sessions = new Map<string, SessionDrafts>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingSaves = new Map<string, { sessionKey: string; draft: ChatDraft }>();
const inflight = new Map<string, Promise<unknown>>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

const keyOf = (chatId: string | null | undefined) => (isNewChatId(chatId) ? "" : chatId!);
const timerKey = (sessionKey: string, key: string) => `${sessionKey}\n${key}`;

function sessionOf(sessionKey: string): SessionDrafts {
  let s = sessions.get(sessionKey);
  if (!s) {
    s = { load: null, values: new Map(), touched: new Set() };
    sessions.set(sessionKey, s);
  }
  return s;
}

function ensureLoaded(sessionKey: string) {
  const s = sessionOf(sessionKey);
  s.load ??= fetchDrafts(sessionKey).then(
    (drafts) => {
      for (const d of drafts) {
        const key = keyOf(d.chatId);
        if (!s.touched.has(key)) s.values.set(key, { text: d.text, attachments: d.attachments ?? [] });
      }
      notify();
    },
    () => {
      s.load = null; // try again on the next mount
    },
  );
}

function save(sessionKey: string, key: string, keepalive = false) {
  const tk = timerKey(sessionKey, key);
  const t = timers.get(tk);
  if (t) clearTimeout(t);
  timers.delete(tk);
  const p = pendingSaves.get(tk);
  pendingSaves.delete(tk);
  if (!p) return;
  // one save at a time per draft: a clear racing an earlier save of the same draft confuses the server
  const send = () => putDraft(p.sessionKey, p.draft, keepalive).catch(() => {});
  const prev = inflight.get(tk);
  const next = keepalive || !prev ? send() : prev.then(send);
  inflight.set(tk, next);
  void next.finally(() => {
    if (inflight.get(tk) === next) inflight.delete(tk);
  });
}

export function setDraft(sessionKey: string, chatId: string | null, value: DraftValue, delay = SAVE_DELAY_MS) {
  const s = sessionOf(sessionKey);
  const key = keyOf(chatId);
  s.values.set(key, value);
  s.touched.add(key);
  notify();
  const tk = timerKey(sessionKey, key);
  pendingSaves.set(tk, { sessionKey, draft: { chatId: key || null, text: value.text, attachments: value.attachments } });
  const t = timers.get(tk);
  if (t) clearTimeout(t);
  if (delay <= 0) save(sessionKey, key);
  else timers.set(tk, setTimeout(() => save(sessionKey, key), delay));
}

export function getDraft(sessionKey: string, chatId: string | null): DraftValue {
  return sessions.get(sessionKey)?.values.get(keyOf(chatId)) ?? EMPTY;
}

/** Send every pending save now (the page is going away). */
export function flushDrafts(keepalive = true) {
  for (const tk of [...pendingSaves.keys()]) {
    const p = pendingSaves.get(tk)!;
    save(p.sessionKey, keyOf(p.draft.chatId), keepalive);
  }
}

let pagehideBound = false;
function bindPagehide() {
  if (pagehideBound || typeof window === "undefined") return;
  pagehideBound = true;
  window.addEventListener("pagehide", () => flushDrafts(true));
}

/** Tests: forget every draft. */
export function resetDrafts() {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  pendingSaves.clear();
  inflight.clear();
  sessions.clear();
  notify();
}

const subscribeDrafts = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** Only the draft's attachments: typing (which keeps the same array) doesn't re-render the caller. */
export function useDraftAttachments(sessionKey: string, chatId: string | null): ContextItemRef[] {
  useEffect(() => {
    bindPagehide();
    if (sessionKey) ensureLoaded(sessionKey);
  }, [sessionKey]);
  const get = () => getDraft(sessionKey, chatId).attachments;
  return useSyncExternalStore(subscribeDrafts, get, get);
}

export function useChatDraft(sessionKey: string, chatId: string | null) {
  useEffect(() => {
    bindPagehide();
    if (sessionKey) ensureLoaded(sessionKey);
  }, [sessionKey]);
  const value = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => getDraft(sessionKey, chatId),
    () => getDraft(sessionKey, chatId),
  );
  const setText = useCallback(
    (text: string) => setDraft(sessionKey, chatId, { ...getDraft(sessionKey, chatId), text }),
    [sessionKey, chatId],
  );
  const setAttachments = useCallback(
    (attachments: ContextItemRef[]) => setDraft(sessionKey, chatId, { ...getDraft(sessionKey, chatId), attachments }),
    [sessionKey, chatId],
  );
  /** After a send: the box is empty again (an empty draft is deleted on the server). */
  const clear = useCallback(() => setDraft(sessionKey, chatId, EMPTY, 0), [sessionKey, chatId]);
  return { ...value, setText, setAttachments, clear };
}
