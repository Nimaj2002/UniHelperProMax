import { ButtonWithTooltip, readOnly$, rootEditor$, useCellValue } from "@mdxeditor/editor";
import { FlowArrow, Sigma } from "@phosphor-icons/react";
import { $createParagraphNode, $getRoot, $getSelection, $insertNodes, $isRangeSelection } from "lexical";
import { $createDiagramNode } from "./nodes/DiagramNode";
import { $createInlineMathSourceNode, $isInlineMathSourceNode } from "./nodes/MathNodes";
import { openOnMount } from "./transforms";

const EXAMPLE_DIAGRAM = "flowchart LR\n  A[Start] --> B[End]";
const EXAMPLE_FORMULA = "$x^2$";

/** A caret inside a formula being edited moves after it, so an insert never splits the formula. */
function $placeCaret() {
  const s = $getSelection();
  if (!$isRangeSelection(s)) {
    $getRoot().selectEnd();
    return;
  }
  const node = s.anchor.getNode();
  if ($isInlineMathSourceNode(node)) node.selectNext(0, 0);
}

/** "Insert diagram" (FR-044): an example flowchart, opened for editing. */
export function InsertDiagram() {
  const editor = useCellValue(rootEditor$);
  const readOnly = useCellValue(readOnly$);
  if (readOnly) return null;
  return (
    <ButtonWithTooltip
      title="Insert diagram"
      data-uh="insert-diagram"
      onClick={() =>
        editor?.update(() => {
          $placeCaret();
          const node = $createDiagramNode(
            {
              raw: "```mermaid\n" + EXAMPLE_DIAGRAM + "\n```",
              parts: { head: "```mermaid\n", body: EXAMPLE_DIAGRAM, tail: "\n```" },
              text: EXAMPLE_DIAGRAM,
            },
            "mermaid",
          );
          openOnMount.add(node.getKey());
          $insertNodes([node]);
          if (!node.getNextSibling()) node.insertAfter($createParagraphNode());
        })
      }
    >
      <FlowArrow size={20} aria-hidden="true" />
    </ButtonWithTooltip>
  );
}

/** "Insert formula" (FR-044): an example inline formula with its body selected. */
export function InsertFormula() {
  const editor = useCellValue(rootEditor$);
  const readOnly = useCellValue(readOnly$);
  if (readOnly) return null;
  return (
    <ButtonWithTooltip
      title="Insert formula"
      data-uh="insert-formula"
      onClick={() => {
        editor?.update(() => {
          $placeCaret();
          const source = $createInlineMathSourceNode(EXAMPLE_FORMULA);
          $insertNodes([source]);
          source.select(1, EXAMPLE_FORMULA.length - 1);
        });
        editor?.focus();
      }}
    >
      <Sigma size={20} aria-hidden="true" />
    </ButtonWithTooltip>
  );
}
