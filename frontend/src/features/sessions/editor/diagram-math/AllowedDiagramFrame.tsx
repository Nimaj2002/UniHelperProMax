import { useEffect, useRef, useState } from "react";
import { RENDER_TIMEOUT_MS, type DiagramRequest } from "./rendererHost";

/**
 * A diagram the user chose to allow (clarification Q2): drawn live, with all of its own settings,
 * inside its own sandboxed frame. It still can't reach the app or the note.
 */
export function AllowedDiagramFrame({ request, title }: { request: DiagramRequest; title: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const { source, themeVariables, useOwnTheme, background, reducedMotion } = request;

  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    setSize(null);
    setProblem(null);
    const timer = setTimeout(() => setProblem("This diagram took longer than 5 seconds to draw and is shown as code."), RENDER_TIMEOUT_MS);
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow) return;
      const msg = event.data as { v?: number; type?: string; width?: number; height?: number; message?: string };
      if (msg?.v !== 1) return;
      if (msg.type === "ready") {
        frame.contentWindow?.postMessage({ v: 1, type: "show", source, themeVariables, useOwnTheme, background, reducedMotion }, "*");
      } else if (msg.type === "size") {
        clearTimeout(timer);
        setSize({ width: msg.width ?? 0, height: msg.height ?? 0 });
      } else if (msg.type === "failed") {
        clearTimeout(timer);
        setProblem(`Diagram error: ${msg.message ?? ""}`);
      }
    };
    window.addEventListener("message", onMessage);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
    };
  }, [source, themeVariables, useOwnTheme, background, reducedMotion]);

  if (problem)
    return (
      <>
        <pre className="uh-diagram-code">
          <code>{source}</code>
        </pre>
        <div className="uh-render-message" data-uh="render-message" role="status" data-tone="error">
          {problem}
        </div>
      </>
    );
  return (
    <iframe
      key={source}
      ref={ref}
      title={title}
      src="/diagram-sandbox-allowed.html"
      sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
      className="uh-diagram-allowed"
      style={{ width: size ? Math.min(size.width + 4, 100_000) : "100%", height: size ? size.height + 4 : 240 }}
    />
  );
}
