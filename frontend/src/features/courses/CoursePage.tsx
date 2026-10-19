import { Link, useParams } from "react-router";
import { PageFrame } from "@/app/shell/PageFrame";
import { SessionTimeline } from "@/features/sessions/SessionTimeline";
import { useTimeline } from "@/features/sessions/api";
import { CourseTasks } from "@/features/tasks/CourseTasks";
import { swatchStyle, type ColorKey } from "@/lib/palette";
import { useCourse } from "./api";

/** Course timeline page (FR-001–FR-006). */
export function CoursePage() {
  const { courseId } = useParams();
  const course = useCourse(courseId);
  const timeline = useTimeline(courseId);

  if (course.isPending) return <PageFrame><p role="status" className="p-8 text-sm text-muted-foreground">Loading…</p></PageFrame>;
  if (course.isError || !course.data)
    return (
      <PageFrame>
      <div className="p-8">
        <h1 className="text-xl font-semibold">Course not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          It may have been deleted. <Link to="/calendar" className="text-primary underline underline-offset-4">Back to the calendar</Link>
        </p>
      </div>
      </PageFrame>
    );
  const c = course.data;
  const entries = timeline.data?.entries ?? [];

  return (
    <PageFrame>
      <div className="mx-auto w-full max-w-3xl px-4 pt-2 pb-8 sm:px-6">
        <p className="text-sm text-muted-foreground">{c.year.name} · {c.semester.name}</p>
        <h1 className="mt-1 flex items-center gap-3 text-3xl font-semibold tracking-tight">
          <span aria-hidden className="size-4 shrink-0 rounded" style={swatchStyle(c.defaultColor as ColorKey)} />
          <span className="min-w-0 break-words">{c.name}</span>
        </h1>
        <section className="mt-6" aria-labelledby="course-tasks-title">
          <h2 id="course-tasks-title" className="mb-2 text-lg font-semibold">Tasks</h2>
          <CourseTasks courseId={c.id} courseName={c.name} />
        </section>
        <div className="mt-8">
          {timeline.isPending && <p role="status" className="text-sm text-muted-foreground">Loading sessions…</p>}
          {timeline.isError && <p role="alert" className="text-sm text-danger">Couldn't load the sessions. Reload to retry.</p>}
          {timeline.isSuccess && entries.length === 0 && (
            <div className="grid gap-2 text-sm">
              <p className="text-muted-foreground">No sessions yet.</p>
              <Link to="/classes/new" className="justify-self-start text-primary underline underline-offset-4">Add a class</Link>
            </div>
          )}
          {entries.length > 0 && <SessionTimeline entries={entries} variant="page" />}
        </div>
      </div>
    </PageFrame>
  );
}
