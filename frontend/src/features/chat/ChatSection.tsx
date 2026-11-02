/**
 * 014 US3/US4: the Chat section of the session panel and the body shared with chat tabs. Views:
 * History (the session's chats and the new-chat box) and Conversation (one chat and its box).
 * The first send from History starts a chat and shows it; Back and "+" return to History without
 * stopping anything (FR-028). Without a usable model, it explains the setup and the box is
 * disabled (FR-022).
 */
import { ArrowLeft, ArrowsOut, MagnifyingGlass, Plus } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isApiError } from "@/lib/api";
import { ShortcutKbd, useShortcut } from "@/lib/keymap";
import { cn } from "@/lib/utils";
import {
  attachmentKey, chatKey, chatsOfSession, editTurn, isNewChatId, MAX_ATTACHMENTS, preflight, regenerate, sendMessage, startChat, updateChatFresh,
  useChat, useSelectVersion, type Chat, type ContextItem, type ContextItemRef, type ModelRef, type PreflightItem, type Unaccepted,
} from "./api";
import { AddToNoteDialog } from "./AddToNoteDialog";
import { AttachMenu } from "./AttachMenu";
import { CAP_MESSAGE, metaOf, rememberMeta, removeAttachment, updateAttachment } from "./attachments";
import { ContextList, OverLimitAlert, usePreflight } from "./ContextList";
import { ConversationView } from "./ConversationView";
import { PdfChoiceDialog, type PdfChoice } from "./PdfChoiceDialog";
import { HistoryView } from "./HistoryView";
import { MessageBox } from "./MessageBox";
import { ModelPicker } from "./ModelPicker";
import { hostOf, sameRef, useModels, type ModelChoice } from "./models";
import { PrivacyNotice } from "./PrivacyNotice";
import { getDraft, setDraft, useDraftAttachments } from "./drafts";
import { isActiveStatus, runStore, useChatGenerating } from "./runStore";
import {
  boxId, setPanelChat, setSearchOpen, useChatPlacement, useChatTabs, usePanelChat, useSearchOpen, type ChatView,
} from "./chatPlacement";

// ---- small header buttons ---------------------------------------------------------------------

/** `command`: a keymap command whose current key the button names (019). */
export function HeaderButton({ label, onClick, command, pressed, children }: { label: string; onClick: () => void; command?: string; pressed?: boolean; children: ReactNode }) {
  const { aria } = useShortcut(command ?? "");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8" aria-label={label} aria-keyshortcuts={aria} aria-pressed={pressed} onClick={onClick}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {label}
        {command && <ShortcutKbd id={command} />}
      </TooltipContent>
    </Tooltip>
  );
}

export const NewChatButton = ({ onClick }: { onClick: () => void }) => (
  <HeaderButton label="New chat" command="workspace.newChat" onClick={onClick}>
    <Plus size={18} aria-hidden />
  </HeaderButton>
);

export const ExpandButton = ({ onClick }: { onClick: () => void }) => (
  <HeaderButton label="Expand chat into a tab" onClick={onClick}>
    <ArrowsOut size={18} aria-hidden />
  </HeaderButton>
);

// ---- send refusals in plain language (FR-055, SC-009) ---------------------------------------------

/** What to tell the student when a send (or an edit) was refused; `exceeded` for the over-limit alert. */
function refusal(err: unknown, titleOf: (u: Unaccepted) => string): { notice?: string; exceeded?: boolean } {
  if (isApiError(err, "context_exceeded")) return { exceeded: true };
  if (isApiError(err, "too_many_attachments")) return { notice: CAP_MESSAGE };
  if (isApiError(err, "attachment_not_accepted")) {
    const list = (err.problem.unaccepted as Unaccepted[] | undefined) ?? [];
    const lines = list.map((u) => `${titleOf(u)}: ${u.reason ?? "not accepted by this model."}`);
    return { notice: lines.length ? `Not sent. ${lines.join(" ")}` : (err.detail ?? err.title) };
  }
  if (isApiError(err)) return { notice: err.detail ? `${err.title} ${err.detail}` : err.title };
  return { notice: "Couldn't send the message. Try again." };
}

// ---- new-chat model per session (until the first send saves it on the chat) ---------------------

const newChatModels = new Map<string, ModelRef>();

// ---- the shared body ------------------------------------------------------------------------------

export interface ChatBodyProps {
  sessionKey: string;
  /** "panel" or the tab's id: names the place's search state and message box. */
  place: { place: "panel" } | { place: "tab"; id: string };
  view: ChatView;
  /** The chat shown in Conversation (null or a `new:` id in History). */
  chatId: string | null;
  onOpen: (chatId: string) => void;
  onBack: () => void;
  onNewChat: () => void;
  /** The first send from History created this chat. */
  onStarted: (chatId: string) => void;
  /** Buttons at the end of the Conversation header (Expand in the panel, nothing in a tab). */
  conversationActions?: ReactNode;
  /** Whether History shows its search box. */
  searching: boolean;
  onCloseSearch: () => void;
  /** A chat was deleted from the history list. */
  onDeleted?: (chatId: string) => void;
}

function EmptySetup() {
  const navigate = useNavigate();
  return (
    <div className="grid flex-1 content-center justify-items-center gap-3 p-4 text-center">
      <p className="max-w-64 text-sm text-muted-foreground">
        To chat about this session, add an AI endpoint with at least one model in Settings → AI. A local server works without an internet
        connection.
      </p>
      <Button size="sm" onClick={() => navigate("/settings/ai")}>
        Open AI settings
      </Button>
    </div>
  );
}

export function ChatBody(props: ChatBodyProps) {
  const { sessionKey, place, view, chatId, onOpen, onBack, onNewChat, onStarted, conversationActions, searching, onCloseSearch, onDeleted } = props;
  const qc = useQueryClient();
  const models = useModels();
  const inTabs = useChatTabs(sessionKey);
  const conversation = view === "conversation" && !isNewChatId(chatId) ? chatId : null;
  const chat = useChat(conversation);
  const generating = useChatGenerating(conversation) && !!conversation;
  const { mutate: selectMutate } = useSelectVersion(conversation ?? "");
  const [notice, setNotice] = useState<string>();
  const [privacy, setPrivacy] = useState<{ choice: ModelChoice; text: string; attachments: ContextItemRef[] } | null>(null);
  const [, setNewModelTick] = useState(0);
  const [contextOpen, setContextOpen] = useState(false);
  const [exceeded, setExceeded] = useState(false);
  const [pdfChoice, setPdfChoice] = useState<(PdfChoice & { item: ContextItemRef }) | null>(null);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const draftAttachments = useDraftAttachments(sessionKey, conversation);

  const noModels = !models.loading && !models.choices.length;
  const textareaId = boxId(place);

  // the model: the chat's own, or (new chat) the one chosen here, else the last one used
  const data = chat.data;
  const chatModel = data ? models.find(data.model) : undefined;
  const newModel = models.find(newChatModels.get(sessionKey)) ?? models.fallback;
  const current: ModelChoice | undefined = conversation ? chatModel : newModel;
  const missingLabel = conversation && data && !chatModel ? data.modelLabel || undefined : undefined;

  // ---- context and preflight (US9) ---------------------------------------------------------------
  const context = data?.context;
  useEffect(() => {
    if (context?.length) rememberMeta(context);
  }, [context]);
  const contextSig = (context ?? []).map((c) => `${attachmentKey(c)}:${c.pdfMode ?? ""}:${c.available}`).join(",");
  const pre = usePreflight({ sessionKey, chatId: conversation, model: current?.ref, attachments: draftAttachments, contextSig });
  const result = current ? pre.data : undefined;
  const overLimit = !!result?.overLimit || exceeded;
  useEffect(() => {
    // a fresh estimate decides again (the 409 only holds until something changes)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on new preflight data
    setExceeded(false);
  }, [pre.data]);
  const titleOf = useCallback(
    (u: Pick<ContextItemRef, "kind" | "ref">) =>
      metaOf(u)?.title ?? pre.data?.items.find((i) => attachmentKey(i) === attachmentKey(u))?.title ?? u.kind,
    [pre.data],
  );

  /** Items this model can't take (for the model picker's warning), from a preflight with it. */
  const checkModel = useCallback(
    async (ref: ModelRef): Promise<ContextItem[]> => {
      try {
        const res = await preflight({ sessionKey, chatId: conversation, model: ref, text: "", attachments: getDraft(sessionKey, conversation).attachments });
        return res.items.filter((i) => i.available && !i.accepted);
      } catch {
        return [];
      }
    },
    [sessionKey, conversation],
  );

  const removeItem = useCallback(
    (item: Pick<ContextItemRef, "kind" | "ref">) => {
      const key = attachmentKey(item);
      if (getDraft(sessionKey, conversation).attachments.some((a) => attachmentKey(a) === key)) removeAttachment(sessionKey, conversation, item);
      const c = conversation ? qc.getQueryData<Chat>(chatKey(conversation)) : undefined;
      if (c?.context.some((x) => attachmentKey(x) === key)) {
        const keep = c.context.filter((x) => attachmentKey(x) !== key).map(({ kind, ref, pdfMode }) => ({ kind, ref, pdfMode }));
        void updateChatFresh(c.id, c.version, { context: keep }).then(
          (next) => qc.setQueryData(chatKey(c.id), next),
          () => setNotice("Couldn't remove it from the context. Try again."),
        );
      }
    },
    [sessionKey, conversation, qc],
  );

  // FR-053: a PDF for a model without PDF support — offer its text, or say it has none
  const seen = useRef<Set<string> | null>(null);
  const attachedSig = draftAttachments.map(attachmentKey).join(",");
  useEffect(() => {
    const now = getDraft(sessionKey, conversation).attachments;
    const before = seen.current;
    seen.current = new Set(now.map(attachmentKey));
    if (!before || !current || current.model.capabilities.pdf) return;
    const fresh = now.filter(
      (a) => !before.has(attachmentKey(a)) && a.pdfMode !== "text" && (a.kind === "document" || (a.kind === "upload" && metaOf(a)?.mime === "application/pdf")),
    );
    const first = fresh[0];
    if (!first) return;
    void preflight({ sessionKey, chatId: conversation, model: current.ref, text: "", attachments: [first] }).then(
      (res) => {
        const item = res.items.find((i) => attachmentKey(i) === attachmentKey(first));
        if (item && (item.reasonCode === "no_pdf" || item.reasonCode === "no_text"))
          setPdfChoice({ item: first, title: item.title, model: current.model.displayName, hasText: item.reasonCode === "no_pdf" && item.textFallbackAvailable });
        else if (item?.reasonCode === "encrypted") setNotice(`${item.title}: ${item.reason ?? "This PDF is encrypted."}`);
      },
      () => {},
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- when the draft's attachments change
  }, [attachedSig, sessionKey, conversation]);

  const chooseModel = useCallback(
    (ref: ModelRef) => {
      if (!conversation) {
        newChatModels.set(sessionKey, ref);
        setNewModelTick((n) => n + 1);
        return;
      }
      const c = qc.getQueryData<Chat>(chatKey(conversation));
      if (!c || sameRef(c.model, ref)) return;
      void updateChatFresh(c.id, c.version, { model: ref }).then(
        (next) => qc.setQueryData(chatKey(c.id), next),
        () => {
          setNotice("Couldn't change the model. Try again.");
          void qc.invalidateQueries({ queryKey: chatKey(c.id) });
        },
      );
    },
    [conversation, qc, sessionKey],
  );

  const deliver = useCallback(
    async (choice: ModelChoice, text: string, attachments: ContextItemRef[]): Promise<boolean> => {
      setNotice(undefined);
      const body = { text, model: choice.ref, attachments };
      try {
        const res = conversation ? await sendMessage(conversation, body) : await startChat(sessionKey, body);
        runStore().track({ runId: res.runId, chatId: res.chat.id, sessionKey, answerId: res.answerId });
        void qc.invalidateQueries({ queryKey: chatKey(res.chat.id) });
        void qc.invalidateQueries({ queryKey: chatsOfSession(sessionKey) });
        if (!conversation) {
          newChatModels.delete(sessionKey);
          onStarted(res.chat.id);
        }
        return true;
      } catch (err) {
        if (isApiError(err, "privacy_ack_required")) {
          setPrivacy({ choice, text, attachments });
          void qc.invalidateQueries({ queryKey: ["ai-endpoints"] });
        } else {
          const r = refusal(err, titleOf);
          if (r.exceeded) setExceeded(true);
          setNotice(r.notice);
        }
        return false;
      }
    },
    [conversation, sessionKey, qc, onStarted, titleOf],
  );

  const onEdit = useCallback(
    async (turnId: string, text: string, attachments: ContextItemRef[]): Promise<boolean> => {
      if (!conversation) return false;
      if (!current) {
        setNotice("Choose a model for this chat first.");
        return false;
      }
      setNotice(undefined);
      try {
        const res = await editTurn(conversation, turnId, { text, model: current.ref, attachments: attachments.slice(0, MAX_ATTACHMENTS) });
        runStore().track({ runId: res.runId, chatId: conversation, sessionKey, answerId: res.answerId });
        void qc.invalidateQueries({ queryKey: chatKey(conversation) });
        void qc.invalidateQueries({ queryKey: chatsOfSession(sessionKey) });
        return true;
      } catch (err) {
        const r = refusal(err, titleOf);
        if (r.exceeded) setExceeded(true);
        setNotice(isApiError(err, "not_last_turn") ? "Only the last message can be edited." : r.notice);
        return false;
      }
    },
    [conversation, current, sessionKey, qc, titleOf],
  );

  /** FR-056 "Start a new chat": the draft's text and attachments move to the new-chat box. */
  const newChatWithDraft = useCallback(() => {
    const d = getDraft(sessionKey, conversation);
    if (conversation) {
      setDraft(sessionKey, null, { text: d.text, attachments: d.attachments }, 0);
      setDraft(sessionKey, conversation, { text: "", attachments: [] }, 0);
    }
    setExceeded(false);
    onNewChat();
  }, [sessionKey, conversation, onNewChat]);

  const send = useCallback(
    async (text: string, attachments: ContextItemRef[]) => {
      if (!current) {
        setNotice("Choose a model for this chat first.");
        return false;
      }
      // FR-040: say where messages go before the first one to a remote endpoint
      if (current.endpoint.locality === "remote" && !current.endpoint.privacyAcknowledged) {
        setPrivacy({ choice: current, text, attachments });
        return false;
      }
      return deliver(current, text, attachments);
    },
    [current, deliver],
  );

  const stop = useCallback(() => {
    const r = conversation ? runStore().ofChat(conversation) : undefined;
    if (r && isActiveStatus(r.status)) void runStore().stop(r.runId).catch(() => setNotice("Couldn't stop the answer."));
  }, [conversation]);

  const onRegenerate = useCallback(
    (turnId: string) => {
      if (!conversation) return;
      const model = qc.getQueryData<Chat>(chatKey(conversation))?.model ?? undefined;
      void regenerate(conversation, turnId, model ?? undefined).then(
        (res) => {
          runStore().track({ runId: res.runId, chatId: conversation, sessionKey, answerId: res.answerId });
          void qc.invalidateQueries({ queryKey: chatKey(conversation) });
        },
        (err) => setNotice(isApiError(err) ? err.title : "Couldn't regenerate the answer."),
      );
    },
    [conversation, qc, sessionKey],
  );

  const onSelect = useCallback(
    (turnId: string, version: number, answer: number) => selectMutate({ turnId, version, answer }, { onError: () => setNotice("Couldn't switch the version.") }),
    [selectMutate],
  );

  const hostFor = useCallback((label: string) => hostOf(models.endpointByName(label)?.baseUrl), [models]);
  const focusBox = () => document.getElementById(textareaId)?.focus();
  /** After a menu or popover closed: back to the box, unless the student already moved on to another one. */
  const focusBoxAfterClose = () =>
    requestAnimationFrame(() => {
      const a = document.activeElement;
      if (a && a !== document.body && a.closest("[data-radix-popper-content-wrapper],[role=dialog],[role=alertdialog],[aria-expanded=true]")) return;
      focusBox();
    });

  const box = (
    <MessageBox
      key={conversation ?? "new"}
      sessionKey={sessionKey}
      chatId={conversation}
      textareaId={textareaId}
      generating={generating}
      onSend={send}
      onStop={stop}
      disabled={noModels}
      notice={
        <>
          {overLimit && (
            <OverLimitAlert
              onRemoveItems={() => setContextOpen(true)}
              onNewChat={newChatWithDraft}
            />
          )}
          {notice && (
            <p role="alert" className="mb-1.5 px-1 text-xs text-danger">
              {notice}
            </p>
          )}
        </>
      }
      attach={<AttachMenu sessionKey={sessionKey} chatId={conversation} capabilities={current?.model.capabilities} disabled={noModels} onClosed={focusBoxAfterClose} />}
      model={
        <ModelPicker
          choices={models.choices}
          value={current}
          missingLabel={missingLabel}
          onChange={chooseModel}
          onClosed={focusBoxAfterClose}
          disabled={noModels}
          attachments={data?.context}
          check={checkModel}
          onRemoveAttachment={removeItem}
        />
      }
      context={
        <ContextList
          result={result}
          open={contextOpen}
          onOpenChange={setContextOpen}
          onRemove={(item: PreflightItem) => removeItem(item)}
          onClosed={focusBoxAfterClose}
        />
      }
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {conversation ? (
        <>
          <div className="flex h-10 shrink-0 items-center gap-1 border-b border-divider px-1">
            <HeaderButton label="Back to history" onClick={onBack}>
              <ArrowLeft size={18} aria-hidden />
            </HeaderButton>
            <h3 className="min-w-0 flex-1 truncate text-sm font-medium" title={data?.title}>
              {data?.title ?? "Chat"}
            </h3>
            <NewChatButton onClick={onNewChat} />
            {conversationActions}
          </div>
          {data ? (
            <ConversationView
              key={data.id}
              sessionKey={sessionKey}
              chat={data}
              busy={generating}
              hostFor={hostFor}
              onSelect={onSelect}
              onRegenerate={onRegenerate}
              onEdit={onEdit}
              onAddToNote={setAddingTo}
            />
          ) : chat.isError ? (
            <div className="grid flex-1 content-center justify-items-center gap-2 p-4 text-center">
              <p role="alert" className="text-sm text-danger">
                {isApiError(chat.error) && chat.error.status === 404 ? "This chat no longer exists." : "Couldn't open this chat."}
              </p>
              <Button size="sm" variant="outline" onClick={onBack}>
                Back to history
              </Button>
            </div>
          ) : (
            <p className="flex-1 p-4 text-sm text-muted-foreground">Opening chat…</p>
          )}
        </>
      ) : noModels ? (
        <EmptySetup />
      ) : (
        <HistoryView sessionKey={sessionKey} searching={searching} onCloseSearch={onCloseSearch} onOpen={onOpen} inTabs={inTabs} onDeleted={onDeleted} />
      )}
      {box}
      {conversation && (
        <AddToNoteDialog
          sessionKey={sessionKey}
          chatId={conversation}
          answerId={addingTo}
          chatTitle={data?.title ?? "Chat"}
          onOpenChange={(o) => !o && setAddingTo(null)}
        />
      )}
      <PdfChoiceDialog
        choice={pdfChoice}
        onText={() => {
          if (pdfChoice) updateAttachment(sessionKey, conversation, { ...pdfChoice.item, pdfMode: "text" });
          setPdfChoice(null);
          focusBox();
        }}
        onRemove={() => {
          if (pdfChoice) removeAttachment(sessionKey, conversation, pdfChoice.item);
          setPdfChoice(null);
          focusBox();
        }}
        onKeep={() => setPdfChoice(null)}
      />
      <PrivacyNotice
        endpoint={privacy?.choice.endpoint ?? null}
        onCancel={() => {
          setPrivacy(null);
          focusBox();
        }}
        onConfirmed={() => {
          const p = privacy;
          setPrivacy(null);
          if (!p) return;
          void deliver({ ...p.choice, endpoint: { ...p.choice.endpoint, privacyAcknowledged: true } }, p.text, p.attachments).then((ok) => {
            if (ok && getDraft(sessionKey, conversation).text === p.text) setDraft(sessionKey, conversation, { text: "", attachments: [] }, 0);
            focusBox();
          });
        }}
      />
    </div>
  );
}

// ---- the session panel's Chat section ------------------------------------------------------------

const PANEL = { place: "panel" } as const;

/** The Chat section's header buttons in the History view: Search, New chat, Expand. */
export function ChatSectionActions({ sessionKey }: { sessionKey: string }) {
  const panel = usePanelChat(sessionKey);
  const searching = useSearchOpen("panel");
  const place = useChatPlacement(sessionKey);
  if (panel.view !== "history") return null;
  return (
    <>
      <HeaderButton label="Search chats" pressed={searching} onClick={() => setSearchOpen("panel", !searching)}>
        <MagnifyingGlass size={18} aria-hidden />
      </HeaderButton>
      <NewChatButton
        onClick={() => {
          setPanelChat(sessionKey, { chatId: null, view: "history" });
          setSearchOpen("panel", false);
          document.getElementById(boxId(PANEL))?.focus();
        }}
      />
      <ExpandButton onClick={() => place({ type: "expand" })} />
    </>
  );
}

/** The Chat section's body (registered into the session panel). */
export function ChatSection({ sessionKey }: { sessionKey: string }) {
  const panel = usePanelChat(sessionKey);
  const searching = useSearchOpen("panel");
  const place = useChatPlacement(sessionKey);
  const tabs = useChatTabs(sessionKey);
  // a chat open in a tab is never shown here too (FR-044)
  const view: ChatView = panel.view === "conversation" && panel.chatId && !tabs.includes(panel.chatId) ? "conversation" : "history";
  const toHistory = () => {
    setPanelChat(sessionKey, { chatId: null, view: "history" });
    requestAnimationFrame(() => document.getElementById(boxId(PANEL))?.focus());
  };
  return (
    <div className={cn("flex min-h-0 flex-1 flex-col")}>
      <ChatBody
        sessionKey={sessionKey}
        place={PANEL}
        view={view}
        chatId={view === "conversation" ? panel.chatId : null}
        onOpen={(id) => {
          setSearchOpen("panel", false);
          place({ type: "openFromHistory", chatId: id });
        }}
        onBack={toHistory}
        onNewChat={toHistory}
        onStarted={(id) => setPanelChat(sessionKey, { chatId: id, view: "conversation" })}
        conversationActions={<ExpandButton onClick={() => place({ type: "expand" })} />}
        searching={searching}
        onCloseSearch={() => setSearchOpen("panel", false)}
        onDeleted={(id) => place({ type: "retain", valid: (c) => c !== id })}
      />
    </div>
  );
}
