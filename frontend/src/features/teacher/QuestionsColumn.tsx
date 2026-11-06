/**
 * 022 US3 (FR-022–FR-024): the teacher's questions as a vertical menu on the tab's right edge,
 * like the home page's side rails — `Q1`, `Q2`… with a status icon; the title and status (in
 * words, never colour alone) are in the name and tooltip. A listbox: arrows move, Enter or a
 * click selects.
 */
import { useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import type { Question } from "./api";
import { STATUS } from "./QuestionCard";

interface Props {
  questions: Question[];
  selected: string | null;
  onSelect: (id: string) => void;
}

export function QuestionsColumn({ questions, selected, onSelect }: Props) {
  const list = useRef<HTMLUListElement>(null);
  const move = (e: KeyboardEvent<HTMLLIElement>, i: number) => {
    const to = e.key === "ArrowDown" ? i + 1 : e.key === "ArrowUp" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? questions.length - 1 : null;
    if (to !== null && questions[to]) {
      e.preventDefault();
      list.current?.querySelectorAll<HTMLElement>("[role=option]")[to]?.focus();
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(questions[i].id);
    }
  };
  const focusIndex = Math.max(0, questions.findIndex((q) => q.id === selected));
  if (!questions.length) return <p className="px-1 py-2 text-center text-[11px] text-text-muted">No questions</p>;
  return (
    <ul ref={list} role="listbox" aria-label="Questions" className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto py-2">
      {questions.map((q, i) => {
        const { label, Icon, tone } = STATUS[q.status];
        const on = q.id === selected;
        return (
          <li
            key={q.id}
            role="option"
            aria-selected={on}
            aria-label={`${q.id.toUpperCase()} ${q.title}, ${label}`}
            title={`${q.id.toUpperCase()} · ${q.title} — ${label}`}
            tabIndex={i === focusIndex ? 0 : -1}
            onClick={() => onSelect(q.id)}
            onKeyDown={(e) => move(e, i)}
            className={cn(
              "flex w-11 shrink-0 cursor-pointer flex-col items-center gap-0.5 rounded-md py-1.5 text-xs outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring",
              on && "bg-surface-sunken",
            )}
          >
            <Icon size={16} aria-hidden className={tone} />
            <span className="font-medium">{q.id.toUpperCase()}</span>
            <span className="sr-only">{label}</span>
          </li>
        );
      })}
    </ul>
  );
}
