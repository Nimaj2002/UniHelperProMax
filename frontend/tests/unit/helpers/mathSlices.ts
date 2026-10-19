import { fromMarkdown } from "mdast-util-from-markdown";
import { fenceKind, savedBlockMarkdown } from "@/features/sessions/editor/diagram-math/exactMarkdown";
import { fencedRaw, uhMathFromMarkdown, uhMathSyntax } from "@/features/sessions/editor/diagram-math/micromarkMath";

type AnyNode = { type: string; raw?: string; lang?: string; children?: AnyNode[] };

/**
 * Every formula and diagram in `markdown`, as exact source (container prefixes removed).
 * Unclosed fences are shown closed, as the editor saves them.
 */
export function mathSlices(markdown: string): string[] {
  const tree = fromMarkdown(markdown, { extensions: [uhMathSyntax], mdastExtensions: [uhMathFromMarkdown()] }) as unknown as AnyNode;
  const out: string[] = [];
  const visit = (n: AnyNode) => {
    if (n.type === "inlineMath" || n.type === "displayMath") out.push(n.raw!);
    if (n.type === "code" && fenceKind(n.lang)) {
      const exact = fencedRaw(n as never);
      out.push(exact ? savedBlockMarkdown({ ...exact, text: "" }) : "?");
    }
    n.children?.forEach(visit);
  };
  visit(tree);
  return out;
}
