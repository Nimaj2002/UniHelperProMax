# Fixture notes for 013-note-diagrams-math

Round-trip corpus (SC-001/SC-002). Every formula and diagram here must be saved character for
character by the note editor (`tests/unit/diagram-math-roundtrip.test.tsx`).

| Group | Covers |
|---|---|
| `github-*` | inline and `$$` math, a ```` ```math ```` fence, flowchart, sequence, class, state, ER and Gantt diagrams, math in tables, `$` in code |
| `obsidian-*` | one-line `$$`, callout quotes, mind map and timeline, shared `\newcommand`/`\def`, math and diagrams nested in lists and quotes, brackets/braces, bold and italic around formulas, front-matter diagram config |
| `vscode-*` | inline math, one-line display, `~~~` and four-backtick fences, `Mermaid` info with extra words and spacing, escaped dollars, a formula across a soft line break |
| `edge-*` | prices and dollars that are not math, unclosed `$$` and unclosed fence, empty diagram and formulas, blank lines inside blocks, unsafe and theme diagram settings and `\href`, trailing spaces on fences, indented fences |
