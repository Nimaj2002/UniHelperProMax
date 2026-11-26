/** 026: Simple's Courses page: one box per course (Moodle-style), filtered by semester and search. */
import { Navigate, Link } from "react-router";
import { useMemo, useState } from "react";
import { PageFrame } from "@/app/shell/PageFrame";
import { useUiMode } from "@/app/uiMode";
import { Input } from "@/components/ui/input";
import { usePreferences } from "@/features/sessions/api";
import { swatchStyle, type ColorKey } from "@/lib/palette";
import { useCourseTree } from "./api";

const ALL = "all";

export function CoursesGridPage() {
  const { mode, ready } = useUiMode();
  const tree = useCourseTree();
  const prefs = usePreferences();
  const [semester, setSemester] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const semesters = useMemo(
    () => (tree.data ?? []).flatMap((y) => y.semesters.map((s) => ({ ...s, yearName: y.year.name }))),
    [tree.data],
  );
  const remembered = prefs.data?.lastSemesterId;
  const selected = semester ?? (semesters.some((s) => s.semester.id === remembered) ? remembered! : ALL);
  const q = query.trim().toLowerCase();
  const courses = semesters
    .filter((s) => selected === ALL || s.semester.id === selected)
    .flatMap((s) => s.courses.map((c) => ({ course: c, label: `${s.yearName} · ${s.semester.name}` })))
    .filter(({ course }) => !q || course.name.toLowerCase().includes(q));

  if (ready && mode !== "simple") return <Navigate to="/" replace />; // Ultimate lists courses in its side panel

  return (
    <PageFrame>
      <div className="mx-auto w-full max-w-5xl px-4 pt-2 pb-8 sm:px-6">
        <h1 className="text-3xl font-semibold tracking-tight">Courses</h1>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="courses-semester">Semester</label>
          <select
            id="courses-semester"
            value={selected}
            onChange={(e) => setSemester(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value={ALL}>All semesters</option>
            {semesters.map((s) => (
              <option key={s.semester.id} value={s.semester.id}>{s.yearName} · {s.semester.name}</option>
            ))}
          </select>
          <label className="sr-only" htmlFor="courses-search">Search courses</label>
          <Input id="courses-search" type="search" placeholder="Search courses" value={query} onChange={(e) => setQuery(e.target.value)} className="h-9 max-w-xs" />
        </div>
        {tree.isPending && <p role="status" className="mt-6 text-sm text-muted-foreground">Loading…</p>}
        {tree.isError && <p role="alert" className="mt-6 text-sm text-danger">Couldn't load the courses. Reload to retry.</p>}
        {tree.isSuccess && courses.length === 0 && (
          <p className="mt-6 text-sm text-muted-foreground">
            {semesters.length === 0 ? "No courses yet. " : "No courses match. "}
            <Link to="/classes/new" className="text-primary underline underline-offset-4">Add a class</Link>
          </p>
        )}
        <ul className="mt-6 grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(14rem,1fr))]">
          {courses.map(({ course, label }) => (
            <li key={course.id}>
              <Link
                to={`/courses/${course.id}`}
                className="flex h-full min-h-28 flex-col justify-between gap-4 rounded-xl border border-divider bg-card p-4 transition-colors hover:bg-accent"
              >
                <span aria-hidden className="h-1.5 w-10 rounded-full" style={swatchStyle(course.defaultColor as ColorKey)} />
                <span>
                  <span className="block text-base font-semibold break-words">{course.name}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{label}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </PageFrame>
  );
}
