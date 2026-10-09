/** Client model of the user's annotations (007 data-model "Annotation"; contracts/openapi.yaml). */
import palette from "@/styles/annotation-palette.json";

export type AnnotationType = "highlight" | "ink" | "textbox" | "comment";
export type ColorId = "yellow" | "green" | "blue" | "pink" | "orange" | "purple";

export interface PaletteColor {
  id: ColorId;
  name: string;
  /** highlights and comment markers */
  fill: string;
  /** strokes and text-box text (AA on white pages) */
  ink: string;
}

export const COLORS = palette.colors as PaletteColor[];
export const colorOf = (id: ColorId) => COLORS.find((c) => c.id === id) ?? COLORS[0];

/** Page space: points, unrotated, origin bottom-left. */
export interface Annotation {
  id: string;
  type: AnnotationType;
  page: number;
  color: ColorId;
  rects?: [number, number, number, number][];
  quoted?: string;
  strokes?: [number, number][][];
  width?: number;
  box?: [number, number, number, number];
  anchor?: [number, number];
  text?: string;
  /** server-assigned; absent until the first save */
  rev?: number;
  conflictOf?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AnnotationOp {
  opId: string;
  kind: "upsert" | "delete";
  annotation?: Annotation;
  id?: string;
  /** the rev this op was made against; null for a new annotation */
  baseRev: number | null;
}

export interface OpResult {
  opId: string;
  status: "ok" | "kept_both" | "kept_changed";
  annotation?: Annotation;
  copy?: Annotation;
}
