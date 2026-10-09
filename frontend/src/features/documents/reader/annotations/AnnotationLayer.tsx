/**
 * The user's annotations drawn over pdf.js pages (007 FR-025–FR-034, research R6): one overlay per
 * rendered page (re-attached on every `pagerendered`, since pdf.js clears unknown children when it
 * evicts a page), geometry converted from page space with the page's viewport, and the tools:
 * Draw (pointer strokes, simplified), Text (a box typed in place), Comment (a marker with a note)
 * and Highlight (the current text selection).
 */
import { useCallback, useEffect, useImperativeHandle, useRef, useState, type PointerEvent, type Ref } from "react";
import { createPortal } from "react-dom";
import type { EventBus } from "../pdfjs";
import { AnnotationItem, NoteEditor } from "./AnnotationItem";
import { bounds } from "./edit";
import { invert, pageToViewport, rectToViewport, selectionToRects, viewportToPage, type Matrix, type Point } from "./geometry";
import type { AnnotationModel } from "./model";
import { simplify } from "./simplify";
import { INK_WIDTH, TEXTBOX_SIZE, type Tool } from "./tools";
import { colorOf, type Annotation, type ColorId } from "./types";

interface PageInfo {
  el: HTMLDivElement;
  div: HTMLElement;
  transform: Matrix;
  scale: number;
  width: number;
  height: number;
}

interface PageViewLike {
  id: number;
  div: HTMLElement;
  viewport: { transform: number[]; scale: number; width: number; height: number };
}

/** Text nodes of `root` inside `range`: their screen rects and text (element boxes excluded). */
function selectedText(range: Range, root: Element): { rects: DOMRect[]; text: string } {
  const rects: DOMRect[] = [];
  let text = "";
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!range.intersectsNode(n)) continue;
    const part = document.createRange();
    const len = (n as Text).length;
    part.setStart(n, n === range.startContainer ? range.startOffset : 0);
    part.setEnd(n, n === range.endContainer ? range.endOffset : len);
    if (part.collapsed) continue;
    rects.push(...part.getClientRects());
    text += part.toString();
  }
  return { rects, text: text.replace(/\s+/g, " ").trim() };
}

interface Props {
  bus: EventBus | null;
  model: AnnotationModel;
  tool: Tool;
  color: ColorId;
  darkPages: boolean;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onEscape: () => void;
  ref?: Ref<AnnotationLayerHandle>;
}

export interface AnnotationLayerHandle {
  /** Highlight the current text selection: one highlight per page it covers, one undo step. */
  highlightSelection(): void;
  /** Keyboard path for Text/Comment: open an editor in the middle of the visible part of `page`. */
  placeOnPage(page: number): void;
}

export function AnnotationLayer({ bus, model, tool, color, darkPages, selected, onSelect, onEscape, ref }: Props) {
  const [pages, setPages] = useState<Map<number, PageInfo>>(new Map());
  const [placement, setPlacement] = useState<{ page: number; at: Point; n: number } | null>(null);

  const overlays = useRef(new Map<number, HTMLDivElement>());

  useEffect(() => {
    if (!bus) return;
    const made = overlays.current;
    const onRendered = (e: { source: PageViewLike; pageNumber: number; isDetailView?: boolean }) => {
      if (e.isDetailView) return;
      const { div, viewport } = e.source;
      let el = made.get(e.pageNumber);
      if (!el) {
        el = document.createElement("div");
        el.className = "uh-annot-page";
        made.set(e.pageNumber, el);
      }
      if (el.parentNode !== div) div.append(el);
      const info: PageInfo = { el, div, transform: viewport.transform as unknown as Matrix, scale: viewport.scale, width: viewport.width, height: viewport.height };
      setPages((prev) => new Map(prev).set(e.pageNumber, info));
    };
    bus.on("pagerendered", onRendered);
    return () => {
      bus.off("pagerendered", onRendered);
      setPages(new Map());
      made.forEach((el) => el.remove());
      made.clear();
    };
  }, [bus]);

  useImperativeHandle(ref, () => ({
    highlightSelection() {
      const sel = document.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return;
      const range = sel.getRangeAt(0);
      const created: Omit<Annotation, "id">[] = [];
      for (const [page, info] of pages) {
        const textLayer = info.div.querySelector(".textLayer");
        if (!textLayer || !range.intersectsNode(textLayer)) continue;
        const { rects, text } = selectedText(range, textLayer);
        const origin = info.div.getBoundingClientRect();
        const quads = selectionToRects(rects, { left: origin.left + info.div.clientLeft, top: origin.top + info.div.clientTop }, invert(info.transform));
        if (quads.length) created.push({ type: "highlight", page, color, rects: quads, quoted: text.slice(0, 2000) });
      }
      if (!created.length) return;
      model.createAll(created.sort((x, y) => x.page - y.page));
      sel.removeAllRanges();
    },
    placeOnPage(page: number) {
      const info = pages.get(page);
      const scroller = info?.div.closest(".uh-reader-pages");
      if (!info || !scroller) return;
      const p = info.div.getBoundingClientRect();
      const v = scroller.getBoundingClientRect();
      const y = (Math.max(p.top, v.top) + Math.min(p.bottom, v.bottom)) / 2 - p.top;
      setPlacement((prev) => ({ page, at: viewportToPage(invert(info.transform), [p.width / 2 - 40, y]), n: (prev?.n ?? 0) + 1 }));
    },
  }));


  return [...pages].map(([page, info]) =>
    createPortal(
      <PageOverlay
        key={`${page}`}
        page={page}
        info={info}
        items={model.onPage(page)}
        model={model}
        tool={tool}
        color={color}
        darkPages={darkPages}
        selected={selected}
        onSelect={onSelect}
        onEscape={onEscape}
        placeAt={placement?.page === page ? placement : null}
      />,
      info.el,
      `annotations-${page}`,
    ),
  );
}

interface PageProps {
  page: number;
  info: PageInfo;
  items: Annotation[];
  model: AnnotationModel;
  tool: Tool;
  color: ColorId;
  darkPages: boolean;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onEscape: () => void;
  placeAt: { at: Point; n: number } | null;
}

type Draft = { kind: "ink"; points: Point[] } | { kind: "text" | "comment"; at: Point };

function PageOverlay({ page, info, items, model, tool, color, darkPages, selected, onSelect, onEscape, placeAt }: PageProps) {
  const { transform, scale, width, height } = info;
  const inverse = invert(transform);
  const [draft, setDraft] = useState<Draft | null>(null);
  const drawing = tool === "draw" || tool === "text" || tool === "comment";
  // a keyboard placement opens the editor (state adjusted while rendering, once per request)
  const [placed, setPlaced] = useState(0);
  if (placeAt && placeAt.n !== placed && (tool === "text" || tool === "comment")) {
    setPlaced(placeAt.n);
    setDraft({ kind: tool, at: placeAt.at });
  }

  const pagePoint = useCallback(
    (e: PointerEvent<HTMLElement>): Point => {
      const r = e.currentTarget.getBoundingClientRect();
      return viewportToPage(inverse, [e.clientX - r.left, e.clientY - r.top]);
    },
    [inverse],
  );

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (!drawing) {
      if (e.target === e.currentTarget) onSelect(null);
      return;
    }
    if (draft && draft.kind !== "ink") return; // an editor is open: it saves on blur
    e.preventDefault();
    const p = pagePoint(e);
    if (tool === "draw") {
      e.currentTarget.setPointerCapture(e.pointerId);
      setDraft({ kind: "ink", points: [p] });
    } else setDraft({ kind: tool === "text" ? "text" : "comment", at: p });
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (draft?.kind !== "ink") return;
    const p = pagePoint(e);
    setDraft({ kind: "ink", points: [...draft.points, p] });
  };
  const onPointerUp = () => {
    if (draft?.kind !== "ink") return;
    const points = simplify(draft.points);
    setDraft(null);
    if (points.length) model.create({ type: "ink", page, color, width: INK_WIDTH, strokes: [points] });
  };

  // items in reading order: top to bottom, then left to right
  const ordered = [...items].sort((x, y) => {
    const bx = rectToViewport(transform, bounds(x));
    const by = rectToViewport(transform, bounds(y));
    return bx.top - by.top || bx.left - by.left;
  });
  const fill = (id: ColorId) => colorOf(id).fill;
  const ink = (id: ColorId) => colorOf(id).ink;
  const path = (pts: Point[]) => pts.map((p) => pageToViewport(transform, p).join(",")).join(" ");

  return (
    <div
      className="uh-annot-surface"
      data-tool={tool}
      data-drawing={drawing || undefined}
      style={{ width, height }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <svg aria-hidden width={width} height={height} className="uh-annot-svg">
        {items.map((a) =>
          a.type === "highlight" ? (
            <g key={a.id} className={darkPages ? "uh-annot-hl-dark" : "uh-annot-hl"} fill={fill(a.color)}>
              {a.rects?.map((r, i) => {
                const b = rectToViewport(transform, r);
                return <rect key={i} x={b.left} y={b.top} width={b.width} height={b.height} />;
              })}
            </g>
          ) : a.type === "ink" ? (
            a.strokes?.map((s, i) => (
              <polyline key={`${a.id}-${i}`} points={path(s)} fill="none" stroke={ink(a.color)} strokeWidth={(a.width ?? INK_WIDTH) * scale} strokeLinecap="round" strokeLinejoin="round" />
            ))
          ) : null,
        )}
        {draft?.kind === "ink" && <polyline points={path(draft.points)} fill="none" stroke={ink(color)} strokeWidth={INK_WIDTH * scale} strokeLinecap="round" strokeLinejoin="round" />}
      </svg>
      {ordered.map((a) => (
        <AnnotationItem
          key={a.id}
          a={a}
          model={model}
          transform={transform}
          inverse={inverse}
          scale={scale}
          interactive={!drawing}
          selected={selected === a.id}
          onSelect={onSelect}
          onEscape={onEscape}
        />
      ))}
      {draft && draft.kind !== "ink" && (() => {
        const [x, y] = pageToViewport(transform, draft.at);
        const [w, h] = TEXTBOX_SIZE;
        return (
          <NoteEditor
            initial=""
            label={draft.kind === "text" ? `New text box on page ${page}` : `New comment on page ${page}`}
            className={draft.kind === "text" ? "absolute resize-none p-1 leading-tight" : "absolute h-24 w-64 resize-none"}
            style={draft.kind === "text" ? { left: x, top: y, width: w * scale, minHeight: h * scale, fontSize: 12 * scale, color: ink(color) } : { left: x + 14, top: y - 12 }}
            onDone={(text) => {
              setDraft(null);
              if (!text.trim()) return;
              if (draft.kind === "text") {
                const [px, py] = draft.at;
                model.create({ type: "textbox", page, color, box: [px, py - h, px + w, py], text });
              } else model.create({ type: "comment", page, color, anchor: draft.at, text });
            }}
          />
        );
      })()}
    </div>
  );
}
