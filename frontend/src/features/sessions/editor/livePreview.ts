/**
 * Live preview (FR-022, research N1): formatting renders in place; the raw Markdown of a
 * line/block appears only while the selection touches it. The document text itself is never
 * changed by the preview (except an explicit checkbox click toggling `[ ]`/`[x]`).
 */
import { syntaxTree } from "@codemirror/language";
import { EditorState, RangeSetBuilder, StateField, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

/** Lines touched by any selection range — raw syntax is shown there. */
export function activeLines(state: EditorState): Set<number> {
  const lines = new Set<number>();
  for (const r of state.selection.ranges) {
    const a = state.doc.lineAt(r.from).number;
    const b = state.doc.lineAt(r.to).number;
    for (let n = a; n <= b; n++) lines.add(n);
  }
  return lines;
}

function touchesActive(state: EditorState, from: number, to: number, active: Set<number>): boolean {
  const a = state.doc.lineAt(from).number;
  const b = state.doc.lineAt(Math.max(from, to - (to > from ? 1 : 0))).number;
  for (let n = a; n <= b; n++) if (active.has(n)) return true;
  return false;
}

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean, readonly pos: number) {
    super();
  }
  eq(other: CheckboxWidget) {
    return other.checked === this.checked && other.pos === this.pos;
  }
  toDOM(view: EditorView) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = this.checked;
    box.className = "cm-lp-task";
    box.setAttribute("aria-label", this.checked ? "Completed task" : "Open task");
    box.addEventListener("mousedown", (e) => e.preventDefault());
    box.addEventListener("click", () => {
      view.dispatch({ changes: { from: this.pos + 1, to: this.pos + 2, insert: this.checked ? " " : "x" } });
    });
    return box;
  }
  ignoreEvent() {
    return false;
  }
}

class BulletWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const s = document.createElement("span");
    s.className = "cm-lp-bullet";
    s.textContent = "•";
    return s;
  }
}

/** Inline decorations for the visible ranges (exported for unit tests). */
export function buildInline(state: EditorState, ranges: readonly { from: number; to: number }[]): Range<Decoration>[] {
  const active = activeLines(state);
  const out: Range<Decoration>[] = [];
  const hide = (from: number, to: number) => {
    if (to > from) out.push(Decoration.replace({}).range(from, to));
  };
  const mark = (cls: string, from: number, to: number, attrs?: Record<string, string>) => {
    if (to > from) out.push(Decoration.mark({ class: cls, attributes: attrs }).range(from, to));
  };
  const line = (cls: string, pos: number) => out.push(Decoration.line({ class: cls }).range(state.doc.lineAt(pos).from));

  for (const { from, to } of ranges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (n) => {
        const name = n.name;
        const isActive = touchesActive(state, n.from, n.to, active);
        const heading = /^ATXHeading(\d)$/.exec(name);
        if (heading) {
          line(`cm-lp-h${heading[1]}`, n.from);
          return;
        }
        switch (name) {
          case "HeaderMark": {
            if (!isActive) {
              // also hide the space after "#"
              const after = state.doc.sliceString(n.to, n.to + 1) === " " ? n.to + 1 : n.to;
              if (n.node.parent?.name.startsWith("ATXHeading")) hide(n.from, after);
            }
            return;
          }
          case "StrongEmphasis": mark("cm-lp-strong", n.from, n.to); return;
          case "Emphasis": mark("cm-lp-em", n.from, n.to); return;
          case "Strikethrough": mark("cm-lp-strike", n.from, n.to); return;
          case "InlineCode": mark("cm-lp-code", n.from, n.to); return;
          case "EmphasisMark":
          case "StrikethroughMark":
          case "CodeMark": {
            if (n.node.parent?.name === "FencedCode") return;
            if (!isActive) hide(n.from, n.to);
            else mark("cm-lp-mark", n.from, n.to);
            return;
          }
          case "Link": {
            const node = n.node;
            const url = node.getChild("URL");
            const href = url ? state.doc.sliceString(url.from, url.to) : "";
            const marks = node.getChildren("LinkMark");
            if (marks.length >= 2) {
              const textFrom = marks[0].to;
              const textTo = marks[1].from;
              mark("cm-lp-link", textFrom, textTo, href ? { "data-href": href, title: href } : undefined);
              if (!isActive) {
                hide(marks[0].from, marks[0].to);
                hide(marks[1].from, node.to);
              }
            }
            return false;
          }
          case "URL": {
            // bare autolinks
            if (n.node.parent?.name !== "Link") {
              mark("cm-lp-link", n.from, n.to, { "data-href": state.doc.sliceString(n.from, n.to) });
            }
            return;
          }
          case "QuoteMark": {
            line("cm-lp-quote", n.from);
            if (!isActive) {
              const after = state.doc.sliceString(n.to, n.to + 1) === " " ? n.to + 1 : n.to;
              hide(n.from, after);
            }
            return;
          }
          case "ListMark": {
            const text = state.doc.sliceString(n.from, n.to);
            const task = n.node.parent?.getChild("Task");
            if (task) {
              if (!isActive) hide(n.from, Math.min(n.to + 1, task.from));
              return;
            }
            if (!isActive && (text === "-" || text === "*" || text === "+")) {
              out.push(Decoration.replace({ widget: new BulletWidget() }).range(n.from, n.to));
            }
            return;
          }
          case "TaskMarker": {
            if (!isActive) {
              const checked = /x/i.test(state.doc.sliceString(n.from, n.to));
              const end = state.doc.sliceString(n.to, n.to + 1) === " " ? n.to + 1 : n.to;
              out.push(Decoration.replace({ widget: new CheckboxWidget(checked, n.from) }).range(n.from, end));
            }
            return;
          }
          case "FencedCode": {
            for (let pos = n.from; pos <= n.to; ) {
              const l = state.doc.lineAt(pos);
              out.push(Decoration.line({ class: "cm-lp-codeblock" }).range(l.from));
              pos = l.to + 1;
            }
            return false;
          }
          default:
            return;
        }
      },
    });
  }
  return out;
}

const inlinePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) {
        this.decorations = this.build(u.view);
      }
    }
    build(view: EditorView) {
      return Decoration.set(buildInline(view.state, view.visibleRanges), true);
    }
  },
  { decorations: (v) => v.decorations },
);

// ---- tables: block widgets must come from a state field ----------------------------------

class TableWidget extends WidgetType {
  constructor(readonly source: string) {
    super();
  }
  eq(other: TableWidget) {
    return other.source === this.source;
  }
  toDOM() {
    const rows = this.source
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
    const table = document.createElement("table");
    table.className = "cm-lp-table";
    rows.forEach((cells, i) => {
      if (i === 1 && cells.every((c) => /^:?-{1,}:?$/.test(c))) return; // delimiter row
      const tr = table.insertRow();
      for (const c of cells) {
        const cell = document.createElement(i === 0 ? "th" : "td");
        cell.textContent = c;
        tr.appendChild(cell);
      }
    });
    const wrap = document.createElement("div");
    wrap.appendChild(table);
    return wrap;
  }
  ignoreEvent() {
    return false;
  }
}

export function tableRanges(state: EditorState): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  syntaxTree(state).iterate({
    enter: (n) => {
      if (n.name === "Table") {
        out.push({ from: state.doc.lineAt(n.from).from, to: state.doc.lineAt(n.to).to });
        return false;
      }
    },
  });
  return out;
}

function buildTables(state: EditorState): DecorationSet {
  const active = activeLines(state);
  const b = new RangeSetBuilder<Decoration>();
  for (const t of tableRanges(state)) {
    if (touchesActive(state, t.from, t.to + 1, active)) continue;
    b.add(t.from, t.to, Decoration.replace({ widget: new TableWidget(state.doc.sliceString(t.from, t.to)), block: true }));
  }
  return b.finish();
}

const tableField = StateField.define<DecorationSet>({
  create: buildTables,
  update: (deco, tr) => (tr.docChanged || tr.selection ? buildTables(tr.state) : deco),
  provide: (f) => EditorView.decorations.from(f),
});

/** Click a rendered link (or Mod-Enter on it) to open it in a new tab (US5 #5). */
function openLinkAt(view: EditorView, pos: number): boolean {
  let href: string | null = null;
  syntaxTree(view.state).iterate({
    from: pos,
    to: pos,
    enter: (n: { name: string; node: SyntaxNode; from: number; to: number }) => {
      if (n.name === "Link") {
        const url = n.node.getChild("URL");
        if (url) href = view.state.doc.sliceString(url.from, url.to);
      } else if (n.name === "URL" && n.node.parent?.name !== "Link") {
        href = view.state.doc.sliceString(n.from, n.to);
      }
    },
  });
  if (href && /^https?:\/\//i.test(href)) {
    window.open(href, "_blank", "noopener,noreferrer");
    return true;
  }
  return false;
}

const linkHandlers = EditorView.domEventHandlers({
  mousedown(e, view) {
    const target = (e.target as HTMLElement).closest<HTMLElement>("[data-href]");
    if (!target || e.button !== 0) return false;
    const pos = view.posAtDOM(target);
    if (activeLines(view.state).has(view.state.doc.lineAt(pos).number) && !(e.ctrlKey || e.metaKey)) return false;
    e.preventDefault();
    return openLinkAt(view, pos);
  },
});

export const openLinkCommand = (view: EditorView) => openLinkAt(view, view.state.selection.main.head);

export function livePreview(): Extension {
  return [inlinePlugin, tableField, linkHandlers];
}
