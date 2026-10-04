import { COLOR_KEYS, COLOR_LABELS, eventStyle, type ColorKey } from "@/lib/palette";
import { cn } from "@/lib/utils";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

/** Preset palette only — every colour keeps text readable in light and dark (FR-021). */
export function ColorPicker({ value, onChange }: { value: ColorKey; onChange: (c: ColorKey) => void }) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium">Colour</legend>
      <RadioGroup
        value={value}
        onValueChange={(v) => onChange(v as ColorKey)}
        className="flex flex-wrap gap-2"
        aria-label="Colour"
      >
        {COLOR_KEYS.map((key) => (
          <label
            key={key}
            className={cn(
              "flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium",
              "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
              value === key && "ring-2 ring-ring",
            )}
            style={eventStyle(key)}
          >
            <RadioGroupItem value={key} className="sr-only" aria-label={COLOR_LABELS[key]} />
            {COLOR_LABELS[key]}
          </label>
        ))}
      </RadioGroup>
    </fieldset>
  );
}
