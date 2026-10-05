import { useEffect, useState } from "react";
import { recorder } from "./recorder";

/** Input level while recording (FR-002); the text label keeps it meaningful without colour. */
export function LevelMeter() {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setLevel(recorder().level()), 120);
    return () => window.clearInterval(id);
  }, []);
  const pct = Math.round(level * 100);
  return (
    <div className="flex items-center gap-2" aria-hidden>
      <span className="text-xs text-muted-foreground">Input</span>
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-sunken">
        <div className="h-full rounded-full bg-primary transition-[width] duration-100" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
