import { CalendarStar } from "@phosphor-icons/react";
import { useMemo } from "react";
import { Link, useParams } from "react-router";
import { PageFrame } from "@/app/shell/PageFrame";
import { useCourseTree, type YearNode } from "@/features/courses/api";
import { SessionTimeline } from "@/features/sessions/SessionTimeline";
import { useEventTimeline } from "./api";
import { eventTimelineItems } from "./timeline";

function semesterNames(tree: YearNode[], semesterId: string) {
  for (const y of tree)
    for (const s of y.semesters) if (s.semester.id === semesterId) return { year: y.year.name, semester: s.semester.name };
  return null;
}

/** The semester's Events page (009 FR-010): its events in date order, past normal, upcoming muted. */
export function EventsPage() {
  const { semesterId = "" } = useParams();
  const tree = useCourseTree();
  const timeline = useEventTimeline(semesterId);
  const where = semesterNames(tree.data ?? [], semesterId);
  const entries = useMemo(() => (timeline.data ? eventTimelineItems(timeline.data, semesterId) : []), [timeline.data, semesterId]);

  if (tree.isPending) return <PageFrame><p role="status" className="p-8 text-sm text-muted-foreground">Loading…</p></PageFrame>;
  if (!where || timeline.isError)
    return (
      <PageFrame>
        <div className="p-8">
          <h1 className="text-xl font-semibold">Semester not found</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            It may have been deleted. <Link to="/calendar" className="text-primary underline underline-offset-4">Back to the calendar</Link>
          </p>
        </div>
      </PageFrame>
    );

  return (
    <PageFrame>
      <div className="mx-auto w-full max-w-3xl px-4 pt-2 pb-8 sm:px-6">
        <p className="text-sm text-muted-foreground">{where.year} · {where.semester}</p>
        <h1 className="mt-1 flex items-center gap-3 text-3xl font-semibold tracking-tight">
          <CalendarStar size={24} aria-hidden className="shrink-0 text-muted-foreground" />
          <span className="min-w-0 break-words">Events</span>
        </h1>
        <div className="mt-8">
          {timeline.isPending && <p role="status" className="text-sm text-muted-foreground">Loading events…</p>}
          {timeline.isSuccess && entries.length === 0 && (
            <div className="grid gap-2 text-sm">
              <p className="text-muted-foreground">No events in this semester yet.</p>
              <Link to="/events/new" state={{ from: { semesterId } }} className="justify-self-start text-primary underline underline-offset-4">
                Add an event
              </Link>
            </div>
          )}
          {entries.length > 0 && <SessionTimeline entries={entries} variant="page" />}
        </div>
      </div>
    </PageFrame>
  );
}
