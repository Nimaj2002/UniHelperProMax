import { Plus, Trash } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface LinkValue {
  label: string;
  url: string;
}

export const MAX_LINKS = 10;

export function isValidUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === "http:" || u.protocol === "https:") && !!u.host && url.length <= 2048;
  } catch {
    return false;
  }
}

export function LinksEditor({
  value,
  onChange,
  errors,
}: {
  value: LinkValue[];
  onChange: (v: LinkValue[]) => void;
  errors: Record<number, string>;
}) {
  const update = (i: number, patch: Partial<LinkValue>) =>
    onChange(value.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <fieldset className="grid gap-3">
      <legend className="mb-1 text-sm font-medium">Links (optional)</legend>
      {value.map((link, i) => (
        <div key={i} className="grid gap-1">
          <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] gap-2">
            <Input
              aria-label={`Link ${i + 1} label`}
              placeholder="Label"
              maxLength={60}
              value={link.label}
              onChange={(e) => update(i, { label: e.target.value })}
            />
            <Input
              aria-label={`Link ${i + 1} address`}
              placeholder="https://"
              inputMode="url"
              value={link.url}
              aria-invalid={errors[i] ? true : undefined}
              aria-describedby={errors[i] ? `link-${i}-error` : undefined}
              onChange={(e) => update(i, { url: e.target.value.trim() })}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove link ${i + 1}`}
              onClick={() => onChange(value.filter((_, j) => j !== i))}
            >
              <Trash size={16} />
            </Button>
          </div>
          {errors[i] && <p id={`link-${i}-error`} className="text-sm text-danger">{errors[i]}</p>}
        </div>
      ))}
      {value.length < MAX_LINKS && (
        <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={() => onChange([...value, { label: "", url: "" }])}>
          <Plus size={16} /> Add link
        </Button>
      )}
    </fieldset>
  );
}
