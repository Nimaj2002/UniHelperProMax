import { compose, type RawParts } from "../micromarkMath";

/**
 * The exact Markdown of a diagram or math block. `raw` is what gets saved; `text` is the
 * diagram/LaTeX source shown for editing. Editing replaces only the body between the original
 * delimiters, so fences, info strings and spacing stay as the user wrote them.
 */
export interface SourceBlock {
  raw: string;
  parts: RawParts;
  text: string;
}

export function editBlock(block: SourceBlock, text: string): SourceBlock {
  const parts = { ...block.parts, body: text };
  return { raw: compose(parts), parts, text };
}

export function isSourceBlock(value: unknown): value is SourceBlock {
  const v = value as SourceBlock | null;
  return (
    !!v &&
    typeof v.raw === "string" &&
    typeof v.text === "string" &&
    !!v.parts &&
    typeof v.parts.head === "string" &&
    typeof v.parts.body === "string" &&
    typeof v.parts.tail === "string"
  );
}
