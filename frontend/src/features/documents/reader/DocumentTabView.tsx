/**
 * The content of a document tab (007 FR-011–FR-024). The reader and EmbedPDF load lazily, the first
 * time a document tab opens, so the notes workspace doesn't pay for them (research R14).
 */
import { lazy, Suspense } from "react";
import { useDocument } from "../api";
import { PROTECTED_MESSAGE, ReaderMessage } from "./ReaderMessage";

export { DOC_ATTACH, DOC_DETACH } from "./events";

const PdfReader = lazy(() => import("./PdfReader"));

interface Props {
  documentId: string;
  /** Shown in a pane right now (hidden readers keep their state, research R11). */
  visible: boolean;
  /** Escape from the reader moves focus to the tab bar. */
  onEscape: () => void;
}

export function DocumentTabView({ documentId, visible, onEscape }: Props) {
  const doc = useDocument(documentId);
  if (doc.isError) return <ReaderMessage tone="danger">This document couldn't be loaded.</ReaderMessage>;
  if (!doc.data) return <ReaderMessage>Opening document…</ReaderMessage>;
  if (doc.data.missing) return <ReaderMessage tone="danger">The PDF is missing from the session's documents folder.</ReaderMessage>;
  if (doc.data.encrypted) return <ReaderMessage>{PROTECTED_MESSAGE}</ReaderMessage>;
  return (
    <Suspense fallback={<ReaderMessage>Opening document…</ReaderMessage>}>
      <PdfReader document={doc.data} visible={visible} onEscape={onEscape} />
    </Suspense>
  );
}
