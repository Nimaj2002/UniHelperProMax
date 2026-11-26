import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useUiMode, type UiMode } from "@/app/uiMode";

const OPTIONS: { value: UiMode; label: string; description: string }[] = [
  { value: "ultimate", label: "Ultimate", description: "The full workspace with side panels." },
  { value: "simple", label: "Simple", description: "One sidebar and one main area, like a chat app." },
];

/** 026: choose the interface; saved on the account, applied immediately. */
export function UiModeSwitch() {
  const { mode, setMode } = useUiMode();
  return (
    <RadioGroup value={mode} onValueChange={(v) => setMode(v as UiMode)} aria-label="Interface" className="gap-3">
      {OPTIONS.map((o) => (
        <div key={o.value} className="flex items-start gap-3">
          <RadioGroupItem id={`ui-mode-${o.value}`} value={o.value} className="mt-1" />
          <Label htmlFor={`ui-mode-${o.value}`} className="grid gap-0.5 font-normal">
            <span className="font-medium">{o.label}</span>
            <span className="text-sm text-muted-foreground">{o.description}</span>
          </Label>
        </div>
      ))}
    </RadioGroup>
  );
}
