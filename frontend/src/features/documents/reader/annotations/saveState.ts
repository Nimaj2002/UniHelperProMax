/** Annotation save state shown in the reader toolbar (007 FR-028/FR-029, ui-reader.md). */
export type SaveStatus = "saved" | "pending" | "saving" | "error";

export function saveLabel(status: SaveStatus): string {
  return status === "error" ? "Not saved — retrying" : status === "saved" ? "Saved" : "Saving…";
}
