import { CreatableCombobox, type Pick } from "@/components/form/CreatableCombobox";
import { Field } from "@/components/form/Field";
import { Input } from "@/components/ui/input";
import { useCourses, useSemesters, useYears, type Semester } from "@/features/courses/api";

export interface HierarchyValue {
  year: Pick;
  semester: Pick;
  course: Pick;
  /** Only used when the semester is new. */
  semesterStart: string;
  semesterEnd: string;
}

export const emptyHierarchy: HierarchyValue = {
  year: null, semester: null, course: null, semesterStart: "", semesterEnd: "",
};

/** Nested RefOrNew payload for POST /classes — created atomically on submit (FR-014, FR-026). */
export function courseRef(v: HierarchyValue): unknown {
  if (!v.course) return null;
  if (v.course.kind === "existing") return { id: v.course.id };
  let semester: unknown;
  if (v.semester?.kind === "existing") semester = { id: v.semester.id };
  else if (v.semester?.kind === "new") {
    const year = v.year?.kind === "existing" ? { id: v.year.id } : v.year ? { new: { name: v.year.name } } : null;
    semester = {
      new: {
        name: v.semester.name,
        startDate: v.semesterStart || null,
        endDate: v.semesterEnd || null,
        year,
      },
    };
  }
  return { new: { name: v.course.name, semester } };
}

/** End date of the chosen semester (needed for "until semester ends"). */
export function useSemesterEnd(v: HierarchyValue): { known: boolean; endDate: string | null } {
  const yearId = v.year?.kind === "existing" ? v.year.id : undefined;
  const semesters = useSemesters(yearId);
  if (v.semester?.kind === "new") return { known: true, endDate: v.semesterEnd || null };
  if (v.semester?.kind === "existing") {
    const id = v.semester.id;
    const s = semesters.data?.find((x: Semester) => x.id === id);
    return { known: !!s, endDate: s?.endDate ?? null };
  }
  return { known: false, endDate: null };
}

interface Props {
  value: HierarchyValue;
  onChange: (v: HierarchyValue) => void;
  errors: Partial<Record<"year" | "semester" | "course" | "semesterEnd", string>>;
}

export function HierarchyPicker({ value, onChange, errors }: Props) {
  const years = useYears();
  const yearId = value.year?.kind === "existing" ? value.year.id : undefined;
  const semesters = useSemesters(yearId);
  const semesterId = value.semester?.kind === "existing" ? value.semester.id : undefined;
  const courses = useCourses(semesterId);

  return (
    <fieldset className="grid gap-4">
      <legend className="mb-3 text-sm font-medium">Course</legend>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Year" error={errors.year}>
          <CreatableCombobox
            noun="year"
            placeholder="Choose or create a year"
            items={years.data ?? []}
            loading={years.isPending}
            value={value.year}
            onChange={(year) => onChange({ ...value, year, semester: null, course: null })}
          />
        </Field>
        <Field label="Semester" error={errors.semester}>
          <CreatableCombobox
            noun="semester"
            placeholder={value.year ? "Choose or create a semester" : "Choose a year first"}
            disabled={!value.year}
            items={semesters.data ?? []}
            loading={!!yearId && semesters.isPending}
            value={value.semester}
            onChange={(semester) => onChange({ ...value, semester, course: null })}
          />
        </Field>
      </div>
      {value.semester?.kind === "new" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Semester starts (optional)">
            <Input type="date" value={value.semesterStart} onChange={(e) => onChange({ ...value, semesterStart: e.target.value })} />
          </Field>
          <Field label="Semester ends (optional)" error={errors.semesterEnd} hint="Needed for “until the semester ends”">
            <Input type="date" value={value.semesterEnd} onChange={(e) => onChange({ ...value, semesterEnd: e.target.value })} />
          </Field>
        </div>
      )}
      <Field label="Course" error={errors.course}>
        <CreatableCombobox
          noun="course"
          placeholder={value.semester ? "Choose or create a course" : "Choose a semester first"}
          disabled={!value.semester}
          items={courses.data ?? []}
          loading={!!semesterId && courses.isPending}
          value={value.course}
          onChange={(course) => onChange({ ...value, course })}
        />
      </Field>
    </fieldset>
  );
}
