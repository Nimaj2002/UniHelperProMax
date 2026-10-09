/** Annotation tools (007 FR-025, contracts/ui-reader.md). */
export type Tool = "select" | "highlight" | "draw" | "text" | "comment";

export const TOOLS: { id: Tool; label: string }[] = [
  { id: "select", label: "Select" },
  { id: "highlight", label: "Highlight" },
  { id: "draw", label: "Draw" },
  { id: "text", label: "Text" },
  { id: "comment", label: "Comment" },
];

export const INK_WIDTH = 2; // pt
export const TEXTBOX_SIZE: [number, number] = [160, 36]; // pt
export const MOVE_STEP = 1; // pt; Shift: × 10
export const NO_TEXT_DOCUMENT = "This document has no selectable text, so text can't be highlighted.";
export const NO_TEXT_PAGE = "This page has no selectable text.";
export const CONFLICT_NOTICE = "This comment was changed in another window. Both versions are kept.";
