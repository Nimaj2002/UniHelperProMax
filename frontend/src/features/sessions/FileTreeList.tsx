/** Notes and PDFs list in the same file-tree style as the media editor's recordings (025). */
import { Plus } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { Tree } from "@/components/ui/file-tree";

const ROW = 38;
const ROW_TALL = 50;
const MAX = 256;

export function FileTreeList({ label, count, tall, children }: { label: string; count: number; tall?: boolean; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} style={{ height: Math.min(count * (tall ? ROW_TALL : ROW) + 8, MAX) }}>
      <Tree sort="none" indicator={false} className="[&_[data-radix-scroll-area-viewport]>div]:block!">
        {children}
      </Tree>
    </div>
  );
}

/** The single round "+" that adds a note or a PDF. */
export function AddCircleButton({ label, ...rest }: { label: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
      {...rest}
    >
      <Plus size={14} weight="bold" aria-hidden />
    </button>
  );
}
