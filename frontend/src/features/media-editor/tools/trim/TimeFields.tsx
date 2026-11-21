import { useState, type KeyboardEvent } from "react";
import { Field } from "@/components/form/Field";
import { Input } from "@/components/ui/input";
import { formatTime, parseTime } from "./time";

interface Props {
  label: string;
  valueMs: number;
  maxMs: number;
  /** Returns the value actually applied (a window stops at its neighbour). */
  onChange: (ms: number) => number;
}

/** An exact time: type it, or step it with ↑/↓ (0.1 s; Shift 1 s; Alt 10 s). */
export function TimeField({ label, valueMs, maxMs, onChange }: Props) {
  const [text, setText] = useState(formatTime(valueMs));
  const [error, setError] = useState<string>();
  // the box follows the value (the waveform's handles move it) unless it is being typed in
  const [seen, setSeen] = useState(valueMs);
  if (seen !== valueMs) {
    setSeen(valueMs);
    setText(formatTime(valueMs));
    setError(undefined);
  }

  const commit = () => {
    const ms = parseTime(text);
    if (ms === null) return setError("Use minutes:seconds, like 1:05.5");
    if (ms > maxMs) return setError("That is past the end of the audio.");
    setError(undefined);
    const applied = onChange(ms);
    setText(formatTime(applied));
    setSeen(applied);
    if (applied !== ms) setError("Stopped at the neighbouring window.");
  };
  const step = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") return commit();
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const size = e.altKey ? 10_000 : e.shiftKey ? 1000 : 100;
    const base = parseTime(text) ?? valueMs;
    const applied = onChange(Math.min(maxMs, Math.max(0, base + (e.key === "ArrowUp" ? size : -size))));
    setText(formatTime(applied));
    setSeen(applied);
  };
  return (
    <Field label={label} error={error}>
      <Input
        value={text}
        inputMode="decimal"
        className="w-36 font-mono tabular-nums"
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={step}
        aria-keyshortcuts="ArrowUp ArrowDown"
      />
    </Field>
  );
}
