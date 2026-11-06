/**
 * 022 US2/US3/US7 (contracts/ui-contract.md "Current question"): one question. Unanswered, it is
 * a form — the options or a text answer (or the fixed "I don't know"), confidence on a 0–100 %
 * slider in steps of 25 (or not set — which is not 0 %) and "your thinking". Answered, it is the record: the answer, every grade in order, the
 * key once it may be shown, Dispute grade, and for practice problems Hint and Reveal solution.
 */
import { CheckCircle, CircleDashed, HourglassMedium, WarningCircle, XCircle } from "@phosphor-icons/react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { AnswerMarkdown } from "@/features/chat/AnswerMarkdown";
import { cn } from "@/lib/utils";
import type { Confidence, Question } from "./api";
import { isFilled, useCardDraft, type CardDraft } from "./cardDrafts";

export const STATUS: Record<Question["status"], { label: string; Icon: typeof CheckCircle; tone: string }> = {
  unanswered: { label: "Unanswered", Icon: CircleDashed, tone: "text-text-muted" },
  submitted: { label: "Waiting for grade", Icon: HourglassMedium, tone: "text-text-muted" },
  correct: { label: "Correct", Icon: CheckCircle, tone: "text-success" },
  partly: { label: "Partly correct", Icon: WarningCircle, tone: "text-warning" },
  incorrect: { label: "Incorrect", Icon: XCircle, tone: "text-danger" },
};

export function StatusLabel({ status, className }: { status: Question["status"]; className?: string }) {
  const { label, Icon, tone } = STATUS[status];
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs", tone, className)}>
      <Icon size={14} aria-hidden />
      {label}
    </span>
  );
}

const STEPS: Confidence[] = [0, 25, 50, 75, 100];
const DONT_KNOW = "dk";

export interface CardActions {
  /** Submit this card alone. */
  onSubmit: (q: Question, draft: CardDraft) => void;
  onDispute: (q: Question, reason: string) => void;
  onHint: (q: Question, attempt: string) => void;
  onReveal: (q: Question) => void;
  /** A reply is streaming: answers wait (edge case). */
  busy: boolean;
}

const optionClass =
  "flex cursor-pointer items-start gap-2 rounded-md border border-divider p-2 font-normal hover:bg-surface-hover has-[:checked]:border-primary has-[[data-state=checked]]:border-primary";

/** `shared`: one of several open cards — the column's single "Submit answers" sends them. */
function AnswerForm({ chatId, q, actions, shared }: { chatId: string; q: Question; actions: CardActions; shared: boolean }) {
  const [draft, update] = useCardDraft(chatId, q.id);
  const id = useId();
  const [revealing, setRevealing] = useState(false);
  const filled = isFilled(q, draft);
  return (
    <div className="grid gap-3">
      {q.kind === "choice" ? (
        <RadioGroup
          aria-label="Your answer"
          value={draft.dontKnow ? DONT_KNOW : draft.choice === null ? "" : String(draft.choice)}
          onValueChange={(v) => update(v === DONT_KNOW ? { dontKnow: true, choice: null } : { dontKnow: false, choice: Number(v) })}
          className="grid gap-1.5"
        >
          {(q.options ?? []).map((o, i) => (
            <Label key={i} htmlFor={`${id}-o${i}`} className={optionClass}>
              <RadioGroupItem id={`${id}-o${i}`} value={String(i)} className="mt-0.5" />
              <span className="min-w-0">
                <span className="mr-1 font-medium">{String.fromCharCode(65 + i)}.</span>
                {o}
              </span>
            </Label>
          ))}
          <Label htmlFor={`${id}-dk`} className={cn(optionClass, "border-dashed")}>
            <RadioGroupItem id={`${id}-dk`} value={DONT_KNOW} className="mt-0.5" />
            <span className="min-w-0">I don't know</span>
          </Label>
        </RadioGroup>
      ) : (
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-text`}>Your answer</Label>
          <Textarea
            id={`${id}-text`}
            value={draft.text}
            maxLength={8000}
            rows={3}
            disabled={draft.dontKnow}
            onChange={(e) => update({ text: e.target.value })}
          />
          <Label htmlFor={`${id}-dk`} className={cn(optionClass, "border-dashed")}>
            <Checkbox id={`${id}-dk`} checked={draft.dontKnow} onCheckedChange={(on) => update({ dontKnow: on === true })} className="mt-0.5" />
            <span className="min-w-0">I don't know</span>
          </Label>
        </div>
      )}
      <div className="grid gap-1.5">
        <div className="flex items-baseline justify-between">
          <span id={`${id}-conf`} className="text-sm font-medium">
            How sure are you?
          </span>
          <span aria-hidden className="text-xs text-text-muted">
            {draft.confidence === null ? "Not set" : `${draft.confidence}%`}
          </span>
        </div>
        <Slider
          aria-labelledby={`${id}-conf`}
          aria-valuetext={draft.confidence === null ? "Not set" : `${draft.confidence}%`}
          min={0}
          max={100}
          step={25}
          value={[draft.confidence ?? 50]}
          onValueChange={([v]) => update({ confidence: v as Confidence })}
          className={cn("px-1 py-1", draft.confidence === null && "opacity-60")}
        />
        <div aria-hidden className="flex justify-between text-[11px] text-text-muted">
          {STEPS.map((s) => (
            <span key={s}>{s}</span>
          ))}
        </div>
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`${id}-think`}>Your thinking (optional)</Label>
        <Textarea
          id={`${id}-think`}
          value={draft.thinking}
          maxLength={8000}
          rows={2}
          placeholder="What you reasoned, what you're unsure about…"
          onChange={(e) => update({ thinking: e.target.value })}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {!shared && (
          <Button
            size="sm"
            disabled={!filled || actions.busy}
            aria-describedby={actions.busy ? `${id}-busy` : undefined}
            onClick={() => actions.onSubmit(q, draft)}
          >
            Submit answer
          </Button>
        )}
        {q.practice && (
          <>
            <Button size="sm" variant="outline" disabled={actions.busy} onClick={() => actions.onHint(q, q.kind === "text" ? draft.text : "")}>
              Hint
            </Button>
            {revealing ? (
              <span className="flex items-center gap-1 text-sm">
                Show the solution now?
                <Button size="sm" variant="ghost" onClick={() => actions.onReveal(q)}>
                  Reveal
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setRevealing(false)}>
                  Cancel
                </Button>
              </span>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setRevealing(true)}>
                Reveal solution
              </Button>
            )}
          </>
        )}
        {actions.busy && !shared && (
          <span id={`${id}-busy`} className="text-xs text-text-muted">
            Wait until the teacher has finished.
          </span>
        )}
      </div>
    </div>
  );
}

function Key({ q }: { q: Question }) {
  if (q.key === undefined || q.key === null || (q.key === "" && !q.explanation)) return null;
  const shown = q.kind === "choice" && typeof q.key === "number" ? `${String.fromCharCode(65 + q.key)}. ${q.options?.[q.key] ?? ""}` : String(q.key);
  return (
    <div className="rounded-md bg-surface-sunken p-2 text-sm">
      <p className="font-medium">{q.kind === "choice" ? "Correct answer" : "Model solution"}</p>
      <AnswerMarkdown text={shown} />
      {q.explanation && <AnswerMarkdown text={q.explanation} className="text-text-muted" />}
    </div>
  );
}

function Record({ q, actions }: { q: Question; actions: CardActions }) {
  const [disputing, setDisputing] = useState<string | null>(null);
  const id = useId();
  const sub = q.submission;
  const graded = q.grades.length > 0;
  return (
    <div className="grid gap-3 text-sm">
      {sub && (
        <div className="grid gap-1">
          <p className="font-medium">Your answer</p>
          <p>
            {sub.dontKnow
              ? "I don't know"
              : sub.choice !== null && sub.choice !== undefined
                ? `${String.fromCharCode(65 + sub.choice)}. ${q.options?.[sub.choice] ?? ""}`
                : sub.text}
          </p>
          <p className="text-text-muted">Confidence: {sub.confidence === null || sub.confidence === undefined ? "not set" : `${sub.confidence}%`}</p>
          {sub.thinking && <p className="text-text-muted">Thinking: {sub.thinking}</p>}
        </div>
      )}
      {q.hints.length > 0 && (
        <div className="grid gap-1">
          <p className="font-medium">Hints</p>
          <ol className="list-decimal pl-5">
            {q.hints.map((h, i) => (
              <li key={i}>{h.text}</li>
            ))}
          </ol>
        </div>
      )}
      {graded && (
        <ol aria-label="Grades" className="grid gap-1">
          {q.grades.map((g, i) => (
            <li key={i} className="grid gap-0.5">
              <span className="flex items-center gap-2">
                <StatusLabel status={g.grade} />
                <span className="text-xs text-text-muted">{g.by === "server" ? "graded by the app" : i > 0 ? "teacher, after dispute" : "teacher"}</span>
              </span>
              {g.disputeReason && <span className="text-xs text-text-muted">Your reason: {g.disputeReason}</span>}
              {g.feedback && <span>{g.feedback}</span>}
            </li>
          ))}
        </ol>
      )}
      <Key q={q} />
      {sub && (
        <div className="grid gap-1">
          {disputing === null ? (
            <Button size="sm" variant="outline" className="justify-self-start" disabled={actions.busy} onClick={() => setDisputing("")}>
              {graded ? "Dispute grade" : "Ask to grade"}
            </Button>
          ) : (
            <form
              className="grid gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                actions.onDispute(q, disputing);
                setDisputing(null);
              }}
            >
              <Label htmlFor={`${id}-reason`}>Why do you think the grade is wrong? (optional)</Label>
              <Textarea id={`${id}-reason`} rows={2} maxLength={4000} value={disputing} onChange={(e) => setDisputing(e.target.value)} />
              <div className="flex gap-2">
                <Button size="sm" type="submit" disabled={actions.busy}>
                  Send to the teacher
                </Button>
                <Button size="sm" variant="ghost" type="button" onClick={() => setDisputing(null)}>
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

export function QuestionCard({
  chatId,
  q,
  actions,
  headingLevel = 3,
  shared = false,
}: {
  chatId: string;
  q: Question;
  actions: CardActions;
  headingLevel?: 2 | 3;
  shared?: boolean;
}) {
  const H = headingLevel === 2 ? "h2" : "h3";
  return (
    <article aria-labelledby={`qc-${q.id}`} className="grid gap-3 rounded-lg border border-strong-border bg-surface-elevated p-3">
      <header className="flex items-center justify-between gap-2">
        <H id={`qc-${q.id}`} className="min-w-0 truncate text-sm font-semibold">
          {q.id.toUpperCase()} · {q.title}
        </H>
        <StatusLabel status={q.status} />
      </header>
      <AnswerMarkdown text={q.prompt} />
      {q.status === "unanswered" ? <AnswerForm chatId={chatId} q={q} actions={actions} shared={shared} /> : <Record q={q} actions={actions} />}
      {q.status === "unanswered" && q.revealed && <Key q={q} />}
    </article>
  );
}
