import {
  addComposerChild$,
  addTopAreaChild$,
  addExportVisitor$,
  addImportVisitor$,
  addLexicalNode$,
  addMdastExtension$,
  addSyntaxExtension$,
  addToMarkdownExtension$,
  createRootEditorSubscription$,
  realmPlugin,
} from "@mdxeditor/editor";
import { DecisionBanner } from "./DecisionDialog";
import { registerNoteId } from "./editorContext";
import { exportVisitors, importVisitors, toMarkdownExtension } from "./exactMarkdown";
import { InlineMathPreview } from "./InlineMathPreview";
import { uhMathFromMarkdown, uhMathSyntax } from "./micromarkMath";
import { DiagramNode } from "./nodes/DiagramNode";
import { InlineMathNode, InlineMathSourceNode, MathBlockNode } from "./nodes/MathNodes";
import { registerNoteCommands } from "./noteCommands";
import { registerMathEditing } from "./transforms";

/**
 * Diagrams (```mermaid) and math ($…$, $$…$$, ```math) in the note editor
 * (specs/013-note-diagrams-math). Notes stay plain Markdown and these are saved exactly.
 */
export const diagramMathPlugin = realmPlugin<{ noteId?: string }>({
  init(realm, params) {
    realm.pubIn({
      [addSyntaxExtension$]: uhMathSyntax,
      [addMdastExtension$]: uhMathFromMarkdown(),
      [addImportVisitor$]: importVisitors,
      [addLexicalNode$]: [DiagramNode, MathBlockNode, InlineMathNode, InlineMathSourceNode],
      [addExportVisitor$]: exportVisitors,
      [addToMarkdownExtension$]: toMarkdownExtension,
      [createRootEditorSubscription$]: [registerNoteId(params?.noteId), registerMathEditing, registerNoteCommands],
      [addComposerChild$]: InlineMathPreview,
    });
  },
});

/** The diagram permissions banner, under the toolbar (so this plugin goes after `toolbarPlugin`). */
export const diagramDecisionsPlugin = realmPlugin({
  init(realm) {
    realm.pubIn({ [addTopAreaChild$]: DecisionBanner });
  },
});
