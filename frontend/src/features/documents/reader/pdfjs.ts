/**
 * pdf.js setup (007 research R1–R3): the worker and every runtime asset come from our own
 * origin, WebAssembly decoders are replaced by their JS fallbacks (no 'wasm-unsafe-eval' in the
 * CSP), PDF scripting and XFA are off, and documents load progressively with Range requests.
 */
import { getDocument, GlobalWorkerOptions, PDFWorker, type PDFDocumentLoadingTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
// the viewer reads `globalThis.pdfjsLib`, set by "pdfjs-dist" above: keep this import after it
export { EventBus, LinkTarget, PDFFindController, PDFLinkService, PDFViewer } from "pdfjs-dist/web/pdf_viewer.mjs";

GlobalWorkerOptions.workerSrc = workerUrl;

const ASSETS = "/pdfjs";

let worker: PDFWorker | null = null;

/** One pdf.js worker for every open document, started ahead of the first one (SC-003). */
export function sharedWorker(): PDFWorker {
  worker ??= new PDFWorker();
  return worker;
}

export function loadDocument(url: string): PDFDocumentLoadingTask {
  return getDocument({
    url,
    worker: sharedWorker(),
    // Stream the file while range requests fetch what the first page needs (SC-003). Range-only
    // loading (disableStream) was measured slower: pdf.js's last-page check walks the whole page
    // tree, which in a typical PDF means nearly every chunk as ~100 separate requests.
    disableAutoFetch: true,
    disableStream: false,
    rangeChunkSize: 262144,
    useWasm: false,
    cMapUrl: `${ASSETS}/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${ASSETS}/standard_fonts/`,
    wasmUrl: `${ASSETS}/wasm/`,
    iccUrl: `${ASSETS}/iccs/`,
    enableXfa: false,
  });
}
