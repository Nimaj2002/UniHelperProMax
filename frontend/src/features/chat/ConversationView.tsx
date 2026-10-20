/**
 * 014 FR-027/FR-035/FR-070 (contracts/ui-contract.md "Conversation view"): one chat's messages
 * above the message box. Messages use `content-visibility: auto` and are memoised, so long chats
 * stay fast (SC-007); only the streaming answer re-renders. A long chat opens with its last
 * turns and mounts the earlier ones in small batches right after (plan.md Complexity Tracking),
 * so opening a 1,000-message chat takes no single long render. The view follows new text while the
 * reader is within 48 px of the bottom, else offers "Jump to latest". Screen readers hear only
 * "Answer started", "Answer complete", "Answer stopped" and "Answer failed: <category>". While it
 * is on screen, the chat's new answer counts as seen.
 */
import { ArrowDown } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { readLocal, writeLocal } from "@/lib/storage";
import { chatsOfSession, markSeen, type Answer, type Chat, type ContextItemRef, type Turn } from "./api";
import { AnswerView, type AnswerShown } from "./AnswerView";
import { isActiveStatus, runStore, useRun } from "./runStore";
import { UserMessage } from "./UserMessage";

export const FOLLOW_PX = 48;
/** Turns rendered at once when a chat opens, and per batch after that. */
export const FIRST_TURNS = 30;
export const TURN_BATCH = 25;
export const scrollKey = (chatId: string) => `uh.chat.scroll.${chatId}`;

const ITEM_STYLE = { contentVisibility: "auto", containIntrinsicSize: "auto 120px" } as const;

interface AnswerItemProps {
  sessionKey: string;
  chatId: string;
  turn: Turn;
  answer: Answer;
  versionIndex: number;
  hostFor: (endpointLabel: string) => string | undefined;
  busy: boolean;
  onSelect: (turnId: string, version: number, answer: number) => void;
  onRegenerate: (turnId: string) => void;
  onAddToNote?: (answerId: string) => void;
}

/** The answer of a turn, live from the run store while it streams. */
const AnswerItem = memo(function AnswerItem({ sessionKey, chatId, turn, answer, versionIndex, hostFor, busy, onSelect, onRegenerate, onAddToNote }: AnswerItemProps) {
  const run = useRun(answer.runId);
  const saved = isActiveStatus(answer.status);
  // reattach to an answer still generating that this page doesn't follow yet (a reload)
  useEffect(() => {
    if (saved && answer.runId && !runStore().get(answer.runId))
      runStore().track({ runId: answer.runId, chatId, sessionKey, answerId: answer.id, status: answer.status });
  }, [saved, answer.runId, answer.id, answer.status, chatId, sessionKey]);
  const version = turn.versions[versionIndex];
  const live = saved && run;
  const shown: AnswerShown = live
    ? {
        text: run.text || answer.text,
        status: run.status,
        endpointLabel: run.endpointLabel ?? answer.endpointLabel,
        modelLabel: run.modelLabel ?? answer.modelLabel,
        locality: run.locality ?? answer.locality,
        usage: run.usage ?? answer.usage,
        error: run.error ?? answer.error,
      }
    : answer;
  const count = version.answers.length;
  const index = Math.min(version.selectedAnswer, count - 1);
  return (
    <div style={ITEM_STYLE}>
      <AnswerView
        answer={shown}
        host={hostFor(shown.endpointLabel)}
        busy={busy}
        onRegenerate={() => onRegenerate(turn.id)}
        onAddToNote={onAddToNote ? () => onAddToNote(answer.id) : undefined}
        version={count > 1 ? { index, count, onSelect: (i) => onSelect(turn.id, versionIndex, i) } : undefined}
      />
    </div>
  );
});

interface Props {
  sessionKey: string;
  chat: Chat;
  /** An answer is generating in this chat (Regenerate and version switches wait). */
  busy: boolean;
  hostFor: (endpointLabel: string) => string | undefined;
  onSelect: (turnId: string, version: number, answer: number) => void;
  onRegenerate: (turnId: string) => void;
  /** FR-059: edit and resend the last message. */
  onEdit?: (turnId: string, text: string, attachments: ContextItemRef[]) => Promise<boolean>;
  /** FR-058: append an answer to a note. */
  onAddToNote?: (answerId: string) => void;
}

/** "start" / terminal status of the chat's newest run, as one primitive (re-render on changes only). */
function phaseOf(chatId: string): string {
  const r = runStore().ofChat(chatId);
  return r ? `${r.runId}|${r.started ? "started" : "queued"}|${r.status}|${r.error?.category ?? ""}` : "";
}

function useRunPhase(chatId: string): string {
  return useSyncExternalStore(runStore().subscribe, () => phaseOf(chatId), () => "");
}

const ANNOUNCE: Record<string, (category: string) => string> = {
  completed: () => "Answer complete",
  stopped: () => "Answer stopped",
  failed: (c) => `Answer failed: ${c.replace(/_/g, " ")}`,
};

export const ConversationView = memo(function ConversationView({ sessionKey, chat, busy, hostFor, onSelect, onRegenerate, onEdit, onAddToNote }: Props) {
  const qc = useQueryClient();
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const [away, setAway] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const phase = useRunPhase(chat.id);
  const [onScreen, setOnScreen] = useState(true);
  // progressive mount (SC-007): the last turns first; all at once when a saved position needs them
  const [shownFrom, setShownFrom] = useState(() =>
    typeof readLocal<number | "bottom" | null>(scrollKey(chat.id), null) === "number" ? 0 : Math.max(0, chat.turns.length - FIRST_TURNS),
  );
  useEffect(() => {
    if (shownFrom <= 0) return;
    const t = setTimeout(() => setShownFrom((f) => Math.max(0, f - TURN_BATCH)), 0);
    return () => clearTimeout(t);
  }, [shownFrom]);
  const heightBefore = useRef(0);
  useLayoutEffect(() => {
    // earlier turns were added above: keep what the reader looks at in place (unless following)
    const el = scroller.current;
    if (!el) return;
    if (!follow.current && heightBefore.current) el.scrollTop += el.scrollHeight - heightBefore.current;
    heightBefore.current = el.scrollHeight;
  }, [shownFrom]);

  // ---- announcements (FR-070) ---------------------------------------------------------------
  useEffect(() => {
    const s = runStore();
    let prev = phaseOf(chat.id);
    return s.subscribe(() => {
      const next = phaseOf(chat.id);
      if (next === prev) return;
      const before = prev;
      prev = next;
      if (!next) return;
      const [runId, started, status, category] = next.split("|");
      const [prevRun, prevStarted, prevStatus] = before.split("|");
      const sameRun = runId === prevRun;
      if (isActiveStatus(status as Answer["status"])) {
        if (started === "started" && (!sameRun || prevStarted !== "started")) setAnnouncement("Answer started");
      } else if (!sameRun || prevStatus !== status) {
        const say = ANNOUNCE[status];
        if (say) setAnnouncement(say(category));
      }
    });
  }, [chat.id]);

  // ---- seen while on screen ------------------------------------------------------------------
  useEffect(() => {
    const el = scroller.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setOnScreen(e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!onScreen) return;
    const s = runStore();
    s.setVisible(chat.id, true);
    return () => s.setVisible(chat.id, false);
  }, [chat.id, onScreen]);
  const terminal = phase && !isActiveStatus(phase.split("|")[2] as Answer["status"]) ? phase : "";
  const unseen = chat.unseenAnswer;
  useEffect(() => {
    if (!onScreen) return;
    const send = () => {
      if (document.visibilityState !== "visible") return;
      void markSeen(chat.id).then(
        () => void qc.invalidateQueries({ queryKey: chatsOfSession(sessionKey) }),
        () => {},
      );
    };
    if (unseen || terminal) send();
    const onVisible = () => (unseen || terminal) && send();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [chat.id, onScreen, unseen, terminal, qc, sessionKey]);

  // ---- scrolling: restore, follow, remember --------------------------------------------------
  // where our own scroll to the bottom left the view: its scroll event isn't the reader moving away
  // (the content may have grown again before the event arrives)
  const autoTop = useRef<number | null>(null);
  const toBottom = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    autoTop.current = el.scrollTop;
  }, []);
  useLayoutEffect(() => {
    const saved = readLocal<number | "bottom" | null>(scrollKey(chat.id), null);
    const el = scroller.current;
    if (!el) return;
    if (typeof saved === "number") {
      el.scrollTop = saved;
      follow.current = el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_PX;
    } else {
      toBottom();
      follow.current = true;
    }
    setAway(!follow.current);
  }, [chat.id, toBottom]);
  useEffect(() => {
    const el = content.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (follow.current) toBottom();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [toBottom]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    if (follow.current && autoTop.current !== null && Math.abs(el.scrollTop - autoTop.current) < 2) return;
    autoTop.current = null;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_PX;
    follow.current = atBottom;
    setAway(!atBottom);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => writeLocal(scrollKey(chat.id), atBottom ? "bottom" : Math.round(el.scrollTop)), 150);
  };
  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-3 py-2 [overflow-anchor:none]">
        <div ref={content} role="log" aria-label="Conversation" aria-live="off" className="flex flex-col gap-4">
          {chat.turns.map((turn, ti) => {
            if (ti < shownFrom) return null;
            const vi = Math.min(turn.selected, turn.versions.length - 1);
            const version = turn.versions[vi];
            const answer = version.answers[Math.min(version.selectedAnswer, version.answers.length - 1)];
            return (
              <TurnItem
                key={turn.id}
                sessionKey={sessionKey}
                chatId={chat.id}
                turn={turn}
                versionIndex={vi}
                answer={answer}
                hostFor={hostFor}
                busy={busy}
                onSelect={onSelect}
                onRegenerate={onRegenerate}
                onEdit={ti === chat.turns.length - 1 ? onEdit : undefined}
                onAddToNote={onAddToNote}
              />
            );
          })}
        </div>
      </div>
      {away && (
        <button
          type="button"
          onClick={() => {
            follow.current = true;
            setAway(false);
            toBottom();
            writeLocal(scrollKey(chat.id), "bottom");
          }}
          className="absolute bottom-2 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 rounded-full border border-strong-border bg-surface-elevated px-3 py-1 text-xs font-medium shadow-[0_4px_12px_var(--shadow-tint)] hover:bg-surface-hover"
        >
          <ArrowDown size={12} aria-hidden /> Jump to latest
        </button>
      )}
      <div role="status" className="sr-only">
        {announcement}
      </div>
    </div>
  );
});

interface TurnItemProps extends Omit<AnswerItemProps, "answer"> {
  answer: Answer | undefined;
  onEdit?: Props["onEdit"];
}

const TurnItem = memo(function TurnItem({ turn, versionIndex, answer, onSelect, busy, onEdit, ...rest }: TurnItemProps) {
  const version = turn.versions[versionIndex];
  const edit = useCallback((text: string, attachments: ContextItemRef[]) => onEdit!(turn.id, text, attachments), [onEdit, turn.id]);
  return (
    <>
      <div style={ITEM_STYLE}>
        <UserMessage
          text={version.text}
          attachments={version.attachments}
          onEdit={onEdit ? edit : undefined}
          busy={busy}
          version={
            turn.versions.length > 1
              ? { index: versionIndex, count: turn.versions.length, disabled: busy, onSelect: (i) => onSelect(turn.id, i, turn.versions[i].selectedAnswer) }
              : undefined
          }
        />
      </div>
      {answer && <AnswerItem turn={turn} versionIndex={versionIndex} answer={answer} onSelect={onSelect} busy={busy} {...rest} />}
    </>
  );
});

