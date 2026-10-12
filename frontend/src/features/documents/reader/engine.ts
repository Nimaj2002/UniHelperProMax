/**
 * EmbedPDF setup (007 research R1–R3): PDFium (WebAssembly) runs in a Web Worker, its binary is
 * served from our own origin, and the CDN font fallback is off, so the reader never loads
 * anything from a third party. The CSP allows 'wasm-unsafe-eval' and blob: workers for it.
 */
import type { PdfEngine } from "@embedpdf/models";
import { createPdfiumEngine } from "@embedpdf/engines/pdfium-worker-engine";
import wasmUrl from "@embedpdf/pdfium/pdfium.wasm?url";

let engine: PdfEngine<Blob> | null = null;

/** One PDFium worker for every open document, started ahead of the first one (SC-003). */
export function sharedEngine(): PdfEngine<Blob> {
  // absolute: the worker runs from a blob: URL, which relative URLs can't resolve against
  engine ??= createPdfiumEngine(new URL(wasmUrl, window.location.href).href, { fontFallback: null });
  return engine;
}
