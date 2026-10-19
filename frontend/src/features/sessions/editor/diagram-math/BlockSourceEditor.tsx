import { type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from "react";

export type ExitReason = "escape" | "up" | "down" | "blur";

interface Props {
  value: string;
  label: string;
  onChange: (value: string) => void;
  onExit: (reason: ExitReason) => void;
  dataUh: string;
  /** Selected once shown (e.g. a find-in-note match). */
  selectRange?: { start: number; end: number };
  readOnly?: boolean;
}

/**
 * The source of a diagram or display formula while it is being edited. Escape, or the arrow
 * keys past the first/last line, leave it; the preview is shown by the caller under it.
 */
export function BlockSourceEditor({ value, label, onChange, onExit, dataUh, selectRange, readOnly }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(value);

  useEffect(() => {
    ref.current?.focus();
    if (selectRange) ref.current?.setSelectionRange(selectRange.start, selectRange.end);
  }, [selectRange]);

  // grow with the content
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [text]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const before = el.value.slice(0, el.selectionStart);
    const after = el.value.slice(el.selectionEnd);
    const collapsed = el.selectionStart === el.selectionEnd && !e.shiftKey;
    const reason: ExitReason | null =
      e.key === "Escape"
        ? "escape"
        : e.key === "ArrowUp" && collapsed && !before.includes("\n")
          ? "up"
          : e.key === "ArrowDown" && collapsed && !after.includes("\n")
            ? "down"
            : null;
    if (!reason) return;
    // handled here: the note's own Escape (back to the tab) and the editor's arrows stay out
    e.preventDefault();
    e.stopPropagation();
    onExit(reason);
  };

  return (
    <textarea
      ref={ref}
      data-uh={dataUh}
      aria-label={label}
      className="uh-block-source"
      spellCheck={false}
      readOnly={readOnly}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value);
      }}
      onKeyDown={onKeyDown}
      onBlur={(e) => {
        const block = e.currentTarget.closest("[data-uh-block]");
        if (!block?.contains(e.relatedTarget as Node | null)) onExit("blur");
      }}
    />
  );
}

/**
 * `value`, updated only after it has stopped changing for `ms` (live previews, FR-004).
 * When `resetKey` changes (another item is being edited), the new value shows at once.
 */
export function useDebounced<T>(value: T, ms: number, resetKey?: unknown): T {
  const [settled, setSettled] = useState({ value, key: resetKey });
  if (settled.key !== resetKey) setSettled({ value, key: resetKey });
  useEffect(() => {
    const t = setTimeout(() => setSettled({ value, key: resetKey }), ms);
    return () => clearTimeout(t);
  }, [value, ms, resetKey]);
  return settled.key === resetKey ? settled.value : value;
}
