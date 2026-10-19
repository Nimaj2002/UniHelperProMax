/**
 * Runs inside the sandboxed renderer frame (no same-origin access, its own strict CSP;
 * specs/013-note-diagrams-math/contracts/diagram-sandbox-protocol.md). Built as one classic
 * script by `vite.sandbox.config.ts`, so the frame needs no cross-origin module loading.
 *
 * - `diagram-sandbox.html` (mode "safe"): draws on request and sends the SVG back.
 * - `diagram-sandbox-allowed.html` (mode "allowed"): shows one diagram live, with every setting
 *   its source gives, for diagrams the user chose to allow.
 */
import mermaid, { type MermaidConfig } from "mermaid";
import { stripThemeSettings } from "../features/sessions/editor/diagram-math/directives";

type Vars = Record<string, string | boolean>;

interface RenderRequest {
  v: 1;
  type: "render";
  id: string;
  source: string;
  themeVariables: Vars;
  useOwnTheme: boolean;
  background: string;
  reducedMotion: boolean;
}

interface ShowRequest {
  v: 1;
  type: "show";
  source: string;
  themeVariables: Vars;
  useOwnTheme: boolean;
  background: string;
  reducedMotion: boolean;
}

const mode = document.documentElement.dataset.mode === "allowed" ? "allowed" : "safe";
const post = (msg: Record<string, unknown>) => parent.postMessage({ v: 1, ...msg }, "*");

const SECURE: MermaidConfig["secure"] = ["securityLevel", "startOnLoad", "secure", "dompurifyConfig", "htmlLabels", "maxTextSize"];

function config(req: RenderRequest | ShowRequest): MermaidConfig {
  const base: MermaidConfig = {
    startOnLoad: false,
    theme: "base",
    themeVariables: req.themeVariables,
    maxTextSize: 50_000,
    deterministicIds: true,
    fontFamily: String(req.themeVariables.fontFamily ?? "sans-serif"),
  };
  if (mode === "allowed") return { ...base, secure: [] };
  return { ...base, securityLevel: "strict", htmlLabels: false, flowchart: { htmlLabels: false }, secure: SECURE };
}

function sizeOf(svg: SVGSVGElement): { width: number; height: number } {
  const vb = svg.viewBox?.baseVal;
  if (vb && vb.width && vb.height) return { width: vb.width, height: vb.height };
  const box = svg.getBoundingClientRect();
  return { width: box.width, height: box.height };
}

function noMotion(svg: string) {
  return svg.replace("</style>", "*{animation:none!important;transition:none!important}</style>");
}

let counter = 0;

async function draw(req: RenderRequest | ShowRequest) {
  mermaid.initialize(config(req));
  const source = req.useOwnTheme ? req.source : stripThemeSettings(req.source);
  const id = `uhd${Date.now().toString(36)}${counter++}`;
  const result = await mermaid.render(id, source);
  return { ...result, svg: req.reducedMotion ? noMotion(result.svg) : result.svg };
}

function message(e: unknown): { message: string; line?: number } {
  const text = e instanceof Error ? e.message : typeof e === "string" ? e : "This diagram could not be drawn.";
  const line = /line (\d+)/i.exec(text)?.[1];
  return { message: text.split("\n").slice(0, 4).join("\n"), line: line ? Number(line) : undefined };
}

// ---------------------------------------------------------------- safe: render queue

const queue: RenderRequest[] = [];
const cancelled = new Set<string>();
let busy = false;

async function pump() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const req = queue.shift()!;
    if (cancelled.delete(req.id)) continue;
    try {
      const { svg } = await draw(req);
      const holder = document.getElementById("stage")!;
      holder.innerHTML = svg;
      const el = holder.querySelector("svg");
      const size = el ? sizeOf(el) : { width: 0, height: 0 };
      holder.innerHTML = "";
      post({ type: "rendered", id: req.id, svg, ...size });
    } catch (e) {
      post({ type: "failed", id: req.id, ...message(e) });
    }
  }
  busy = false;
}

// ---------------------------------------------------------------- allowed: one live diagram

async function show(req: ShowRequest) {
  const stage = document.getElementById("stage")!;
  document.body.style.background = req.background;
  try {
    const { svg, bindFunctions } = await draw(req);
    stage.innerHTML = svg;
    bindFunctions?.(stage);
    const report = () => {
      const el = stage.querySelector("svg");
      const box = el?.getBoundingClientRect();
      post({ type: "size", width: Math.ceil(box?.width ?? 0), height: Math.ceil(box?.height ?? 0) });
    };
    report();
    new ResizeObserver(report).observe(stage);
  } catch (e) {
    post({ type: "failed", ...message(e) });
  }
}

window.addEventListener("message", (event) => {
  if (event.source !== parent) return;
  const msg = event.data as { v?: number; type?: string; id?: string };
  if (msg?.v !== 1) return;
  if (mode === "safe" && msg.type === "render") {
    queue.push(msg as RenderRequest);
    void pump();
  } else if (mode === "safe" && msg.type === "cancel" && msg.id) {
    cancelled.add(msg.id);
  } else if (mode === "allowed" && msg.type === "show") {
    void show(msg as ShowRequest);
  }
});

post({ type: "ready" });
