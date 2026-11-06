/**
 * 022 FR-010/FR-015 (research R13): Mermaid diagrams and math in AI answers, drawn with the notes'
 * renderers (013) — diagrams in the sandboxed renderer frame, formulas with KaTeX. A diagram or
 * formula that can't be drawn shows its source and the reason instead of breaking the answer.
 */
import type { CSSProperties } from "react";
import { useDiagram } from "@/features/sessions/editor/diagram-math/DiagramView";
import { stripUnsafeSettings } from "@/features/sessions/editor/diagram-math/directives";
import { useMath } from "@/features/sessions/editor/diagram-math/MathView";
import { NO_COMMANDS } from "@/features/sessions/editor/diagram-math/katexLoader";
import { uhMathFromMarkdown, uhMathSyntax } from "@/features/sessions/editor/diagram-math/micromarkMath";
import type { DiagramRequest } from "@/features/sessions/editor/diagram-math/rendererHost";
import { useDiagramTheme } from "@/features/sessions/editor/diagram-math/themeVars";
import { useReducedMotion } from "@/features/sessions/editor/diagram-math/useReducedMotion";

interface MdNode {
  type: string;
  value?: string;
  raw?: string;
  data?: Record<string, unknown>;
  children?: MdNode[];
}

function mark(node: MdNode) {
  if (node.type === "inlineMath" || node.type === "displayMath") {
    const display = node.type === "displayMath";
    const latex = node.value ?? "";
    node.data = {
      hName: display ? "div" : "span",
      hProperties: { dataUhMath: latex, dataUhDisplay: display ? "true" : "false" },
      hChildren: [{ type: "text", value: node.raw || latex }],
    };
  }
  node.children?.forEach(mark);
}

/** A remark plugin: `$…$` and `$$…$$` as in notes, marked for `MathOut`. */
export function remarkUhMath(this: unknown) {
  const data = (this as { data: () => Record<string, unknown[] | undefined> }).data();
  (data.micromarkExtensions ??= []).push(uhMathSyntax);
  (data.fromMarkdownExtensions ??= []).push(uhMathFromMarkdown());
  return (tree: MdNode) => mark(tree);
}

export function MathOut({ latex, display, fallback }: { latex: string; display: boolean; fallback: string }) {
  const result = useMath(latex, display, NO_COMMANDS, true);
  if (result?.kind === "drawn") {
    const Tag = display ? "div" : "span";
    return <Tag className={display ? "my-2 overflow-x-auto" : undefined} dangerouslySetInnerHTML={{ __html: result.html }} />;
  }
  return <code className={result?.kind === "error" ? "text-destructive" : undefined}>{fallback}</code>;
}

export function MermaidBlock({ source }: { source: string }) {
  const theme = useDiagramTheme();
  const reducedMotion = useReducedMotion();
  const request: DiagramRequest = {
    source: stripUnsafeSettings(source),
    themeVariables: theme.variables,
    themeKey: theme.key,
    useOwnTheme: false,
    background: String(theme.variables.background),
    reducedMotion,
  };
  const result = useDiagram(request, true);
  if (result?.kind === "drawn") {
    const style = { "--uh-min-width": `${Math.round(result.width * 0.5)}px` } as CSSProperties;
    return (
      <div role="img" aria-label="Diagram" className="uh-diagram-svg my-2 overflow-x-auto" style={style}>
        <div aria-hidden="true" dangerouslySetInnerHTML={{ __html: result.svg }} />
      </div>
    );
  }
  return (
    <figure className="my-2 rounded-md border border-divider bg-surface-sunken p-3">
      {result && (
        <figcaption role="status" className="mb-2 text-xs text-muted-foreground">
          {result.kind === "error" ? `Diagram error: ${result.message}` : "This diagram couldn't be drawn and is shown as code."}
        </figcaption>
      )}
      <pre className="overflow-x-auto font-mono text-[13px] leading-5">{source}</pre>
    </figure>
  );
}
