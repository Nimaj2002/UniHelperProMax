/**
 * 022 US1–US7 (contracts/ui-contract.md "Teacher tab"): a lesson or practice chat in a workspace
 * tab — Questions | Teacher | Current question, resizable, with Plan, Ideas and Update graph in
 * the header. A `new:<kind>-…` tab has no chat yet; its first send starts one and the tab takes
 * the chat's id.
 */
import { ArrowsClockwise, Cards, ListBullets, Path } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PanelResizeHandle } from "@/components/PanelResizeHandle";
import { AttachMenu } from "@/features/chat/AttachMenu";
import { isApiError } from "@/lib/api";
import { MessageBox } from "@/features/chat/MessageBox";
import { ModelPicker } from "@/features/chat/ModelPicker";
import type { ModelChoice } from "@/features/chat/models";
import { useModels } from "@/features/chat/models";
import { PrivacyNotice } from "@/features/chat/PrivacyNotice";
import { isActiveStatus, runStore, useChatRun } from "@/features/chat/runStore";
import { searchIdeas, type Idea } from "@/features/graph/api";
import {
  askHint,
  disputeGrade,
  isNewTeacherId,
  kindOfNew,
  newDraftKey,
  putIdeaSet,
  requestGraphUpdate,
  retryMalformed,
  revealSolution,
  sendTeacherMessage,
  startTeacherChat,
  submitAnswers,
  teacherChatKey,
  teacherListKey,
  useTeacherChat,
  type AnswerInput,
  type ContextItemRef,
  type ModelRef,
  type Question,
  type SendResult,
} from "./api";
import { clearCard, type CardDraft } from "./cardDrafts";
import { CurrentQuestion } from "./CurrentQuestion";
import { IdeaSetPopover } from "./IdeaSetPopover";
import { PlanDialog } from "./PlanDialog";
import type { CardActions } from "./QuestionCard";
import { InquiriesColumn } from "./InquiriesColumn";
import { QuestionsColumn } from "./QuestionsColumn";
import { TeacherConversation } from "./TeacherConversation";
import { useTeacherTabsHost } from "./teacherTabs";

// widths are not remembered: closing a side column and opening it again restores its default
const LEFT = { min: 180, max: 600, def: 240 };
const RIGHT = { min: 280, max: 800, def: 360 };
/** Room the Teacher column always keeps, plus the 56 px questions menu. */
const MIDDLE_MIN = 320 + 56;
const GRAPH_TEXT: Record<string, string> = {
  pending: "Graph update pending",
  running: "Updating graph…",
  failed: "Graph not updated",
};

function useWindowWidth() {
  const [w, setW] = useState(() => (typeof window === "undefined" ? 1400 : window.innerWidth));
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return w;
}

const toInput = (q: Question, d: CardDraft): AnswerInput => ({
  questionId: q.id,
  ...(d.dontKnow ? { dontKnow: true } : q.kind === "choice" ? { choice: d.choice ?? 0 } : { text: d.text }),
  confidence: d.confidence,
  thinking: d.thinking,
});

export function TeacherTab({ sessionKey, tabId }: { sessionKey: string; tabId: string }) {
  const qc = useQueryClient();
  const { courseId = "" } = useParams();
  const host = useTeacherTabsHost();
  const models = useModels();
  const isNew = isNewTeacherId(tabId);
  const chatId = isNew ? null : tabId;
  const chat = useTeacherChat(chatId);
  const data = chat.data;
  const kind = data?.chat.kind ?? kindOfNew(tabId);
  const run = useChatRun(chatId);
  const busy = isActiveStatus(run?.status);

  const [chosen, setChosen] = useState<ModelRef | null>(null);
  const current: ModelChoice | undefined = models.find(chosen) ?? models.find(data?.model ?? null) ?? models.fallback;
  const [selected, setSelected] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [questionsShown, setQuestionsShown] = useState(() => window.innerWidth >= 1100);
  const [answersShown, setAnswersShown] = useState(true);
  const conversation = useRef<HTMLElement>(null);
  const [notice, setNotice] = useState<string>();
  type Call = (model: ModelRef) => Promise<SendResult>;
  const [privacy, setPrivacy] = useState<{ choice: ModelChoice; call: Call } | null>(null);
  const [topic, setTopic] = useState("");
  // a new chat outside a course (an event) starts from no ideas
  const [newIdeas, setNewIdeas] = useState<Idea[] | null>(() => (courseId ? null : []));
  const [announce, setAnnounce] = useState("");
  const [left, setLeft] = useState(LEFT.def);
  const [right, setRight] = useState(RIGHT.def);
  const columns = useRef<HTMLDivElement>(null);
  // a side column may grow only into what the Teacher column and the other side column leave free
  const room = (other: number) => (columns.current?.clientWidth ?? Infinity) - other - MIDDLE_MIN;
  const windowWidth = useWindowWidth();
  const stacked = windowWidth < 800;

  // the default idea set of a new chat: this course's most recently taught ideas (FR-017)
  useEffect(() => {
    if (!isNew || newIdeas !== null || !courseId) return;
    void searchIdeas({ courseId, sort: "recent", limit: 30 }).then(setNewIdeas, () => setNewIdeas([]));
  }, [isNew, newIdeas, courseId]);

  // "Question n asked" / "Answer graded" for screen readers
  const questions = data?.questions ?? [];
  const seenCount = useRef(questions.length);
  useEffect(() => {
    if (questions.length > seenCount.current) setAnnounce(`Question ${questions.length} asked`);
    seenCount.current = questions.length;
  }, [questions.length]);

  // FR-045 / the unseen indicator: this tab shows the chat
  useEffect(() => {
    if (!chatId) return;
    runStore().setVisible(chatId, true);
    return () => runStore().setVisible(chatId, false);
  }, [chatId]);

  const refresh = useCallback(
    (id: string) => {
      void qc.invalidateQueries({ queryKey: teacherChatKey(id) });
      void qc.invalidateQueries({ queryKey: teacherListKey(sessionKey) });
    },
    [qc, sessionKey],
  );

  /** Every action that starts a teacher reply: model checks, privacy, errors, tracking. */
  const act = useCallback(
    async (call: Call, acknowledged = false): Promise<SendResult | null> => {
      if (!current) {
        setNotice("Choose a model first.");
        return null;
      }
      // FR-046: say where messages go before the first one to a remote endpoint
      if (!acknowledged && current.endpoint.locality === "remote" && !current.endpoint.privacyAcknowledged) {
        setPrivacy({ choice: current, call });
        return null;
      }
      setNotice(undefined);
      try {
        const res = await call(current.ref);
        runStore().track({ runId: res.runId, chatId: res.chat.id, sessionKey, answerId: res.answerId, teacher: true });
        refresh(res.chat.id);
        return res;
      } catch (err) {
        if (isApiError(err, "privacy_ack_required")) setPrivacy({ choice: current, call });
        else if (isApiError(err, "run_active")) setNotice("Wait until the teacher has finished.");
        else if (isApiError(err, "model_unavailable")) setNotice("This model isn't available. Choose another one.");
        else setNotice(err instanceof Error ? err.message : "Couldn't send. Try again.");
        return null;
      }
    },
    [current, sessionKey, refresh],
  );

  const send = useCallback(
    async (text: string, attachments: ContextItemRef[]) => {
      if (chatId) return !!(await act((model) => sendTeacherMessage(chatId, { text, model, attachments })));
      // the tab becomes the chat's once it exists (also when sent after the privacy notice)
      const res = await act(async (model) => {
        const out = await startTeacherChat(sessionKey, {
          kind,
          text,
          model,
          attachments,
          topic: kind === "practice" ? topic.trim() || null : null,
          ideaIds: newIdeas ? newIdeas.map((i) => i.id) : null,
        });
        host?.replace(tabId, out.chat.id);
        return out;
      });
      return !!res;
    },
    [chatId, act, sessionKey, kind, topic, newIdeas, host, tabId],
  );

  const submit = useCallback(
    (pairs: [Question, CardDraft][]) => {
      if (!chatId) return;
      void act((model) => submitAnswers(chatId, model, pairs.map(([q, d]) => toInput(q, d)))).then((res) => {
        if (!res) return;
        pairs.forEach(([q]) => clearCard(chatId, q.id));
        const graded = res.graded ?? [];
        if (graded.length) setAnnounce(graded.map((g) => `Answer graded: ${g.status}`).join(". "));
      });
    },
    [chatId, act],
  );

  const actions: CardActions = {
    busy,
    onSubmit: (q, d) => submit([[q, d]]),
    onDispute: (q, reason) => chatId && void act((model) => disputeGrade(chatId, q.id, model, reason)),
    onHint: (q, attempt) => chatId && void act((model) => askHint(chatId, q.id, model, attempt)),
    onReveal: (q) =>
      chatId &&
      void revealSolution(chatId, q.id).then(
        () => refresh(chatId),
        () => toast.error("Couldn't show the solution. Try again."),
      ),
  };

  const selectQuestion = (id: string) => {
    setSelected(id);
    setAnswersShown(true);
    setHighlight(id);
    // where the teacher asked it, in this tab's conversation (other teacher tabs have the same ids)
    scrollTo(`[data-question="${id}"]`);
    setTimeout(() => setHighlight((h) => (h === id ? null : h)), 1500);
  };

  const ideas = isNew ? (newIdeas ?? []) : (data?.ideaSet ?? []);
  const changeIdeas = (next: Idea[]) => {
    if (isNew) return setNewIdeas(next);
    if (!chatId) return;
    void putIdeaSet(chatId, next.map((i) => i.id)).then(
      () => refresh(chatId),
      () => toast.error("Couldn't change the ideas. Try again."),
    );
  };
  const plan = data?.plans[data.plans.length - 1];
  const graph = data?.graph;

  const box = (
    <div className="grid gap-1">
      {isNew && kind === "practice" && (
        <input
          aria-label="Practice topic (optional)"
          placeholder="Topic (optional — else ideas from your knowledge graph)"
          value={topic}
          maxLength={200}
          onChange={(e) => setTopic(e.target.value)}
          className="h-8 rounded-md border border-input bg-background px-2 text-sm"
        />
      )}
      <MessageBox
        sessionKey={sessionKey}
        chatId={chatId ?? newDraftKey(kind)}
        textareaId={`teacher-box-${tabId}`}
        generating={busy}
        onSend={send}
        onStop={() => run && void runStore().stop(run.runId)}
        disabled={!models.loading && !models.choices.length}
        model={
          <ModelPicker
            choices={models.choices}
            value={current}
            missingLabel={data && !models.find(data.model ?? null) ? data.chat.modelLabel : undefined}
            onChange={setChosen}
          />
        }
        attach={<AttachMenu sessionKey={sessionKey} chatId={chatId ?? newDraftKey(kind)} capabilities={current?.model.capabilities} />}
        notice={notice && <p role="alert" className="text-sm text-danger">{notice}</p>}
      />
    </div>
  );

  const scrollTo = (selector: string) =>
    conversation.current?.querySelector(selector)?.scrollIntoView({ block: "start", behavior: "smooth" });
  const inquiriesCol = <InquiriesColumn turns={data?.turns ?? []} onSelect={(id) => scrollTo(`[data-turn="${id}"]`)} />;
  const currentCol = chatId ? (
    <CurrentQuestion
      chatId={chatId}
      questions={questions}
      selected={selected}
      onClearSelection={() => setSelected(null)}
      actions={actions}
      onSubmitAll={submit}
    />
  ) : (
    <p className="p-3 text-sm text-text-muted">The teacher's questions appear here as cards you can answer.</p>
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-editor-surface">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-divider px-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1"
          aria-pressed={questionsShown}
          onClick={() => {
            if (questionsShown) setLeft(LEFT.def);
            setQuestionsShown(!questionsShown);
          }}
        >
          <ListBullets size={16} aria-hidden />
          Your questions
        </Button>
        <h2 className="min-w-0 flex-1 truncate px-1 text-sm font-semibold">
          {data?.chat.title ?? (kind === "lesson" ? "New lesson" : "New practice")}
        </h2>
        {kind === "lesson" && graph?.status && GRAPH_TEXT[graph.status] && (
          <span role="status" className="flex items-center gap-1 text-xs text-text-muted">
            {GRAPH_TEXT[graph.status]}
            {graph.status === "failed" && chatId && (
              <Button variant="link" size="sm" className="h-6 px-1" onClick={() => void requestGraphUpdate(chatId).then(() => refresh(chatId))}>
                Retry
              </Button>
            )}
          </span>
        )}
        {kind === "lesson" && chatId && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1"
            onClick={() => void requestGraphUpdate(chatId).then(() => refresh(chatId), () => toast.error("Couldn't update the graph."))}
          >
            <ArrowsClockwise size={16} aria-hidden />
            Update graph
          </Button>
        )}
        <IdeaSetPopover ideas={ideas} onChange={changeIdeas} />
        {plan && (
          <Button variant="ghost" size="sm" className="h-8 gap-1" onClick={() => setPlanOpen(true)}>
            <Path size={16} aria-hidden />
            Plan
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1"
          aria-pressed={answersShown}
          onClick={() => {
            if (answersShown) setRight(RIGHT.def);
            setAnswersShown(!answersShown);
          }}
        >
          <Cards size={16} aria-hidden />
          Answers
        </Button>
      </div>
      <div ref={columns} className={stacked ? "flex min-h-0 flex-1 flex-col overflow-y-auto" : "flex min-h-0 flex-1"}>
        {questionsShown && (
          <>
            <section
              id={`teacher-questions-${tabId}`}
              aria-label="Your questions"
              className="flex min-h-0 shrink-0 flex-col border-r border-divider"
              style={stacked ? undefined : { width: left }}
            >
              {inquiriesCol}
            </section>
            {!stacked && (
              <PanelResizeHandle
                value={left}
                min={LEFT.min}
                max={LEFT.max}
                limit={() => room(answersShown ? right : 0)}
                defaultValue={LEFT.def}
                onResize={setLeft}
                grow="right"
                label="Resize your questions column"
                controls={`teacher-questions-${tabId}`}
              />
            )}
          </>
        )}
        <section ref={conversation} aria-label="Teacher" className="flex min-h-[320px] min-w-0 flex-1 flex-col overflow-hidden">
          <TeacherConversation
            chatId={chatId}
            turns={data?.turns ?? []}
            questions={questions}
            highlight={highlight}
            onSelectQuestion={selectQuestion}
            onRetryMalformed={(id) => chatId && void act((model) => retryMalformed(chatId, id, model))}
            busy={busy}
            box={box}
          />
        </section>
        {answersShown && !stacked && (
          <PanelResizeHandle
            value={right}
            min={RIGHT.min}
            max={RIGHT.max}
            limit={() => room(questionsShown ? left : 0)}
            defaultValue={RIGHT.def}
            onResize={setRight}
            grow="left"
            label="Resize current question column"
            controls={`teacher-current-${tabId}`}
          />
        )}
        {answersShown && (
          <section
            id={`teacher-current-${tabId}`}
            aria-label="Current question"
            className="min-h-0 shrink-0 overflow-y-auto border-l border-divider bg-editor-surface"
            style={stacked ? undefined : { width: right }}
          >
            {currentCol}
          </section>
        )}
        {!stacked && (
          <nav aria-label="Questions menu" className="flex min-h-0 w-14 shrink-0 flex-col border-l border-divider">
            <QuestionsColumn questions={questions} selected={selected} onSelect={selectQuestion} />
          </nav>
        )}
      </div>
      <PlanDialog plan={plan} open={planOpen} onOpenChange={setPlanOpen} />
      <PrivacyNotice
        endpoint={privacy?.choice.endpoint ?? null}
        onConfirmed={() => {
          const call = privacy?.call;
          setPrivacy(null);
          void qc.invalidateQueries({ queryKey: ["ai-endpoints"] });
          if (call) void act(call, true);
        }}
        onCancel={() => setPrivacy(null)}
      />
      <div className="sr-only" aria-live="polite">
        {announce}
      </div>
    </div>
  );
}
