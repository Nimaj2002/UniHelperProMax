import { EditorView } from "@codemirror/view";

/** Editor theme built only from design tokens (Constitution V) — follows light/dark/user themes. */
export const editorTheme = EditorView.theme({
  "&": {
    color: "var(--text-primary)",
    backgroundColor: "var(--surface-elevated)",
    height: "100%",
    fontSize: "15px",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--font-sans)",
    lineHeight: "1.65",
    padding: "24px 0 40vh",
  },
  ".cm-content": {
    maxWidth: "72ch",
    margin: "0 auto",
    padding: "0 24px",
    caretColor: "var(--accent)",
  },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in oklab, var(--accent) 22%, transparent)",
  },
  ".cm-activeLine": { backgroundColor: "transparent" },
  ".cm-gutters": { display: "none" },
  ".cm-placeholder": { color: "var(--text-muted)" },
  // raw mode
  "&.cm-raw .cm-scroller": { fontFamily: "var(--font-mono)", fontSize: "14px" },
  // live preview
  ".cm-lp-h1": { fontSize: "1.75em", fontWeight: "650", letterSpacing: "-0.01em" },
  ".cm-lp-h2": { fontSize: "1.4em", fontWeight: "650" },
  ".cm-lp-h3": { fontSize: "1.2em", fontWeight: "600" },
  ".cm-lp-h4, .cm-lp-h5, .cm-lp-h6": { fontWeight: "600" },
  ".cm-lp-strong": { fontWeight: "650" },
  ".cm-lp-em": { fontStyle: "italic" },
  ".cm-lp-strike": { textDecoration: "line-through" },
  ".cm-lp-code": {
    fontFamily: "var(--font-mono)",
    fontSize: "0.9em",
    backgroundColor: "var(--surface-sunken)",
    borderRadius: "4px",
    padding: "0 3px",
  },
  ".cm-lp-codeblock": { fontFamily: "var(--font-mono)", fontSize: "0.9em", backgroundColor: "var(--surface-sunken)" },
  ".cm-lp-quote": { borderLeft: "3px solid var(--border)", paddingLeft: "12px", color: "var(--text-muted)" },
  ".cm-lp-link": { color: "var(--accent)", textDecoration: "underline", textUnderlineOffset: "3px", cursor: "pointer" },
  ".cm-lp-mark": { color: "var(--text-muted)" },
  ".cm-lp-bullet": { color: "var(--text-muted)", padding: "0 4px 0 0" },
  ".cm-lp-task": { verticalAlign: "middle", margin: "0 6px 2px 0", accentColor: "var(--accent)", cursor: "pointer" },
  ".cm-lp-table": { borderCollapse: "collapse", margin: "4px 0", fontSize: "0.95em" },
  ".cm-lp-table th, .cm-lp-table td": { border: "1px solid var(--border)", padding: "4px 10px", textAlign: "left" },
  ".cm-lp-table th": { backgroundColor: "var(--surface-sunken)", fontWeight: "600" },
});
