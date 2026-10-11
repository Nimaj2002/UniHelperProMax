import { CalendarStar, CaretDown, CaretRight, DotsSixVertical, MagnifyingGlass, Warning, X } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type DragEvent, type KeyboardEvent } from "react";
import { Link } from "react-router";
import { Input } from "@/components/ui/input";
import { hasModifier, isTypingTarget } from "@/lib/shortcuts";
import { readLocal, writeLocal } from "@/lib/storage";
import { swatchStyle, type ColorKey } from "@/lib/palette";
import { cn } from "@/lib/utils";
import { eventsPagePath } from "@/features/events/api";
import { useCourseAdornments } from "./adornments";
import { useCourseTree, useReorderYears, type YearNode } from "./api";
import { HierarchyMenu } from "./HierarchyMenu";

const COLLAPSE_KEY = "uh.panel.collapsedGroups";
const RESERVED_WARNING = "Rename this course: “_Events” is reserved for events.";

/** Courses matching the query, grouped as in the tree. A semester's "Events" row (009 FR-011a)
 * travels with its semester node, so it stays whenever the semester is shown. */
export function filterTree(tree: YearNode[], query: string): YearNode[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return tree;
  return tree
    .map((n) => ({
      ...n,
      semesters: n.semesters
        .map((s) => ({ ...s, courses: s.courses.filter((c) => c.name.toLocaleLowerCase().includes(q)) }))
        .filter((s) => s.courses.length > 0),
    }))
    .filter((n) => n.semesters.length > 0);
}

// the search box sits above the Courses heading (008 FR-007), the list below it: they share the query
let courseQuery = "";
const queryListeners = new Set<() => void>();
function setCourseQuery(q: string) {
  courseQuery = q;
  queryListeners.forEach((l) => l());
}
function useCourseQuery() {
  return useSyncExternalStore(
    (l) => {
      queryListeners.add(l);
      return () => queryListeners.delete(l);
    },
    () => courseQuery,
    () => courseQuery,
  );
}

/** Course search ("/" focuses it from anywhere, FR-023). */
export function CourseSearch() {
  const query = useCourseQuery();
  const searchRef = useRef<HTMLInputElement>(null);
  // "/" focuses the search (FR-023); while the side panel is closed the shell opens it first
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "/" && !hasModifier(e) && !isTypingTarget(e.target)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="relative px-1">
      <label htmlFor="course-search" className="sr-only">Search courses</label>
      <MagnifyingGlass size={16} aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={searchRef}
        id="course-search"
        type="search"
        placeholder="Search courses"
        aria-controls="course-list"
        aria-keyshortcuts="/"
        autoComplete="off"
        value={query}
        onChange={(e) => setCourseQuery(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && query && (e.stopPropagation(), setCourseQuery(""))}
        className="pr-8 pl-8 [&::-webkit-search-cancel-button]:hidden"
      />
      {query && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => { setCourseQuery(""); searchRef.current?.focus(); }}
          className="absolute top-1/2 right-2.5 grid size-6 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}

/** Left panel: years (user order, reorderable) → semesters (most recent first) → courses. */
export function CoursePanel() {
  const tree = useCourseTree();
  const reorder = useReorderYears();
  const adornments = useCourseAdornments();
  const query = useCourseQuery();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => readLocal(COLLAPSE_KEY, {}));
  const [announcement, setAnnouncement] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => writeLocal(COLLAPSE_KEY, collapsed), [collapsed]);

  const data = useMemo(() => tree.data ?? [], [tree.data]);
  const visible = useMemo(() => filterTree(data, query), [data, query]);
  const filtering = query.trim() !== "";
  const toggle = (id: string) => setCollapsed((c) => ({ ...c, [id]: !c[id] }));

  const moveYear = (id: string, to: number) => {
    const ids = data.map((n) => n.year.id);
    const from = ids.indexOf(id);
    if (from < 0 || to < 0 || to >= ids.length || to === from) return;
    ids.splice(to, 0, ...ids.splice(from, 1));
    const name = data[from].year.name;
    reorder.mutate(ids);
    setAnnouncement(`${name} moved to position ${to + 1} of ${ids.length}`);
    requestAnimationFrame(() =>
      listRef.current?.querySelector<HTMLElement>(`[data-year-toggle="${CSS.escape(id)}"]`)?.focus(),
    );
  };

  const onYearKey = (e: KeyboardEvent<HTMLButtonElement>, id: string, index: number) => {
    if (!e.altKey || filtering) return;
    if (e.key === "ArrowUp") { e.preventDefault(); moveYear(id, index - 1); }
    if (e.key === "ArrowDown") { e.preventDefault(); moveYear(id, index + 1); }
  };

  const onDrop = (e: DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (dragId) moveYear(dragId, targetIndex);
    setDragId(null);
  };

  return (
    <nav aria-label="Courses" className="flex h-full flex-col">
      <p aria-live="polite" className="sr-only">{announcement}</p>
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {tree.isPending && (
          <ul aria-hidden className="grid gap-2 px-2 pt-2">
            {[60, 80, 70].map((w) => <li key={w} className="h-4 animate-pulse rounded bg-surface-sunken" style={{ width: `${w}%` }} />)}
          </ul>
        )}
        {tree.isError && (
          <div role="alert" className="grid gap-2 px-2 text-sm">
            <p className="text-danger">Couldn't load your courses.</p>
            <button type="button" className="justify-self-start text-primary underline underline-offset-4" onClick={() => tree.refetch()}>
              Retry
            </button>
          </div>
        )}
        {tree.isSuccess && data.length === 0 && (
          <p className="px-2 pt-1 text-sm leading-relaxed text-muted-foreground">
            No courses yet. Use <span className="font-medium text-foreground">+</span> beside Courses (New class) to add your first one.
          </p>
        )}
        {tree.isSuccess && data.length > 0 && visible.length === 0 && (
          <div role="status" className="grid gap-2 px-2 pt-1 text-sm">
            <p className="text-muted-foreground">No courses match “{query.trim()}”.</p>
            <button type="button" className="justify-self-start text-primary underline underline-offset-4" onClick={() => setCourseQuery("")}>
              Show all courses
            </button>
          </div>
        )}
        <ul id="course-list" ref={listRef} className="grid gap-3">
          {visible.map(({ year, semesters }) => {
            const index = data.findIndex((n) => n.year.id === year.id);
            const open = filtering || !collapsed[year.id];
            return (
              <li
                key={year.id}
                onDragOver={(e) => dragId && dragId !== year.id && e.preventDefault()}
                onDrop={(e) => onDrop(e, index)}
                className={cn("rounded-md", dragId === year.id && "opacity-50")}
              >
                <div className="group flex items-center gap-0.5">
                  {!filtering && (
                    <span
                      draggable
                      onDragStart={(e) => { setDragId(year.id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", year.id); }}
                      onDragEnd={() => setDragId(null)}
                      title="Drag to reorder (or Alt+↑ / Alt+↓)"
                      aria-hidden
                      className="grid size-6 cursor-grab place-items-center text-muted-foreground opacity-0 group-hover:opacity-100"
                    >
                      <DotsSixVertical size={14} weight="bold" />
                    </span>
                  )}
                  <button
                    type="button"
                    data-year-toggle={year.id}
                    aria-expanded={open}
                    aria-keyshortcuts={filtering ? undefined : "Alt+ArrowUp Alt+ArrowDown"}
                    aria-description={filtering ? undefined : "Press Alt plus Up or Down arrow to reorder years"}
                    onClick={() => !filtering && toggle(year.id)}
                    onKeyDown={(e) => onYearKey(e, year.id, index)}
                    className="flex min-w-0 flex-1 items-center gap-1 rounded-md px-1 py-1 text-left text-xs font-semibold text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    {open ? <CaretDown size={12} aria-hidden /> : <CaretRight size={12} aria-hidden />}
                    <span className="truncate">{year.name}</span>
                  </button>
                  <HierarchyMenu
                    target={{ kind: "year", id: year.id, name: year.name, version: year.version }}
                    canMoveUp={!filtering && index > 0}
                    canMoveDown={!filtering && index < data.length - 1}
                    onMoveUp={() => moveYear(year.id, index - 1)}
                    onMoveDown={() => moveYear(year.id, index + 1)}
                  />
                </div>
                {open && (
                  <ul className="mt-0.5 grid gap-1 pl-3">
                    {semesters.map(({ semester, courses, eventCount }) => {
                      const semOpen = filtering || !collapsed[semester.id];
                      return (
                        <li key={semester.id}>
                          <div className="flex items-center gap-0.5">
                            <button
                              type="button"
                              aria-expanded={semOpen}
                              onClick={() => !filtering && toggle(semester.id)}
                              className="flex min-w-0 flex-1 items-center gap-1 rounded-md px-1 py-1 text-left text-sm font-medium hover:bg-accent"
                            >
                              {semOpen ? <CaretDown size={12} aria-hidden /> : <CaretRight size={12} aria-hidden />}
                              <span className="truncate">{semester.name}</span>
                            </button>
                            <HierarchyMenu
                              target={{ kind: "semester", id: semester.id, name: semester.name, version: semester.version,
                                startDate: semester.startDate, endDate: semester.endDate }}
                            />
                          </div>
                          {semOpen && (
                            <ul className="pl-3">
                              {courses.length === 0 && <li className="px-2 py-1 text-xs text-muted-foreground">No courses</li>}
                              {courses.map((c) => (
                                <li key={c.id} className="group flex items-center gap-0.5">
                                  <Link
                                    to={`/courses/${c.id}`}
                                    className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                                  >
                                    <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={swatchStyle(c.defaultColor as ColorKey)} />
                                    <span className="truncate" title={c.name}>{c.name}</span>
                                    {c.reservedNameConflict && (
                                      <span className="ml-auto flex shrink-0 items-center text-danger" title={RESERVED_WARNING}>
                                        <Warning size={14} weight="bold" aria-hidden />
                                        <span className="sr-only">{RESERVED_WARNING}</span>
                                      </span>
                                    )}
                                    {adornments.map(({ id, component: A }) => <A key={id} course={c} />)}
                                  </Link>
                                  <HierarchyMenu target={{ kind: "course", id: c.id, name: c.name, version: c.version }} />
                                </li>
                              ))}
                              <li>
                                <Link
                                  to={eventsPagePath(semester.id)}
                                  data-events-of={semester.id}
                                  aria-label={eventCount ? `Events, ${eventCount} ${eventCount === 1 ? "event" : "events"}` : undefined}
                                  className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                                >
                                  <CalendarStar size={14} aria-hidden className="shrink-0" />
                                  <span className="truncate">Events</span>
                                  {/* the name stays "Events…": a semester name may contain a course's */}
                                  {!!eventCount && (
                                    <span aria-hidden className="ml-auto rounded-full bg-surface-sunken px-1.5 text-xs tabular-nums">
                                      {eventCount}
                                    </span>
                                  )}
                                </Link>
                              </li>
                            </ul>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
