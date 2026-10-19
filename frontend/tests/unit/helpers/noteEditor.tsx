import { MDXEditor, type MDXEditorMethods } from "@mdxeditor/editor";
import { act, render } from "@testing-library/react";
import { createRef } from "react";
import { notePlugins } from "@/features/sessions/editor/MarkdownEditor";

/** Mounts the note editor with the real plugin set and returns its handle. */
export async function mountNoteEditor(markdown: string, onChange?: (md: string, initial: boolean) => void, { readOnly = false } = {}) {
  const ref = createRef<MDXEditorMethods>();
  const utils = render(
    <MDXEditor
      ref={ref}
      markdown={markdown}
      contentEditableClassName="mdx-note-content"
      readOnly={readOnly}
      onChange={(md, initial) => onChange?.(md, initial)}
      plugins={notePlugins("live", { toolbar: false })}
    />,
  );
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return { ...utils, editor: ref.current! };
}

/** What the editor would save for `markdown` opened and exported unchanged. */
export async function roundTrip(markdown: string): Promise<string> {
  const { editor, unmount } = await mountNoteEditor(markdown);
  const out = editor.getMarkdown();
  unmount();
  return out;
}
