/**
 * 014 wiring: the session panel's Chat section, the rail's chat indicators (an answer being
 * generated, a new answer) and the "Answering…" pill that stays visible in focus mode (FR-006,
 * FR-011), and the run store's link to the query cache.
 */
import { CircleNotch } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useParams } from "react-router";
import { registerActivity, registerActivitySignal, registerGlobalHost } from "@/app/shell/registry";
import { registerChatSection } from "@/features/sessions/workspace-panels";
import { chatsKey, listChats } from "./api";
import { ChatSection, ChatSectionActions } from "./ChatSection";
import { runStore, useGenerating, useUnseenHere } from "./runStore";

/** Links the run store to the query cache and reattaches to runs still generating. */
function ChatLifecycle() {
  const qc = useQueryClient();
  useEffect(() => {
    runStore().configure(qc);
    void runStore().attachActive();
    return () => runStore().configure(null);
  }, [qc]);
  return null;
}

/** "Answering…" over the main card while an answer is generated in the open session. */
function AnsweringPill() {
  const { sessionKey } = useParams();
  const generating = useGenerating(sessionKey);
  if (!sessionKey || !generating) return null;
  return (
    <section
      aria-label="Answering"
      className="pointer-events-auto flex items-center gap-2 rounded-full border border-strong-border bg-surface-elevated px-3 py-1 text-sm shadow-[0_6px_20px_var(--shadow-tint)]"
    >
      <CircleNotch size={14} aria-hidden className="animate-spin motion-reduce:animate-none" />
      <span className="font-medium">Answering…</span>
    </section>
  );
}

/** A chat of the open session has an answer nobody has seen yet. */
function useUnseenAnswer(): boolean {
  const { sessionKey = "" } = useParams();
  const local = useUnseenHere(sessionKey);
  const chats = useQuery({ queryKey: chatsKey(sessionKey), queryFn: () => listChats(sessionKey), enabled: !!sessionKey });
  return !!sessionKey && (local || !!chats.data?.some((c) => c.unseenAnswer && !runStore().isVisible(c.id)));
}

registerChatSection({ component: ChatSection, headerActions: ChatSectionActions });
registerActivity({ id: "chat-answering", component: AnsweringPill, priority: 5 });
registerActivitySignal({
  id: "chat",
  kind: "answer",
  description: "answer being generated",
  priority: 10,
  useActive: () => {
    const { sessionKey } = useParams();
    const generating = useGenerating(sessionKey);
    return !!sessionKey && generating;
  },
});
registerActivitySignal({ id: "chat-unseen", kind: "unseen", description: "new answer", priority: 11, useActive: useUnseenAnswer });
registerGlobalHost({ id: "chat-lifecycle", component: ChatLifecycle });

export const routes = [];
