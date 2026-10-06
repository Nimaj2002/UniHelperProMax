import { Pause, Play } from "@phosphor-icons/react";
import type { CSSProperties } from "react";
import { cssVars, type Base, type ColorSet } from "./colors";

/** Representative UI drawn with the theme's colours only (scoped CSS variables, 005 US4 #2). */
export function ThemePreview({ colors, base }: { colors: ColorSet; base: Base }) {
  return (
    <div
      data-theme={base}
      style={cssVars(colors) as CSSProperties}
      className="grid gap-3 rounded-lg border border-divider bg-surface p-4 text-foreground"
      aria-label="Theme preview"
      role="group"
    >
      <div className="grid grid-cols-[3rem_minmax(0,1fr)] overflow-hidden rounded-md border border-grid-line bg-surface-elevated text-xs">
        <div className="border-r border-grid-line p-1 text-muted-foreground">10:00</div>
        <div className="relative h-14 p-1">
          <div className="absolute inset-x-1 top-1 h-0.5 bg-now-line" aria-hidden />
          <div className="mt-2 rounded-md border-l-4 border-primary bg-surface-hover px-2 py-1 font-medium">Algorithms · Lecture</div>
        </div>
      </div>
      <div className="rounded-md bg-editor-surface p-3 text-sm">
        <p className="font-semibold">## Red–black trees</p>
        <p className="text-muted-foreground">Balanced search trees keep operations at O(log n).</p>
        <p>
          See <span className="text-primary underline underline-offset-4">the lecture slides</span>.
        </p>
      </div>
      <div className="flex flex-wrap gap-2 text-sm">
        <span className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground">Primary</span>
        <span className="rounded-md border border-strong-border px-3 py-1.5">Outline</span>
        <span className="rounded-md bg-destructive px-3 py-1.5 text-destructive-foreground">Delete</span>
        <span className="rounded-md px-3 py-1.5 outline-2 outline-offset-2 outline-ring">Focused</span>
      </div>
      <div className="grid gap-1 rounded-lg border border-divider bg-surface-elevated p-3 text-sm shadow-sm">
        <p className="font-medium">Delete “Lecture notes”?</p>
        <p className="text-muted-foreground">The file is removed from the session folder.</p>
        <p className="text-xs">
          <span className="text-success">Saved</span> · <span className="text-warning">Upload pending</span> · <span className="text-danger">Failed</span>
        </p>
      </div>
      <div className="flex items-center gap-2 rounded-md bg-surface-sunken p-2 text-xs">
        <Play size={14} weight="fill" aria-hidden />
        <Pause size={14} weight="fill" aria-hidden />
        <div className="h-1.5 flex-1 rounded-full bg-surface-hover">
          <div className="h-full w-1/3 rounded-full bg-primary" />
        </div>
        <span className="tabular-nums text-muted-foreground">12:04</span>
      </div>
    </div>
  );
}
