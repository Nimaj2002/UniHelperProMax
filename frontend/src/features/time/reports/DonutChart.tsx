/**
 * Donut chart (020 FR-052, research R11), hand-drawn SVG: each slice has its tag colour and a
 * pattern, so slices are told apart without colour; labelled slices, a legend with times, and a
 * text summary. The table next to it is the full text alternative.
 */
import { useId } from "react";
import { cn } from "@/lib/utils";
import { formatDuration } from "../clock";
import { tagBlock } from "../tagColors";
import type { Row } from "./report";

const PATTERNS = [
  null, // solid
  <path key="d" d="M0 6 L6 0" strokeWidth="1.5" />,
  <circle key="c" cx="3" cy="3" r="1.2" />,
  <path key="h" d="M0 3 H6" strokeWidth="1.5" />,
  <path key="v" d="M3 0 V6" strokeWidth="1.5" />,
  <path key="x" d="M0 0 L6 6 M6 0 L0 6" strokeWidth="1" />,
];

const pct = (share: number) => `${Math.round(share * 100)}%`;

function arc(cx: number, cy: number, r: number, inner: number, a0: number, a1: number): string {
  const p = (radius: number, a: number) => [cx + radius * Math.sin(a), cy - radius * Math.cos(a)].map((n) => n.toFixed(3)).join(" ");
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${p(r, a0)} A ${r} ${r} 0 ${large} 1 ${p(r, a1)} L ${p(inner, a1)} A ${inner} ${inner} 0 ${large} 0 ${p(inner, a0)} Z`;
}

interface Props {
  slices: Row[];
  total: number;
  selected: string | null;
  onSelect: (key: string) => void;
}

export function DonutChart({ slices, total, selected, onSelect }: Props) {
  const id = useId().replace(/:/g, "");
  const size = 180;
  const c = size / 2;
  const r = 84;
  const inner = 50;
  // where each slice starts, as a fraction of the circle
  const starts = slices.map((_, i) => slices.slice(0, i).reduce((t, s) => t + s.share, 0));
  const summary = slices.map((s) => `${s.name} ${formatDuration(s.seconds)} (${pct(s.share)})`).join(", ");
  return (
    <figure className="flex flex-col items-center gap-3">
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-[200px]" aria-hidden={false} role="group" aria-label={`Chart: ${summary}`}>
        <defs>
          {PATTERNS.map((shape, i) =>
            shape ? (
              <pattern key={i} id={`${id}-p${i}`} width="6" height="6" patternUnits="userSpaceOnUse" fill="var(--text-primary)" stroke="var(--text-primary)" opacity="0.45">
                {shape}
              </pattern>
            ) : null,
          )}
        </defs>
        {slices.map((s, i) => {
          const a0 = starts[i]! * 2 * Math.PI;
          const a1 = slices.length === 1 ? a0 + 2 * Math.PI - 0.0001 : a0 + s.share * 2 * Math.PI;
          const d = arc(c, c, r, inner, a0, a1);
          const mid = (a0 + a1) / 2;
          const lr = (r + inner) / 2;
          const style = tagBlock(s.color);
          const pattern = PATTERNS[i % PATTERNS.length];
          return (
            <g
              key={s.key}
              role="button"
              tabIndex={0}
              aria-label={`${s.name}: ${formatDuration(s.seconds)}, ${pct(s.share)}. Show entries`}
              aria-pressed={selected === s.key}
              onClick={() => onSelect(s.key)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect(s.key))}
              className="cursor-pointer outline-none [&:focus-visible_path]:stroke-[var(--focus-ring)] [&:focus-visible_path]:stroke-[3]"
            >
              <path d={d} fill={String(style.backgroundColor)} stroke="var(--surface-elevated)" strokeWidth={selected === s.key ? 3 : 1.5} />
              {pattern && <path d={d} fill={`url(#${id}-p${i % PATTERNS.length})`} pointerEvents="none" />}
              {s.share >= 0.08 && (
                <text x={c + lr * Math.sin(mid)} y={c - lr * Math.cos(mid)} textAnchor="middle" dominantBaseline="central" fontSize="10" fontWeight="600" fill="var(--text-primary)" paintOrder="stroke" stroke="var(--surface-elevated)" strokeWidth="3" pointerEvents="none">
                  {pct(s.share)}
                </text>
              )}
            </g>
          );
        })}
        <text x={c} y={c} textAnchor="middle" dominantBaseline="central" fontSize="12" fontWeight="600" fill="var(--text-primary)">
          {formatDuration(total)}
        </text>
      </svg>
      <figcaption className="w-full">
        <ul className="flex flex-col gap-1 text-xs" aria-label="Legend">
          {slices.map((s, i) => (
            <li key={s.key} className={cn("flex items-center gap-2", selected === s.key && "font-semibold")}>
              <svg viewBox="0 0 12 12" className="size-3 shrink-0" aria-hidden>
                <rect width="12" height="12" rx="2" fill={String(tagBlock(s.color).backgroundColor)} />
                {PATTERNS[i % PATTERNS.length] && <rect width="12" height="12" rx="2" fill={`url(#${id}-p${i % PATTERNS.length})`} />}
              </svg>
              <span className="min-w-0 flex-1 truncate">{s.name}</span>
              <span className="tabular-nums">{formatDuration(s.seconds)}</span>
              <span className="w-9 text-right tabular-nums text-text-muted">{pct(s.share)}</span>
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}
