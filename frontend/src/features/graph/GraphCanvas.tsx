/**
 * 022 FR-032/FR-037 (contracts/ui-contract.md "Knowledge graph"): the graph drawn on a canvas in
 * the home page's right panel — pan by dragging, zoom with the wheel or +/−, 0 or Fit to see it
 * all. Colours come from theme tokens and are re-read when the theme changes. Keyboard: the canvas
 * is one focusable element; arrows move to the nearest linked idea in that direction, Enter opens
 * it, Escape clears the selection. Labels show when zoomed in, and always for the selected idea
 * and its neighbours.
 */
import { ArrowsIn, Minus, Plus } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from "react";
import { Button } from "@/components/ui/button";
import type { Graph } from "./api";
import type { Pos } from "./layout";

interface View {
  k: number;
  x: number;
  y: number;
}

interface Props {
  graph: Graph;
  positions: Map<string, Pos>;
  selected: string | null;
  /** Ideas matching the search (highlighted). */
  matches: Set<string>;
  onSelect: (id: string | null) => void;
  onOpen: (id: string) => void;
}

const LABEL_ZOOM = 1.4;
const TOKENS = ["--color-primary", "--color-muted-foreground", "--color-border", "--color-ring", "--color-foreground", "--color-background"] as const;

function readColors(el: Element): Record<(typeof TOKENS)[number], string> {
  const css = getComputedStyle(el);
  return Object.fromEntries(TOKENS.map((t) => [t, css.getPropertyValue(t).trim() || "currentColor"])) as Record<(typeof TOKENS)[number], string>;
}

function useThemeVersion() {
  const [v, setV] = useState(0);
  useEffect(() => {
    const obs = new MutationObserver(() => setV((n) => n + 1));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
    return () => obs.disconnect();
  }, []);
  return v;
}

export function fitView(positions: Map<string, Pos>, width: number, height: number): View {
  if (!positions.size || !width || !height) return { k: 1, x: width / 2, y: height / 2 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of positions.values()) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const pad = 30;
  const k = Math.min(4, Math.max(0.05, Math.min((width - pad * 2) / Math.max(1, maxX - minX), (height - pad * 2) / Math.max(1, maxY - minY))));
  return { k, x: width / 2 - ((minX + maxX) / 2) * k, y: height / 2 - ((minY + maxY) / 2) * k };
}

/** The linked idea nearest in a direction (by angle, then distance), for arrow keys. */
export function neighbourInDirection(from: Pos, candidates: { id: string; p: Pos }[], key: string): string | null {
  const dir = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] }[key];
  if (!dir) return null;
  let best: { id: string; score: number } | null = null;
  for (const c of candidates) {
    const dx = c.p.x - from.x;
    const dy = c.p.y - from.y;
    const dist = Math.hypot(dx, dy) || 1;
    const cos = (dx * dir[0] + dy * dir[1]) / dist;
    if (cos < 0.3) continue;
    const score = dist / cos;
    if (!best || score < best.score) best = { id: c.id, score };
  }
  return best?.id ?? null;
}

export function GraphCanvas({ graph, positions, selected, matches, onSelect, onOpen }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View | null>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const theme = useThemeVersion();

  const neighbours = useMemo(() => {
    const out = new Map<string, Set<string>>();
    const add = (a: string, b: string) => {
      if (!out.has(a)) out.set(a, new Set());
      out.get(a)!.add(b);
    };
    for (const l of graph.links)
      for (const p of l.premiseIds) {
        add(p, l.conclusionId);
        add(l.conclusionId, p);
      }
    return out;
  }, [graph.links]);
  const names = useMemo(() => new Map(graph.ideas.map((i) => [i.id, i.name])), [graph.ideas]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const v = view ?? fitView(positions, size.w, size.h);
  const fit = useCallback(() => setView(fitView(positions, size.w, size.h)), [positions, size]);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !size.w || !size.h) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(size.w * dpr);
    c.height = Math.round(size.h * dpr);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const col = readColors(c);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    const at = (p: Pos) => [p.x * v.k + v.x, p.y * v.k + v.y] as const;
    ctx.strokeStyle = col["--color-border"];
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const l of graph.links) {
      const to = positions.get(l.conclusionId);
      if (!to) continue;
      const [tx, ty] = at(to);
      for (const pid of l.premiseIds) {
        const from = positions.get(pid);
        if (!from) continue;
        const [fx, fy] = at(from);
        ctx.moveTo(fx, fy);
        ctx.lineTo(tx, ty);
      }
    }
    ctx.stroke();
    const near = selected ? (neighbours.get(selected) ?? new Set<string>()) : new Set<string>();
    ctx.font = "12px var(--font-sans, sans-serif)";
    for (const idea of graph.ideas) {
      const p = positions.get(idea.id);
      if (!p) continue;
      const [x, y] = at(p);
      if (x < -50 || y < -20 || x > size.w + 50 || y > size.h + 20) continue;
      const isSel = idea.id === selected;
      ctx.beginPath();
      ctx.arc(x, y, isSel ? 7 : 4.5, 0, Math.PI * 2);
      ctx.fillStyle = matches.has(idea.id) || isSel ? col["--color-primary"] : col["--color-muted-foreground"];
      ctx.fill();
      if (isSel) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = col["--color-ring"];
        ctx.stroke();
      }
      if (v.k >= LABEL_ZOOM || isSel || near.has(idea.id) || matches.has(idea.id)) {
        const text = idea.name.length > 40 ? `${idea.name.slice(0, 39)}…` : idea.name;
        ctx.fillStyle = col["--color-background"];
        const w = ctx.measureText(text).width;
        ctx.globalAlpha = 0.85;
        ctx.fillRect(x + 8, y - 8, w + 4, 16);
        ctx.globalAlpha = 1;
        ctx.fillStyle = col["--color-foreground"];
        ctx.fillText(text, x + 10, y + 4);
      }
    }
  }, [graph, positions, selected, matches, neighbours, v, size, theme]);

  const hit = (clientX: number, clientY: number): string | null => {
    const r = canvas.current?.getBoundingClientRect();
    if (!r) return null;
    const mx = clientX - r.left;
    const my = clientY - r.top;
    let best: { id: string; d: number } | null = null;
    for (const [id, p] of positions) {
      const d = Math.hypot(p.x * v.k + v.x - mx, p.y * v.k + v.y - my);
      if (d < 10 && (!best || d < best.d)) best = { id, d };
    }
    return best?.id ?? null;
  };

  const zoomBy = (factor: number, cx = size.w / 2, cy = size.h / 2) =>
    setView(() => {
      const k = Math.min(8, Math.max(0.05, v.k * factor));
      return { k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k };
    });

  const onKey = (e: KeyboardEvent<HTMLCanvasElement>) => {
    if (e.key === "+" || e.key === "=") zoomBy(1.25);
    else if (e.key === "-") zoomBy(0.8);
    else if (e.key === "0") fit();
    else if (e.key === "Escape") onSelect(null);
    else if (e.key === "Enter" && selected) onOpen(selected);
    else if (e.key.startsWith("Arrow")) {
      if (!selected) {
        if (graph.ideas[0]) onSelect(graph.ideas[0].id);
      } else {
        const from = positions.get(selected);
        const linked = [...(neighbours.get(selected) ?? [])].map((id) => ({ id, p: positions.get(id)! })).filter((c) => c.p);
        const all = linked.length ? linked : [...positions].filter(([id]) => id !== selected).map(([id, p]) => ({ id, p }));
        const next = from ? neighbourInDirection(from, all, e.key) : null;
        if (next) onSelect(next);
      }
    } else return;
    e.preventDefault();
  };

  const label = selected ? `Knowledge graph, ${graph.ideas.length} ideas. Selected: ${names.get(selected) ?? ""}` : `Knowledge graph, ${graph.ideas.length} ideas`;

  return (
    <div ref={wrap} className="relative min-h-0 flex-1 overflow-hidden rounded-md border border-divider bg-surface-sunken">
      <canvas
        ref={canvas}
        tabIndex={0}
        role="img"
        aria-label={label}
        aria-describedby="graph-keys"
        className="absolute inset-0 size-full cursor-grab touch-none outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
        style={{ width: size.w, height: size.h }}
        onKeyDown={onKey}
        onWheel={(e: WheelEvent<HTMLCanvasElement>) => {
          const r = canvas.current!.getBoundingClientRect();
          zoomBy(e.deltaY < 0 ? 1.15 : 0.87, e.clientX - r.left, e.clientY - r.top);
        }}
        onPointerDown={(e: PointerEvent<HTMLCanvasElement>) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, vx: v.x, vy: v.y, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x;
          const dy = e.clientY - d.y;
          if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
          if (d.moved) setView({ k: v.k, x: d.vx + dx, y: d.vy + dy });
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (d && !d.moved) {
            const id = hit(e.clientX, e.clientY);
            onSelect(id);
            if (id) onOpen(id);
          }
        }}
      />
      <span id="graph-keys" className="sr-only">
        Arrow keys move between linked ideas, Enter opens one, plus and minus zoom, 0 fits the graph. The list view reads every idea.
      </span>
      <div className="absolute right-2 bottom-2 flex gap-1">
        <Button variant="outline" size="icon" className="size-7" aria-label="Zoom in" onClick={() => zoomBy(1.25)}>
          <Plus size={14} aria-hidden />
        </Button>
        <Button variant="outline" size="icon" className="size-7" aria-label="Zoom out" onClick={() => zoomBy(0.8)}>
          <Minus size={14} aria-hidden />
        </Button>
        <Button variant="outline" size="icon" className="size-7" aria-label="Fit graph" onClick={fit}>
          <ArrowsIn size={14} aria-hidden />
        </Button>
      </div>
    </div>
  );
}
