import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { livePreview, openLinkCommand } from "./livePreview";
import { editorTheme } from "./theme";

export type EditorMode = "live" | "raw";

export interface MarkdownEditorHandle {
  /** Replace a note's text (e.g. after "Use the file's version"). */
  replaceContent(noteId: string, text: string): void;
  /** Drop the cached state of a closed/deleted note. */
  forget(noteId: string): void;
  focus(): void;
}

interface Props {
  noteId: string;
  /** Text to start from when a note is shown for the first time. */
  initialContent: string;
  label: string;
  mode: EditorMode;
  onChange: (noteId: string, text: string) => void;
  onToggleMode: () => void;
  onEscape?: () => void;
}

interface Cached {
  state: EditorState;
  scrollTop: number;
}

/**
 * One CodeMirror view for the workspace. Each open note keeps its own EditorState (text,
 * cursor, selection, undo history) and scroll position, swapped when the tab changes (US1 #5).
 */
export const MarkdownEditor = forwardRef<MarkdownEditorHandle, Props>(function MarkdownEditor(
  { noteId, initialContent, label, mode, onChange, onToggleMode, onEscape },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const cache = useRef(new Map<string, Cached>());
  const current = useRef<string | null>(null);
  const modeCompartment = useRef(new Compartment());
  const labelCompartment = useRef(new Compartment());
  const callbacks = useRef({ onChange, onToggleMode, onEscape });
  useEffect(() => {
    callbacks.current = { onChange, onToggleMode, onEscape };
  });

  const modeExtension = (m: EditorMode): Extension =>
    m === "live" ? livePreview() : EditorView.editorAttributes.of({ class: "cm-raw" });

  const labelExtension = (text: string): Extension =>
    EditorView.contentAttributes.of({ "aria-label": text, "aria-multiline": "true" });

  const makeState = (id: string, doc: string) =>
    EditorState.create({
      doc,
      extensions: [
        history(),
        markdown({ base: markdownLanguage }),
        EditorView.lineWrapping,
        placeholder("Start writing… Markdown works: # heading, **bold**, - list, - [ ] task"),
        keymap.of([
          { key: "Mod-e", run: () => (callbacks.current.onToggleMode(), true) },
          { key: "Mod-Enter", run: openLinkCommand },
          { key: "Escape", run: () => (callbacks.current.onEscape?.(), !!callbacks.current.onEscape) },
          indentWithTab,
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
        ]),
        editorTheme,
        modeCompartment.current.of(modeExtension(mode)),
        labelCompartment.current.of(labelExtension(label)),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) callbacks.current.onChange(id, u.state.doc.toString());
        }),
      ],
    });

  // create the view once
  useEffect(() => {
    if (!host.current) return;
    const v = new EditorView({ parent: host.current, state: makeState(noteId, initialContent) });
    view.current = v;
    current.current = noteId;
    return () => {
      v.destroy();
      view.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // swap the visible note
  useEffect(() => {
    const v = view.current;
    if (!v || current.current === noteId) return;
    if (current.current) cache.current.set(current.current, { state: v.state, scrollTop: v.scrollDOM.scrollTop });
    const cached = cache.current.get(noteId);
    v.setState(cached?.state ?? makeState(noteId, initialContent));
    v.dispatch({
      effects: [
        modeCompartment.current.reconfigure(modeExtension(mode)),
        labelCompartment.current.reconfigure(labelExtension(label)),
      ],
    });
    current.current = noteId;
    requestAnimationFrame(() => {
      v.scrollDOM.scrollTop = cached?.scrollTop ?? 0;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);

  // live ↔ raw keeps document, cursor and history (Compartment reconfigure)
  useEffect(() => {
    view.current?.dispatch({ effects: modeCompartment.current.reconfigure(modeExtension(mode)) });
  }, [mode]);

  useEffect(() => {
    view.current?.dispatch({ effects: labelCompartment.current.reconfigure(labelExtension(label)) });
  }, [label]);

  useImperativeHandle(ref, () => ({
    replaceContent(id, text) {
      const v = view.current;
      if (v && current.current === id) {
        v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } });
      } else {
        cache.current.delete(id);
      }
    },
    forget(id) {
      cache.current.delete(id);
    },
    focus() {
      view.current?.focus();
    },
  }));

  return <div ref={host} className="h-full min-h-0 overflow-hidden" data-note-editor={noteId} />;
});
