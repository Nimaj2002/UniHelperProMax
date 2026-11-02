/**
 * One of the user's annotations on a page (007 FR-026/FR-027/FR-034, research R9): a focusable
 * element in page order with an accessible name. Selected: focus-ring outline and handles; arrows
 * move it (Shift × 10), Enter edits its text, C opens the colour menu, Delete removes it. With the
 * Select tool it can be dragged.
 */
import { ChatCircleText } from "@phosphor-icons/react";
import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { hintOf, matches, matchFirst, useKeymap } from "@/lib/keymap";
import { cn } from "@/lib/utils";
import { accessibleName, arrowStep, bounds, screenDeltaToPage, translate } from "./edit";
import { rectToViewport, type Matrix } from "./geometry";
import type { AnnotationModel } from "./model";
import { MOVE_STEP } from "./tools";
import { COLORS, colorOf, type Annotation, type ColorId } from "./types";

interface Props {
  a: Annotation;
  model: AnnotationModel;
  transform: Matrix;
  inverse: Matrix;
  scale: number;
  /** Items react to the pointer only with the Select tool (other tools draw on the page). */
  interactive: boolean;
  selected: boolean;
  onSelect: (id: string | null) => void;
  /** Escape on an annotation: leave the page for the tab bar (ui-reader.md). */
  onEscape: () => void;
}

export function ColorMenuItems({ onPick }: { onPick: (c: ColorId) => void }) {
  return COLORS.map((c) => (
    <DropdownMenuItem key={c.id} onSelect={() => onPick(c.id)}>
      <span aria-hidden className="size-3.5 rounded-full border border-divider" style={{ background: c.fill }} />
      {c.name}
    </DropdownMenuItem>
  ));
}

/** The comment popover / text-box editor: Escape or leaving the field saves. */
export function NoteEditor({ initial, label, onDone, className, style }: { initial: string; label: string; onDone: (text: string) => void; className?: string; style?: CSSProperties }) {
  const [text, setText] = useState(initial);
  const done = useRef(false);
  const finish = () => {
    if (done.current) return;
    done.current = true;
    onDone(text);
  };
  return (
    <textarea
      aria-label={label}
      // eslint-disable-next-line jsx-a11y/no-autofocus -- opened by the user's own action
      autoFocus
      value={text}
      maxLength={10000}
      onChange={(e) => setText(e.target.value)}
      onBlur={finish}
      onKeyDown={(e) => {
        if (matches(e.nativeEvent, "pdfAnnotationEditor.finish")) {
          e.preventDefault();
          e.stopPropagation();
          finish();
        }
      }}
      className={cn("rounded-md border border-input bg-background p-2 text-sm text-foreground shadow-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none", className)}
      style={style}
    />
  );
}

const ANNOTATION_COMMANDS = [
  "pdfAnnotation.up", "pdfAnnotation.down", "pdfAnnotation.left", "pdfAnnotation.right",
  "pdfAnnotation.delete", "pdfAnnotation.edit", "pdfAnnotation.menu",
] as const;
const MOVE_DIR: Partial<Record<(typeof ANNOTATION_COMMANDS)[number], string>> = {
  "pdfAnnotation.up": "ArrowUp", "pdfAnnotation.down": "ArrowDown", "pdfAnnotation.left": "ArrowLeft", "pdfAnnotation.right": "ArrowRight",
};

export function AnnotationItem({ a, model, transform, inverse, scale, interactive, selected, onSelect, onEscape }: Props) {
  const [menu, setMenu] = useState(false);
  const keymap = useKeymap();
  const [editing, setEditing] = useState(false);
  const [drag, setDrag] = useState<{ x: number; y: number; dx: number; dy: number; moved: boolean } | null>(null);
  const box = rectToViewport(transform, bounds(a));
  const color = colorOf(a.color);
  const name = accessibleName(a);

  const move = (dx: number, dy: number) => model.update(a.id, translate(a, dx, dy));

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (editing || menu) return;
    // keys from the 019 keymap; Shift + a move key is a bigger step, Esc (deselect) stays fixed
    const command = matchFirst(e.nativeEvent, ANNOTATION_COMMANDS);
    const dir = command && MOVE_DIR[command];
    const step = dir && arrowStep(inverse, dir, MOVE_STEP * (e.shiftKey ? 10 : 1));
    let handled = true;
    if (step) move(step[0], step[1]);
    else if (command === "pdfAnnotation.delete") {
      model.remove(a.id);
      onSelect(null);
    } else if (command === "pdfAnnotation.edit" && (a.type === "textbox" || a.type === "comment")) setEditing(true);
    else if (command === "pdfAnnotation.menu") setMenu(true);
    else if (e.key === "Escape") {
      onSelect(null);
      onEscape();
    } else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if (!interactive || e.button !== 0 || editing) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    onSelect(a.id);
    setDrag({ x: e.clientX, y: e.clientY, dx: 0, dy: 0, moved: false });
  };
  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    setDrag({ ...drag, dx, dy, moved: drag.moved || Math.hypot(dx, dy) > 3 });
  };
  const onPointerUp = () => {
    if (!drag) return;
    if (drag.moved) {
      const [px, py] = screenDeltaToPage(inverse, drag.dx, drag.dy);
      move(px, py);
    } else if (a.type === "comment" || (a.type === "textbox" && selected)) setEditing(true);
    setDrag(null);
  };

  const offset = drag?.moved ? `translate(${drag.dx}px, ${drag.dy}px)` : undefined;
  const style: CSSProperties = { left: box.left, top: box.top, width: box.width, height: box.height, transform: offset };
  const shared = {
    "data-annotation": a.id,
    "aria-label": name,
    "aria-keyshortcuts": ANNOTATION_COMMANDS.flatMap((id) => hintOf(keymap, id).aria ?? []).join(" ") || undefined,
    onKeyDown,
    onFocus: () => onSelect(a.id),
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: () => setDrag(null),
  };
  const outline = selected && "outline-2 outline-offset-2 outline-ring";

  const colorMenu = (
    <DropdownMenu open={menu} onOpenChange={setMenu}>
      <DropdownMenuTrigger asChild>
        <span aria-hidden tabIndex={-1} className="pointer-events-none absolute bottom-0 left-0 size-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" aria-label="Colour">
        <ColorMenuItems onPick={(c) => model.update(a.id, { color: c })} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
  const handles = selected && (
    <span aria-hidden className="pointer-events-none">
      {["-top-1 -left-1", "-top-1 -right-1", "-bottom-1 -left-1", "-bottom-1 -right-1"].map((pos) => (
        <span key={pos} className={cn("absolute size-2 rounded-[2px] border border-ring bg-background", pos)} />
      ))}
    </span>
  );

  if (a.type === "comment") {
    const [ax, ay] = [box.left + box.width / 2, box.top + box.height / 2];
    return (
      <Popover open={editing} onOpenChange={(o) => !o && setEditing(false)}>
        <PopoverAnchor asChild>
          <button
            type="button"
            {...shared}
            aria-haspopup="dialog"
            className={cn("uh-annot-item absolute grid size-6 place-items-center rounded-full border shadow-sm", outline)}
            style={{ left: ax - 12, top: ay - 12, transform: offset, background: color.fill, borderColor: color.ink, color: color.ink }}
          >
            <ChatCircleText size={16} weight="fill" aria-hidden />
            {colorMenu}
          </button>
        </PopoverAnchor>
        <PopoverContent className="w-72 p-2" onOpenAutoFocus={(e) => e.preventDefault()}>
          <NoteEditor
            initial={a.text ?? ""}
            label={`Comment on page ${a.page}`}
            className="h-28 w-full resize-none"
            onDone={(text) => {
              setEditing(false);
              if (text !== (a.text ?? "")) model.update(a.id, { text });
            }}
          />
        </PopoverContent>
      </Popover>
    );
  }

  if (a.type === "textbox") {
    const fontSize = 12 * scale;
    return editing ? (
      <NoteEditor
        initial={a.text ?? ""}
        label={`Text box on page ${a.page}`}
        className="uh-annot-item absolute resize-none p-1 leading-tight"
        style={{ ...style, fontSize, color: color.ink, minHeight: box.height }}
        onDone={(text) => {
          setEditing(false);
          if (!text.trim()) model.remove(a.id);
          else if (text !== a.text) model.update(a.id, { text });
        }}
      />
    ) : (
      <div role="button" tabIndex={0} {...shared} className={cn("uh-annot-item uh-annot-textbox absolute overflow-hidden p-1 leading-tight whitespace-pre-wrap", outline)} style={{ ...style, fontSize, color: color.ink, borderColor: color.ink }}>
        {a.text}
        {handles}
        {colorMenu}
      </div>
    );
  }

  return (
    <div role="button" tabIndex={0} {...shared} className={cn("uh-annot-item absolute", outline)} style={style}>
      {handles}
      {colorMenu}
    </div>
  );
}
