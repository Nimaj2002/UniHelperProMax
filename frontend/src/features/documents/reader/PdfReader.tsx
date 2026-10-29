/**
 * The built-in PDF reader: EmbedPDF's complete viewer UI (toolbar, sidebar, thumbnails, search,
 * annotation tools) for one document tab. PDFium's WebAssembly is served from our own origin and
 * the CDN font fallback is off. Annotations made with its tools are saved next to the PDF
 * (viewerAnnotations.ts). Lazy-loaded; one per open document tab.
 */
import { EmbedPdfContainer, type PDFViewerConfig, type PluginRegistry } from "@embedpdf/react-pdf-viewer";
import wasmUrl from "@embedpdf/pdfium/pdfium.wasm?url";
import { useEffect, useRef } from "react";
import { useResolvedTheme } from "@/app/theme";
import { documentFileUrl, type Document } from "../api";
import { syncViewerAnnotations } from "./viewerAnnotations";
import { syncViewerPosition } from "./viewerPosition";

const TAG = "uh-pdf-viewer";

/**
 * EmbedPDF's <embedpdf-container> tears its viewer down when it leaves the page and builds a new
 * one (PDF reloaded, page, zoom and unsaved state lost) when it comes back. The workspace moves a
 * reader's element between panes and the parking area on every tab switch (research R11), so
 * this element waits a microtask before tearing down and skips it when it is back by then.
 * (A subclass: lifecycle callbacks are read when an element is defined, not later.)
 */
function defineViewerElement() {
  if (customElements.get(TAG)) return;
  class KeptViewer extends EmbedPdfContainer {
    private alive = false;
    connectedCallback() {
      if (this.alive) return; // moved: the viewer is still there
      this.alive = true;
      super.connectedCallback();
    }
    disconnectedCallback() {
      queueMicrotask(() => {
        if (this.isConnected) return;
        this.alive = false;
        super.disconnectedCallback();
      });
    }
  }
  customElements.define(TAG, KeptViewer);
}
defineViewerElement();

interface Props {
  document: Document;
  visible: boolean;
  onEscape: () => void;
}

export default function PdfReader({ document: doc }: Props) {
  const theme = useResolvedTheme();
  const host = useRef<HTMLDivElement>(null);

  // one viewer per document and theme; its annotations are restored, saved as they change and
  // sent when it closes
  useEffect(() => {
    const target = host.current;
    if (!target) return;
    const config: PDFViewerConfig = {
      src: documentFileUrl(doc.id),
      // absolute: the worker runs from a blob: URL, which relative URLs can't resolve against
      wasmUrl: new URL(wasmUrl, window.location.href).href,
      fontFallback: null,
      tabBar: "never",
      theme: { preference: theme },
    };
    const viewer = document.createElement(TAG) as EmbedPdfContainer;
    viewer.style.display = "block";
    viewer.style.height = "100%";
    viewer.config = config;
    target.appendChild(viewer);
    let stopSync: (() => void) | null = null;
    let stopPosition: (() => void) | null = null;
    let live = true;
    void viewer.registry.then((registry: PluginRegistry) => {
      if (!live) return;
      stopSync = syncViewerAnnotations(registry, doc.id);
      stopPosition = syncViewerPosition(registry, doc.id);
    });
    return () => {
      live = false;
      stopSync?.();
      stopPosition?.();
      viewer.remove();
    };
  }, [doc.id, theme]);

  return <div ref={host} className="h-full w-full" />;
}
