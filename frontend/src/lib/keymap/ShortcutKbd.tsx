import { cn } from "@/lib/utils";
import { useShortcut } from "./useKeymap";

/** A command's current key as a tooltip hint; nothing when it has none (019 FR-005). */
export function ShortcutKbd({ id, className }: { id: string; className?: string }) {
  const { label } = useShortcut(id);
  return label ? <kbd className={cn("ml-1 font-mono", className)}>{label}</kbd> : null;
}
