/**
 * The editor's side of the sandboxed renderer frame (research R6,
 * contracts/diagram-sandbox-protocol.md). The frame is created the first time a diagram is drawn
 * (FR-027), handles one request at a time, and is removed and recreated when a drawing takes
 * longer than 5 seconds (FR-021). Its SVG is cleaned before it reaches the page (FR-032).
 */
import type { DOMPurify as Purifier } from "dompurify";
import { MAX_SOURCE } from "./katexLoader";
import { LruCache } from "./renderCache";
import type { ThemeVariables } from "./themeVars";

export const RENDER_TIMEOUT_MS = 5_000;
/** Tests may shorten the time limit. */
let timeoutMs = RENDER_TIMEOUT_MS;
export function setRenderTimeoutForTests(ms: number) {
  timeoutMs = ms;
}
if (import.meta.env.DEV) (window as unknown as { __uhSetRenderTimeout?: (ms: number) => void }).__uhSetRenderTimeout = setRenderTimeoutForTests;

export interface DiagramRequest {
  source: string;
  themeVariables: ThemeVariables;
  themeKey: string;
  useOwnTheme: boolean;
  background: string;
  reducedMotion: boolean;
}

export type DiagramResult =
  | { kind: "drawn"; svg: string; width: number; height: number }
  | { kind: "error"; message: string; line?: number }
  | { kind: "timedOut" }
  | { kind: "tooLarge" }
  | { kind: "empty" };

interface Job {
  id: string;
  request: DiagramRequest;
  resolve: (r: DiagramResult) => void;
}

type FrameMessage =
  | { v: 1; type: "ready" }
  | { v: 1; type: "rendered"; id: string; svg: string; width: number; height: number }
  | { v: 1; type: "failed"; id: string; message: string; line?: number };

const cache = new LruCache<string, DiagramResult>(300);

let frame: HTMLIFrameElement | null = null;
let ready: Promise<void> | null = null;
const queue: Job[] = [];
let active: { job: Job; timer?: ReturnType<typeof setTimeout> } | null = null;
let counter = 0;
let listening = false;

// loaded with the frame, i.e. with the first diagram (FR-027)
let purifier: Promise<Purifier> | null = null;
const loadPurifier = () => (purifier ??= import("dompurify").then((m) => m.default));

function sanitize(DOMPurify: Purifier, svg: string): string {
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    for (const attr of ["href", "xlink:href"]) {
      const v = node.getAttribute(attr);
      if (v !== null && !v.startsWith("#")) node.removeAttribute(attr);
    }
  });
  try {
    return DOMPurify.sanitize(svg, {
      USE_PROFILES: { svg: true, svgFilters: true },
      ADD_TAGS: ["style"],
      // link wrappers go too (their text stays): a drawn diagram never opens anything
      FORBID_TAGS: ["foreignObject", "script", "iframe", "image", "a"],
      FORBID_ATTR: ["onclick", "onload", "onerror", "onmouseover"],
    });
  } finally {
    DOMPurify.removeHook("afterSanitizeAttributes");
  }
}

async function onMessage(event: MessageEvent) {
  if (!frame || event.source !== frame.contentWindow) return;
  const msg = event.data as FrameMessage;
  if (msg?.v !== 1 || msg.type === "ready" || !active || msg.id !== active.job.id) return;
  const { job, timer } = active;
  clearTimeout(timer);
  active = null;
  next();
  const result: DiagramResult =
    msg.type === "rendered"
      ? { kind: "drawn", svg: sanitize(await loadPurifier(), msg.svg), width: msg.width, height: msg.height }
      : { kind: "error", message: msg.message, line: msg.line };
  cache.set(keyOf(job.request), result);
  job.resolve(result);
}

function ensureFrame(): Promise<void> {
  if (frame && ready) return ready;
  void loadPurifier();
  if (!listening) {
    window.addEventListener("message", (e) => void onMessage(e));
    listening = true;
  }
  const el = document.createElement("iframe");
  el.setAttribute("sandbox", "allow-scripts");
  el.setAttribute("aria-hidden", "true");
  el.tabIndex = -1;
  el.title = "Diagram renderer";
  el.src = "/diagram-sandbox.html";
  // laid out (text must be measured) but off-screen and invisible
  Object.assign(el.style, { position: "fixed", left: "-20000px", top: "0", width: "1600px", height: "1200px", border: "0", visibility: "hidden", pointerEvents: "none" });
  frame = el;
  ready = new Promise<void>((resolve) => {
    const onReady = (event: MessageEvent) => {
      if (event.source === el.contentWindow && (event.data as FrameMessage)?.type === "ready") {
        window.removeEventListener("message", onReady);
        resolve();
      }
    };
    window.addEventListener("message", onReady);
  });
  document.body.append(el);
  return ready;
}

function dropFrame() {
  frame?.remove();
  frame = null;
  ready = null;
}

function next() {
  if (active || queue.length === 0) return;
  const job = queue.shift()!;
  // taken now, so no other job starts while the frame loads
  active = { job };
  void ensureFrame().then(() => {
    if (active?.job !== job) return;
    active.timer = setTimeout(() => {
      if (active?.job !== job) return;
      active = null;
      dropFrame(); // stops whatever it is doing
      cache.set(keyOf(job.request), { kind: "timedOut" });
      job.resolve({ kind: "timedOut" });
      next();
    }, timeoutMs);
    frame!.contentWindow!.postMessage(
      {
        v: 1,
        type: "render",
        id: job.id,
        source: job.request.source,
        themeVariables: job.request.themeVariables,
        useOwnTheme: job.request.useOwnTheme,
        background: job.request.background,
        reducedMotion: job.request.reducedMotion,
      },
      "*",
    );
  });
}

function keyOf(r: DiagramRequest) {
  return `${r.themeKey}|${r.useOwnTheme ? 1 : 0}|${r.background}|${r.reducedMotion ? 1 : 0}|${r.source}`;
}

/** A finished result for this exact request, if one is cached. */
export function cachedDiagram(request: DiagramRequest): DiagramResult | undefined {
  if (request.source.length > MAX_SOURCE) return { kind: "tooLarge" };
  if (request.source.trim() === "") return { kind: "empty" };
  return cache.get(keyOf(request));
}

/** Draws a diagram in the frame. Results are reused while source and theme are unchanged (FR-025). */
export function renderDiagram(request: DiagramRequest): { promise: Promise<DiagramResult>; cancel: () => void } {
  const hit = cachedDiagram(request);
  if (hit) return { promise: Promise.resolve(hit), cancel: () => {} };
  let job!: Job;
  const promise = new Promise<DiagramResult>((resolve) => {
    job = { id: `r${++counter}`, request, resolve };
  });
  queue.push(job);
  next();
  return {
    promise,
    cancel: () => {
      const i = queue.indexOf(job);
      if (i !== -1) queue.splice(i, 1);
    },
  };
}
