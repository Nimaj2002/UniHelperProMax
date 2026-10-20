/** 014 FR-034: "‹ n/m ›" between the versions of an answer (or a message), keyboard accessible. */
import { CaretLeft, CaretRight } from "@phosphor-icons/react";

interface Props {
  /** "Answer version" → the group is named "Answer version 2 of 3". */
  label: string;
  index: number;
  count: number;
  onSelect: (i: number) => void;
  disabled?: boolean;
}

export function VersionSwitch({ label, index, count, onSelect, disabled }: Props) {
  const btn = "inline-flex size-6 items-center justify-center rounded hover:bg-surface-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-40";
  return (
    <div role="group" aria-label={`${label} ${index + 1} of ${count}`} className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
      <button type="button" className={btn} aria-label={`Previous ${label.toLowerCase()}`} disabled={disabled || index <= 0} onClick={() => onSelect(index - 1)}>
        <CaretLeft size={12} aria-hidden />
      </button>
      <span aria-hidden className="min-w-8 text-center tabular-nums">
        {index + 1}/{count}
      </span>
      <button type="button" className={btn} aria-label={`Next ${label.toLowerCase()}`} disabled={disabled || index >= count - 1} onClick={() => onSelect(index + 1)}>
        <CaretRight size={12} aria-hidden />
      </button>
    </div>
  );
}
