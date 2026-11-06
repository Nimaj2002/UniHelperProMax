/**
 * 022 US1/US2 (FR-009, FR-010, FR-025): the Teacher column — the conversation, then the AI chat's
 * message box. Replies are prose (Markdown with diagrams and math), question chips where the
 * teacher asked something, and a notice with Retry where a question couldn't be displayed. A reply
 * that is streaming shows the run's live segments.
 */
import { CircleNotch, Question as QuestionIcon, WarningCircle } from "@phosphor-icons/react";
import { memo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AnswerMarkdown } from "@/features/chat/AnswerMarkdown";
import type { AnswerError } from "@/features/chat/api";
import { ErrorNotice } from "@/features/chat/ErrorNotice";
import { isActiveStatus, useChatRun, type LiveSegment } from "@/features/chat/runStore";
import { cn } from "@/lib/utils";
import type { Question, TeacherTurn } from "./api";

interface Props {
  chatId: string | null;
  turns: TeacherTurn[];
  questions: Question[];
  /** The question whose chip is highlighted (selected in the Questions column). */
  highlight: string | null;
  onSelectQuestion: (id: string) => void;
  onRetryMalformed: (segmentId: string) => void;
  busy: boolean;
  /** The message box, under the conversation. */
  box: ReactNode;
}

const ACTION_TEXT: Record<string, string> = { dispute: "Disputed a grade", hint: "Asked for a hint", retry: "Asked to repeat a question" };

function UserTurn({ turn }: { turn: TeacherTurn }) {
  const { user } = turn;
  const text =
    user.action === "answers"
      ? "Submitted answers"
      : user.action
        ? `${ACTION_TEXT[user.action] ?? "Action"}${user.target && user.action !== "retry" ? ` (${user.target.toUpperCase()})` : ""}`
        : user.text;
  return (
    <div data-turn={turn.id} className={cn("ml-auto max-w-[85%] scroll-mt-3 rounded-lg bg-surface-sunken px-3 py-2 text-sm whitespace-pre-wrap", user.action && "italic text-text-muted")}>
      <span className="sr-only">You: </span>
      {text}
    </div>
  );
}

function Segments({ segments, questions, highlight, onSelectQuestion, onRetryMalformed, busy }: {
  segments: LiveSegment[];
  questions: Question[];
  highlight: string | null;
  onSelectQuestion: (id: string) => void;
  onRetryMalformed: (id: string) => void;
  busy: boolean;
}) {
  return (
    <>
      {segments.map((s, i) => {
        if (s.type === "markdown") return <AnswerMarkdown key={i} text={s.text} />;
        if (s.type === "question") {
          const q = questions.find((x) => x.id === s.questionId);
          return (
            <button
              key={i}
              type="button"
              data-question={s.questionId}
              onClick={() => onSelectQuestion(s.questionId)}
              className={cn(
                "my-2 flex w-full scroll-mt-3 items-center gap-2 rounded-md border border-strong-border bg-surface-elevated px-3 py-2 text-left text-sm hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-ring",
                highlight === s.questionId && "ring-2 ring-ring motion-safe:transition-shadow",
              )}
            >
              <QuestionIcon size={16} aria-hidden className="shrink-0 text-primary" />
              <span className="min-w-0 truncate">
                Question {s.questionId.slice(1)}
                {q ? ` · ${q.title}` : ""}
              </span>
            </button>
          );
        }
        return (
          <div key={i} role="alert" className="my-2 flex items-center gap-2 rounded-md border border-warning px-3 py-2 text-sm">
            <WarningCircle size={16} aria-hidden className="shrink-0 text-warning" />
            <span className="flex-1">This question could not be displayed.</span>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onRetryMalformed(s.id)}>
              Retry
            </Button>
          </div>
        );
      })}
    </>
  );
}

const TeacherReply = memo(function TeacherReply({ turn, live, ...rest }: {
  turn: TeacherTurn;
  live: { segments: LiveSegment[]; status: string; error: AnswerError | null } | null;
  questions: Question[];
  highlight: string | null;
  onSelectQuestion: (id: string) => void;
  onRetryMalformed: (id: string) => void;
  busy: boolean;
}) {
  const a = turn.answer;
  const segments = (live?.segments ?? a.segments) as LiveSegment[];
  const status = live?.status ?? a.status;
  const error = live?.error ?? a.error;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-1">
      <p className="text-xs text-text-muted">
        Teacher{a.modelLabel ? ` · ${a.modelLabel}` : ""}
      </p>
      {isActiveStatus(status as never) && !segments.length && (
        <p className="flex items-center gap-2 text-sm text-text-muted">
          <CircleNotch size={14} aria-hidden className="animate-spin motion-reduce:animate-none" />
          Thinking…
        </p>
      )}
      <Segments segments={segments} {...rest} />
      {status === "stopped" && <p className="text-xs text-text-muted italic">Stopped</p>}
      {status === "interrupted" && <p className="text-xs text-text-muted italic">Interrupted</p>}
      {error && <ErrorNotice error={error} local={a.locality === "local"} />}
    </div>
  );
});

export function TeacherConversation({ chatId, turns, questions, highlight, onSelectQuestion, onRetryMalformed, busy, box }: Props) {
  const run = useChatRun(chatId);
  const known = new Set(turns.map((t) => t.answer.id));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3" aria-live="off">
        <div className="mx-auto grid w-full max-w-[72ch] grid-cols-[minmax(0,1fr)] gap-4">
          {turns.length === 0 && !run && (
            <p className="text-sm text-text-muted">
              Tell the teacher what you want to understand. It first asks a few questions to find where to start, then teaches one step at a
              time and checks each step.
            </p>
          )}
          {turns.map((t) => (
            <div key={t.id} className="grid grid-cols-[minmax(0,1fr)] gap-3">
              <UserTurn turn={t} />
              <TeacherReply
                turn={t}
                live={run && run.answerId === t.answer.id && (isActiveStatus(run.status) || !t.answer.segments.length) ? run : null}
                questions={questions}
                highlight={highlight}
                onSelectQuestion={onSelectQuestion}
                onRetryMalformed={onRetryMalformed}
                busy={busy}
              />
            </div>
          ))}
          {run && isActiveStatus(run.status) && !known.has(run.answerId) && (
            <Segments segments={run.segments} questions={questions} highlight={highlight} onSelectQuestion={onSelectQuestion} onRetryMalformed={onRetryMalformed} busy />
          )}
        </div>
      </div>
      <div className="min-w-0 shrink-0 p-2">{box}</div>
    </div>
  );
}
