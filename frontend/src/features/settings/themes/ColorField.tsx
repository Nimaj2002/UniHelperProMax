import { useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { HEX } from "./colors";

/** A colour as a native picker plus a typed `#rrggbb` value (005 FR-022: never picker-only). */
export function ColorField({ label, value, onChange, hint }: { label: string; value: string; onChange: (hex: string) => void; hint?: string }) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? value;
  const invalid = draft !== null && !HEX.test(draft);
  const commit = (v: string) => {
    const hex = v.trim().startsWith("#") ? v.trim() : `#${v.trim()}`;
    if (HEX.test(hex)) {
      onChange(hex.toLowerCase());
      setDraft(null);
    }
  };
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
      <span className="text-sm">
        <label htmlFor={id}>{label}</label>
        {hint && <span id={`${id}-hint`} className="ml-1.5 text-xs text-muted-foreground">{hint}</span>}
      </span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} colour picker`}
          value={HEX.test(text) ? text : value}
          onChange={(e) => onChange(e.target.value.toLowerCase())}
          className="h-8 w-10 cursor-pointer rounded-md border border-strong-border bg-transparent p-0.5"
        />
        <Input
          id={id}
          value={text}
          onChange={(e) => {
            setDraft(e.target.value);
            commit(e.target.value);
          }}
          onBlur={() => setDraft(null)}
          aria-invalid={invalid || undefined}
          aria-describedby={hint ? `${id}-hint` : undefined}
          spellCheck={false}
          className="h-8 w-24 font-mono text-xs"
        />
      </div>
      {invalid && <p className="col-span-2 text-xs text-danger">Use the #rrggbb format.</p>}
    </div>
  );
}
