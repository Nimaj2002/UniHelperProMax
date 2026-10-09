/**
 * The built-in PDF reader (007 FR-015–FR-024, research R1/R3/R11): pdf.js `PDFViewer` in
 * continuous vertical scroll, its own links and form/annotation display (no scripting, no pdf.js
 * editing), our toolbar, and "dark pages". Lazy-loaded with pdf.js; one per open document tab.
 */
import "pdfjs-dist/web/pdf_viewer.css";
import "./reader.css";
import { useQueryClient } from "@tanstack/react-query";
import { AnnotationEditorType, AnnotationMode, type PDFDocumentProxy } from "pdfjs-dist";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePreferences, useUpdatePreferences } from "@/features/sessions/api";
import { documentFileUrl, documentKey, documentsKey, setPageCount, type Document } from "../api";
import { EventBus, LinkTarget, loadDocument, PDFFindController, PDFLinkService, PDFViewer } from "./pdfjs";
import { DOC_ATTACH, DOC_DETACH } from "./events";
import { ReaderMessage, PROTECTED_MESSAGE } from "./ReaderMessage";
import { AnnotationLayer, type AnnotationLayerHandle } from "./annotations/AnnotationLayer";
import { AnnotationToolbar } from "./annotations/AnnotationToolbar";
import type { Tool } from "./annotations/tools";
import type { ColorId } from "./annotations/types";
import { useAnnotations } from "./annotations/useAnnotations";
import { ReaderToolbar } from "./ReaderToolbar";
import { SearchBox, type SearchResult } from "./SearchBox";
import { usePosition } from "./usePosition";
import { stepZoom } from "./zoom";

interface Location {
  page: number;
  top: number;
  left: number;
}
type ScaleMode = "page-width" | number;

const PAGE_ERROR = "This page couldn't be shown.";
const NO_RESULT: SearchResult = { state: null, current: 0, total: 0, noText: false };

function token(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function showPageError(pageDiv: HTMLElement) {
  if (pageDiv.querySelector(".uh-page-error")) return;
  const p = document.createElement("p");
  p.className = "uh-page-error";
  p.setAttribute("role", "status");
  p.textContent = PAGE_ERROR;
  pageDiv.append(p);
}

/** True when no page has any text (a scanned document): search can't find anything. */
async function hasNoText(pdf: PDFDocumentProxy): Promise<boolean> {
  for (let i = 1; i <= pdf.numPages; i++) {
    const content = await (await pdf.getPage(i)).getTextContent();
    if (content.items.some((it) => "str" in it && it.str.trim())) return false;
  }
  return true;
}

interface Props {
  document: Document;
  visible: boolean;
  onEscape: () => void;
}

export default function PdfReader({ document: doc, visible, onEscape }: Props) {
  const qc = useQueryClient();
  const prefs = usePreferences();
  const updatePrefs = useUpdatePreferences();
  const darkPages = prefs.data?.readerDarkPages ?? false;

  const container = useRef<HTMLDivElement>(null);
  const viewerEl = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<PDFViewer | null>(null);
  const location = useRef<Location | null>(null);
  const scaleMode = useRef<ScaleMode>("page-width");
  /** In a pane right now; locations are only recorded while shown. */
  const shown = useRef(visible);

  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [failure, setFailure] = useState<"protected" | "unreadable" | null>(null);
  const [page, setPage] = useState(1);
  const [scale, setScale] = useState(1);
  const [fitWidth, setFitWidth] = useState(true);
  const busRef = useRef<EventBus | null>(null);
  const [bus, setBus] = useState<EventBus | null>(null);
  const [search, setSearch] = useState<{ open: boolean; focusKey: number }>({ open: false, focusKey: 0 });
  const [result, setResult] = useState<SearchResult>(NO_RESULT);
  /** Pages laid out: navigation and zoom act only from here on. */
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");

  // ---- load the PDF once per tab (Range requests, research R2) ----------------------------
  useEffect(() => {
    let live = true;
    const task = loadDocument(documentFileUrl(doc.id));
    task.promise.then(
      (p) => live && setPdf(p),
      (err: unknown) => {
        if (!live) return;
        const name = (err as { name?: string } | null)?.name;
        setFailure(name === "PasswordException" ? "protected" : "unreadable");
      },
    );
    return () => {
      live = false;
      void task.destroy();
    };
  }, [doc.id]);

  // ---- report the page count once (data-model: Document.pageCount) ------------------------
  const reported = useRef(false);
  useEffect(() => {
    if (!pdf || reported.current) return;
    reported.current = true;
    if (doc.pageCount === pdf.numPages) return;
    setPageCount(doc.id, doc.version, pdf.numPages).then(
      (d) => {
        qc.setQueryData(documentKey(d.id), d);
        void qc.invalidateQueries({ queryKey: documentsKey(d.sessionKey) });
      },
      () => {}, // informational only; reported again next time
    );
  }, [pdf, doc.id, doc.pageCount, doc.version, qc]);

  const scrollTo = useCallback((viewer: PDFViewer, at: Location) => {
    viewer.scrollPageIntoView({ pageNumber: at.page, destArray: [null, { name: "XYZ" }, at.left, at.top, null], allowNegativeOffset: true });
  }, []);

  // ---- the viewer; re-created when dark pages change (FR-022a), keeping page/zoom/scroll ---
  useEffect(() => {
    const c = container.current;
    const v = viewerEl.current;
    if (!pdf || !c || !v) return;
    const eventBus = new EventBus();
    const linkService = new PDFLinkService({ eventBus, externalLinkTarget: LinkTarget.BLANK, externalLinkRel: "noopener noreferrer nofollow" });
    const findController = new PDFFindController({ eventBus, linkService });
    const viewer = new PDFViewer({
      container: c,
      viewer: v,
      eventBus,
      linkService,
      findController,
      textLayerMode: 1,
      annotationMode: AnnotationMode.ENABLE, // links and form fields display (FR-020)
      annotationEditorMode: AnnotationEditorType.DISABLE, // our own layer edits (research R4)
      pageColors: darkPages ? { background: token("--reader-page-dark-bg"), foreground: token("--reader-page-dark-fg") } : undefined,
    });
    linkService.setViewer(viewer);
    viewerRef.current = viewer;
    const restore = location.current;
    eventBus.on("pagesinit", () => {
      // a hidden reader (tab not shown) can't scroll: its view is applied when a pane shows it
      if (c.offsetParent) {
        viewer.currentScaleValue = String(scaleMode.current);
        if (restore) scrollTo(viewer, restore);
      }
      setReady(true);
    });
    // a replaced viewer (dark pages toggled) may still emit while it is torn down: ignore it
    const current = () => viewerRef.current === viewer;
    eventBus.on("pagechanging", (e: { pageNumber: number }) => current() && setPage(e.pageNumber));
    eventBus.on("scalechanging", (e: { scale: number }) => current() && setScale(e.scale));
    eventBus.on("updateviewarea", (e: { location: { pageNumber: number; top: number; left: number } }) => {
      if (current() && shown.current) location.current = { page: e.location.pageNumber, top: e.location.top, left: e.location.left };
    });
    eventBus.on("pagerendered", (e: { error: unknown; source: { div: HTMLElement } }) => {
      if (e.error) showPageError(e.source.div);
    });
    // search (FR-018): counts and the current match from the find controller (research R13)
    type Counts = { current: number; total: number };
    eventBus.on("updatefindmatchescount", (e: { matchesCount: Counts }) => current() && setResult((r) => ({ ...r, ...e.matchesCount })));
    eventBus.on("updatefindcontrolstate", (e: { state: number; matchesCount: Counts }) => {
      if (!current()) return;
      setResult((r) => ({ ...r, state: e.state, ...e.matchesCount }));
      if (e.state === 1) void hasNoText(pdf).then((noText) => setResult((r) => ({ ...r, noText })));
    });
    viewer.setDocument(pdf);
    linkService.setDocument(pdf);
    busRef.current = eventBus;
    setBus(eventBus);
    setResult(NO_RESULT);
    return () => {
      busRef.current = null;
      setBus(null);
      setReady(false);
      viewerRef.current = null;
      viewer.setDocument(null as unknown as PDFDocumentProxy);
      linkService.setDocument(null);
      v.replaceChildren();
    };
  }, [pdf, darkPages, scrollTo]);

  // ---- shown again (tab switch, other pane): restore the view (research R11) --------------
  // A pane borrows the tab's host element; moving it resets the scroll offset, so the location
  // is frozen on detach and restored on attach.
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = root.current?.closest<HTMLElement>("[data-doc-host]");
    if (!host) return;
    let frame = 0;
    const restore = (at: Location | null) => {
      const viewer = viewerRef.current;
      if (!viewer?.pagesCount || !container.current?.offsetParent) return;
      viewer.currentScaleValue = String(scaleMode.current);
      if (at) scrollTo(viewer, at);
      viewer.update();
    };
    const detach = () => {
      shown.current = false;
    };
    const attach = () => {
      shown.current = true;
      const at = location.current;
      restore(at);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => restore(at)); // again once layout has settled
    };
    host.addEventListener(DOC_DETACH, detach);
    host.addEventListener(DOC_ATTACH, attach);
    return () => {
      cancelAnimationFrame(frame);
      host.removeEventListener(DOC_DETACH, detach);
      host.removeEventListener(DOC_ATTACH, attach);
    };
  }, [failure, scrollTo]);

  // fit width follows the pane width (split divider, window resize)
  useEffect(() => {
    const c = container.current;
    if (!c) return;
    const ro = new ResizeObserver(() => {
      const viewer = viewerRef.current;
      if (shown.current && viewer?.pagesCount && c.offsetParent && scaleMode.current === "page-width") viewer.currentScaleValue = "page-width";
    });
    ro.observe(c);
    return () => ro.disconnect();
  }, []);

  // ---- actions ------------------------------------------------------------------------------
  const pageCount = pdf?.numPages ?? doc.pageCount ?? 0;
  const goTo = (n: number) => {
    const viewer = viewerRef.current;
    if (!viewer?.pagesCount) return;
    viewer.currentPageNumber = Math.min(viewer.pagesCount, Math.max(1, n));
  };
  const setZoom = (next: ScaleMode) => {
    const viewer = viewerRef.current;
    if (!viewer?.pagesCount) return;
    scaleMode.current = next;
    setFitWidth(next === "page-width");
    viewer.currentScaleValue = String(next);
  };
  const zoom = (dir: 1 | -1) => setZoom(stepZoom(viewerRef.current?.currentScale ?? scale, dir));
  const toggleDarkPages = () => updatePrefs.mutate({ readerDarkPages: !darkPages });
  const find = (query: string, { again, previous }: { again: boolean; previous: boolean }) => {
    if (!query.trim()) setResult(NO_RESULT);
    busRef.current?.dispatch("find", {
      source: null,
      type: again ? "again" : "",
      query,
      caseSensitive: false,
      entireWord: false,
      highlightAll: true,
      findPrevious: previous,
      matchDiacritics: false,
    });
  };
  const openSearch = () => setSearch((s) => ({ open: true, focusKey: s.focusKey + 1 }));
  const closeSearch = () => {
    busRef.current?.dispatch("findbarclose", { source: null });
    setSearch((s) => ({ ...s, open: false }));
    setResult(NO_RESULT);
    container.current?.focus();
  };
  usePosition({ documentId: doc.id, active: ready && visible, page, pageCount, goTo });

  // ---- annotations (US6) --------------------------------------------------------------------
  const ann = useAnnotations(doc.id);
  const [tool, setTool] = useState<Tool>("select");
  const [color, setColor] = useState<ColorId>("yellow");
  const [selected, setSelected] = useState<string | null>(null);
  const layer = useRef<AnnotationLayerHandle>(null);
  const [hasSelection, setHasSelection] = useState(false);
  useEffect(() => {
    const onChange = () => {
      const sel = document.getSelection();
      setHasSelection(!!sel && !sel.isCollapsed && !!container.current?.contains(sel.anchorNode) && sel.toString().trim().length > 0);
    };
    document.addEventListener("selectionchange", onChange);
    return () => document.removeEventListener("selectionchange", onChange);
  }, []);
  // FR-032: whether there is text to highlight, for the document and the current page
  const [documentHasText, setDocumentHasText] = useState<boolean | null>(null);
  const [textPages, setTextPages] = useState<Record<number, boolean>>({});
  useEffect(() => {
    if (!pdf) return;
    let live = true;
    void hasNoText(pdf).then((none) => live && setDocumentHasText(!none));
    return () => {
      live = false;
    };
  }, [pdf]);
  useEffect(() => {
    if (!pdf || page in textPages) return;
    let live = true;
    void pdf
      .getPage(page)
      .then((p) => p.getTextContent())
      .then((c) => live && setTextPages((t) => ({ ...t, [page]: c.items.some((it) => "str" in it && it.str.trim()) })));
    return () => {
      live = false;
    };
  }, [pdf, page, textPages]);
  const pickColor = (c: ColorId) => {
    setColor(c);
    if (selected) ann.model?.update(selected, { color: c });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const inField = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
    const mod = e.ctrlKey || e.metaKey;
    let handled = true;
    if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "f") openSearch();
    else if (e.key === "Escape" && search.open && e.target instanceof HTMLInputElement && e.target.type === "search") closeSearch();
    else if (mod && !e.altKey && (e.key === "+" || e.key === "=")) zoom(1);
    else if (mod && !e.altKey && e.key === "-") zoom(-1);
    else if (mod && !e.altKey && e.key === "0") setZoom(1);
    else if (e.key === "Escape" && e.target instanceof HTMLTextAreaElement) handled = false; // the editor saves
    else if (e.key === "Escape" && tool !== "select") setTool("select");
    else if (e.key === "Enter" && (tool === "text" || tool === "comment") && e.target === container.current) layer.current?.placeOnPage(page); // keyboard path for Text/Comment
    else if (e.key === "Escape") onEscape();
    else if (inField) handled = false;
    else if (mod && !e.altKey && e.key.toLowerCase() === "z") void (e.shiftKey ? ann.model?.redo() : ann.model?.undo());
    else if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "y") ann.model?.redo();
    else if (mod || e.altKey) handled = false;
    else if (e.key === "PageDown") goTo(page + 1);
    else if (e.key === "PageUp") goTo(page - 1);
    else if (e.key === "Home") goTo(1);
    else if (e.key === "End") goTo(pageCount);
    else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  // reader keys while focus is anywhere inside it (contracts/ui-reader.md)
  const keys = useRef(onKeyDown);
  useEffect(() => {
    keys.current = onKeyDown;
  });
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const listener = (e: globalThis.KeyboardEvent) => keys.current(e);
    el.addEventListener("keydown", listener);
    return () => el.removeEventListener("keydown", listener);
  }, [failure]);

  if (failure === "protected") return <ReaderMessage>{PROTECTED_MESSAGE}</ReaderMessage>;
  if (failure === "unreadable") return <ReaderMessage tone="danger">This PDF couldn't be read.</ReaderMessage>;

  return (
    <div ref={root} role="region" aria-label={`${doc.name} — PDF`} className="uh-reader flex h-full min-h-0 flex-col" data-dark-pages={darkPages || undefined}>
      <ReaderToolbar
        ready={ready}
        page={page}
        pageCount={pageCount}
        scale={scale}
        fitWidth={fitWidth}
        darkPages={darkPages}
        onGoTo={goTo}
        onMessage={setMessage}
        onZoom={zoom}
        onFitWidth={() => setZoom("page-width")}
        onToggleDarkPages={toggleDarkPages}
      />
      <AnnotationToolbar
        tool={tool}
        onTool={(t) => {
          setTool(t);
          setSelected(null);
        }}
        canHighlight={hasSelection}
        onHighlight={() => {
          layer.current?.highlightSelection();
          setHasSelection(false);
        }}
        documentHasText={documentHasText}
        pageHasText={textPages[page] ?? null}
        color={color}
        onColor={pickColor}
        canUndo={ann.model?.canUndo ?? false}
        canRedo={ann.model?.canRedo ?? false}
        onUndo={() => ann.model?.undo()}
        onRedo={() => ann.model?.redo()}
        status={ann.status}
        disabled={!ann.ready || !ready}
      />
      {search.open && <SearchBox result={result} onSearch={find} onClose={closeSearch} focusKey={search.focusKey} />}
      <p className="sr-only" aria-live="polite" data-testid="reader-status">
        {pdf ? `Page ${page} of ${pageCount}. ${message}` : ""}
      </p>
      <div className="relative min-h-0 flex-1">
        {!pdf && <ReaderMessage>Opening document…</ReaderMessage>}
        {/* the scrolling page area takes focus so keyboard users can scroll it (WCAG 2.1.1) */}
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
        <div ref={container} tabIndex={0} aria-label="Pages" aria-keyshortcuts={tool === "text" || tool === "comment" ? "Enter" : undefined} className="uh-reader-pages absolute inset-0 overflow-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
          <div ref={viewerEl} className="pdfViewer" />
        </div>
      </div>
      {ann.model && (
        <AnnotationLayer
          bus={bus}
          model={ann.model}
          tool={tool}
          color={color}
          darkPages={darkPages}
          selected={selected}
          onSelect={setSelected}
          ref={layer}
          onEscape={onEscape}
        />
      )}
    </div>
  );
}
