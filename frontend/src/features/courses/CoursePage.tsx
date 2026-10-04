import { Link, useParams } from "react-router";
import { useCourse } from "./api";
import { swatchStyle, type ColorKey } from "@/lib/palette";

/** Course page placeholder (FR-024); the session timeline arrives with feature 002. */
export function CoursePage() {
  const { courseId } = useParams();
  const course = useCourse(courseId);
  if (course.isPending) return <p role="status" className="p-8 text-sm text-muted-foreground">Loading…</p>;
  if (course.isError || !course.data)
    return (
      <div className="p-8">
        <h1 className="text-xl font-semibold">Course not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          It may have been deleted. <Link to="/calendar" className="text-primary underline underline-offset-4">Back to the calendar</Link>
        </p>
      </div>
    );
  const c = course.data;
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <p className="text-sm text-muted-foreground">{c.year.name} · {c.semester.name}</p>
      <h1 className="mt-1 flex items-center gap-3 text-3xl font-semibold tracking-tight">
        <span aria-hidden className="size-4 rounded" style={swatchStyle(c.defaultColor as ColorKey)} />
        {c.name}
      </h1>
      <p className="mt-6 max-w-[65ch] leading-relaxed text-muted-foreground">
        This course's timeline of sessions — with notes and recordings for each one — arrives in the next update.
        For now, its sessions are on the <Link to="/calendar" className="text-primary underline underline-offset-4">calendar</Link>,
        and its files live in the folder “{c.year.folderName}/{c.semester.folderName}/{c.folderName}”.
      </p>
    </div>
  );
}
