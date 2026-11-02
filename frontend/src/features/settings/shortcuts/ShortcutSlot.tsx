/** 019: one shortcut slot (main or alternate) of a command: shows its key and records a new one. */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { checkChord, chordFromEvent, setRecording, type Binding, type Command, type Refusal } from "@/lib/keymap";
import { cn } from "@/lib/utils";

const REFUSAL: Record<Refusal, (label: string) => string> = {
  tab: () => "Tab moves between controls and can't be a shortcut.",
  reserved: (label) => `${label} is used by your browser or system.`,
  needsModifier: () => "This command also works while typing, so it needs Alt, Ctrl or Cmd.",
  shiftReserved: () => "Shift with this key already means a bigger step.",
};

interface Props {
  command: Command;
  /** "Key" or "Alternate key", for the button's name */
  slotName: string;
  label: string | null;
  /** Shown instead of "Not set" when a default was dropped */
  emptyText?: string;
  onRecorded: (binding: Binding) => void;
}

export function ShortcutSlot({ command, slotName, label, emptyText = "Not set", onRecorded }: Props) {
  const [recording, setRec] = useState(false);
  const [message, setMessage] = useState("");
  const button = useRef<HTMLButtonElement>(null);
  // a recorded Space or Enter still "clicks" the button; that keyboard click must not restart recording
  const ignoreClick = useRef(false);

  const stop = () => {
    setRec(false);
    setRecording(false);
  };
  useEffect(() => () => setRecording(false), []);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!recording) {
      ignoreClick.current = false;
      return;
    }
    // Tab still moves focus, which ends recording (no keyboard trap)
    if (e.key === "Tab" && !e.ctrlKey && !e.metaKey && !e.altKey) return;
    e.preventDefault();
    e.stopPropagation();
    const pressed = chordFromEvent(e.nativeEvent);
    if (!pressed) return; // only modifiers so far
    const refusal = checkChord(command, pressed.chord);
    if (refusal) return setMessage(REFUSAL[refusal](pressed.label));
    setMessage("");
    stop();
    ignoreClick.current = true;
    onRecorded(pressed);
  };

  const start = () => {
    setRec(true);
    setRecording(true);
    setMessage("Press the new shortcut.");
  };

  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <div className="flex items-center gap-1">
        <Button
          ref={button}
          type="button"
          variant="outline"
          size="sm"
          className={cn("h-7 min-w-24 justify-start px-2 font-mono text-xs", recording && "ring-2 ring-ring")}
          aria-label={`${slotName} for ${command.label}: ${recording ? "press the new shortcut" : (label ?? emptyText)}. Press to change.`}
          aria-pressed={recording}
          onClick={(e) => {
            const keyboardClick = e.detail === 0;
            if (ignoreClick.current && keyboardClick) ignoreClick.current = false;
            else if (!recording) start();
          }}
          onKeyDown={onKeyDown}
          onBlur={() => {
            ignoreClick.current = false;
            if (recording) {
              stop();
              setMessage("");
            }
          }}
        >
          {recording ? <span className="font-sans text-muted-foreground">Press keys…</span> : label ? <kbd className="whitespace-pre">{label}</kbd> : <span className="font-sans text-muted-foreground">{emptyText}</span>}
        </Button>
        {recording && (
          // pointer users' way out; keyboard users leave with Tab (the blur ends recording first)
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => { stop(); setMessage(""); button.current?.focus(); }}>
            Cancel
          </Button>
        )}
      </div>
      <span role="status" aria-live="polite" className={cn("text-xs text-muted-foreground", !message && "sr-only")}>
        {message}
      </span>
    </div>
  );
}
