import { SidebarSimple } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { SHOW_RIGHT_ID, RIGHT_CARD_ID } from "@/app/shell/layout";
import { useActivitySignals, type ActivitySignal } from "@/app/shell/registry";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Runs one registered activity hook and reports its state (hooks can't run in a loop). */
function Signal({ signal, onChange }: { signal: ActivitySignal; onChange: (id: string, active: boolean) => void }) {
  const active = signal.useActive();
  useEffect(() => {
    onChange(signal.id, active);
    return () => onChange(signal.id, false);
  }, [signal.id, active, onChange]);
  return null;
}

function Indicator({ kind }: { kind: ActivitySignal["kind"] }) {
  return kind === "recording" ? (
    <span aria-hidden data-indicator="recording" className="absolute top-1 right-1 size-2 animate-pulse rounded-full bg-danger ring-2 ring-surface-elevated motion-reduce:animate-none" />
  ) : (
    <span
      aria-hidden
      data-indicator="transcription"
      className="absolute -right-0.5 -bottom-0.5 size-3 animate-spin rounded-full border-2 border-primary border-t-transparent bg-surface-elevated motion-reduce:animate-none"
    />
  );
}

/**
 * Reopens the closed audio card from the tab row (008 FR-015, FR-022). While a recording or a
 * transcription runs it shows an indicator and says so in its name, so closing the card never
 * hides a recording.
 */
export function AudioReopenButton({ onOpen }: { onOpen: () => void }) {
  const signals = useActivitySignals();
  const [running, setRunning] = useState<Record<string, boolean>>({});
  const onChange = useCallback((id: string, on: boolean) => setRunning((r) => (r[id] === on ? r : { ...r, [id]: on })), []);
  const active = signals.filter((s) => running[s.id]);
  const label = ["Show audio panel", ...active.map((s) => s.description)].join(", ");
  return (
    <>
      {signals.map((s) => (
        <Signal key={s.id} signal={s} onChange={onChange} />
      ))}
      <ReopenButton label={label} active={active} onOpen={onOpen} />
    </>
  );
}

function ReopenButton({ label, active, onOpen }: { label: string; active: ActivitySignal[]; onOpen: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          id={SHOW_RIGHT_ID}
          variant="ghost"
          size="icon"
          className="relative size-8 shrink-0"
          onClick={onOpen}
          aria-controls={RIGHT_CARD_ID}
          aria-expanded={false}
          aria-label={label}
          aria-keyshortcuts="Alt+BracketRight"
        >
          <SidebarSimple size={18} className="-scale-x-100" />
          {active.map((s) => (
            <Indicator key={s.id} kind={s.kind} />
          ))}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {label} <kbd className="ml-1 font-mono">Alt+]</kbd>
      </TooltipContent>
    </Tooltip>
  );
}
