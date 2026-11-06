/**
 * 022 US2/US3 (FR-019–FR-021, FR-023): the right column. With nothing selected it shows every
 * unanswered question as a card, in order; several open cards share one "Submit answers" at the
 * bottom, enabled once every card has an answer. A question picked in the Questions column is
 * shown on its own, as its record once answered.
 */
import { useId } from "react";
import { Button } from "@/components/ui/button";
import type { Question } from "./api";
import { readCard, useAllFilled, type CardDraft } from "./cardDrafts";
import { QuestionCard, type CardActions } from "./QuestionCard";

interface Props {
  chatId: string;
  questions: Question[];
  selected: string | null;
  onClearSelection: () => void;
  actions: CardActions;
  onSubmitAll: (pairs: [Question, CardDraft][]) => void;
}

export function CurrentQuestion({ chatId, questions, selected, onClearSelection, actions, onSubmitAll }: Props) {
  const open = questions.filter((q) => q.status === "unanswered");
  const allFilled = useAllFilled(chatId, open);
  const hintId = useId();
  const picked = selected ? questions.find((q) => q.id === selected) : undefined;
  if (picked)
    return (
      <div className="grid content-start gap-2 p-2">
        <Button variant="ghost" size="sm" className="justify-self-start" onClick={onClearSelection}>
          Show open questions
        </Button>
        <QuestionCard chatId={chatId} q={picked} actions={actions} />
      </div>
    );
  if (!open.length)
    return <p className="p-3 text-sm text-text-muted">No open questions. New questions from the teacher appear here.</p>;
  const shared = open.length > 1;
  return (
    <div className="grid content-start gap-2 p-2">
      {open.map((q) => (
        <QuestionCard key={q.id} chatId={chatId} q={q} actions={actions} shared={shared} />
      ))}
      {shared && (
        <div className="grid gap-1 pt-1">
          <Button
            disabled={!allFilled || actions.busy}
            aria-describedby={hintId}
            onClick={() => onSubmitAll(open.map((q) => [q, readCard(chatId, q.id)]))}
          >
            Submit answers
          </Button>
          <span id={hintId} className="text-center text-xs text-text-muted">
            {actions.busy
              ? "Wait until the teacher has finished."
              : allFilled
                ? `All ${open.length} questions answered.`
                : `Answer all ${open.length} questions to submit.`}
          </span>
        </div>
      )}
    </div>
  );
}
