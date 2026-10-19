import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import type { LexicalEditor } from "lexical";

/** Which note an editor shows, so diagrams can look up the user's decisions for that note. */
const noteIds = new WeakMap<LexicalEditor, string>();

export function registerNoteId(noteId: string | undefined) {
  return (editor: LexicalEditor) => {
    if (noteId) noteIds.set(editor, noteId);
    return () => noteIds.delete(editor);
  };
}

export function useNoteId(): string | undefined {
  const [editor] = useLexicalComposerContext();
  return noteIds.get(editor);
}
