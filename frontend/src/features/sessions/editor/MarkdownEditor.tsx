import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  CodeToggle,
  CreateLink,
  DiffSourceToggleWrapper,
  InsertCodeBlock,
  InsertImage,
  InsertTable,
  InsertThematicBreak,
  ListsToggle,
  MDXEditor,
  type MDXEditorMethods,
  Separator,
  UndoRedo,
  codeBlockPlugin,
  codeMirrorPlugin,
  diffSourcePlugin,
  headingsPlugin,
  imagePlugin,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  markdownShortcutPlugin,
  quotePlugin,
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
} from "@mdxeditor/editor";
import "@mdxeditor/editor/style.css";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { useResolvedTheme } from "@/app/theme";

export type EditorMode = "live" | "raw";

export interface MarkdownEditorHandle {
  /** Replace a note's text (e.g. after "Use the file's version"). */
  replaceContent(noteId: string, text: string): void;
  /** Add text at the end (a merged transcript). */
  appendContent(noteId: string, text: string): void;
  /** Drop the cached state of a closed/deleted note. */
  forget(noteId: string): void;
  focus(): void;
}

interface Props {
  noteId: string;
  /** Text to start from when a note is shown. */
  initialContent: string;
  label: string;
  /** View the editor opens in: rich text ("live") or Markdown source ("raw"). */
  mode: EditorMode;
  onChange: (noteId: string, text: string) => void;
  onEscape?: () => void;
}

/**
 * MDXEditor (https://mdxeditor.dev) with its own toolbar and editing UI. Each note gets a fresh
 * editor instance (keyed by note id); its text comes from the note's saver, so unsaved edits
 * survive a tab switch.
 */
export const MarkdownEditor = forwardRef<MarkdownEditorHandle, Props>(function MarkdownEditor(
  { noteId, initialContent, label, mode, onChange, onEscape },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<MDXEditorMethods>(null);
  const theme = useResolvedTheme();
  const callbacks = useRef({ onChange, onEscape });
  useEffect(() => {
    callbacks.current = { onChange, onEscape };
  });

  // Escape (when the editor's own popups don't use it) hands focus back to the note's tab
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) callbacks.current.onEscape?.();
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, []);

  useImperativeHandle(ref, () => ({
    replaceContent(id, text) {
      if (id === noteId) editor.current?.setMarkdown(text);
    },
    appendContent(id, text) {
      const e = editor.current;
      if (e && id === noteId) e.setMarkdown(e.getMarkdown() + text);
    },
    forget() {
      // nothing cached: a note's editor is rebuilt from its saver when shown again
    },
    focus() {
      editor.current?.focus();
    },
  }));

  return (
    <div ref={host} role="group" aria-label={label} className="h-full min-h-0 overflow-auto" data-note-editor={noteId}>
      <MDXEditor
        key={noteId}
        ref={editor}
        markdown={initialContent}
        className={theme === "dark" ? "dark-theme" : undefined}
        contentEditableClassName="mdx-note-content"
        placeholder="Start writing…"
        onChange={(text, initialMarkdownNormalize) => {
          if (!initialMarkdownNormalize) callbacks.current.onChange(noteId, text);
        }}
        plugins={[
          headingsPlugin(),
          listsPlugin(),
          quotePlugin(),
          thematicBreakPlugin(),
          linkPlugin(),
          linkDialogPlugin(),
          imagePlugin(),
          tablePlugin(),
          codeBlockPlugin({ defaultCodeBlockLanguage: "" }),
          codeMirrorPlugin({
            codeBlockLanguages: { "": "Plain text", js: "JavaScript", ts: "TypeScript", py: "Python", css: "CSS", html: "HTML", json: "JSON", sql: "SQL", bash: "Bash" },
          }),
          markdownShortcutPlugin(),
          diffSourcePlugin({ viewMode: mode === "raw" ? "source" : "rich-text" }),
          toolbarPlugin({
            toolbarContents: () => (
              <DiffSourceToggleWrapper options={["rich-text", "source"]}>
                <UndoRedo />
                <Separator />
                <BoldItalicUnderlineToggles />
                <CodeToggle />
                <Separator />
                <BlockTypeSelect />
                <Separator />
                <ListsToggle />
                <Separator />
                <CreateLink />
                <InsertImage />
                <InsertTable />
                <InsertThematicBreak />
                <InsertCodeBlock />
              </DiffSourceToggleWrapper>
            ),
          }),
        ]}
      />
    </div>
  );
});
