/**
 * 022 FR-014: the AI teacher's instructions, read-only in Settings → AI, so its behaviour can be
 * inspected. Each text is collapsed until opened.
 */
import { useQuery } from "@tanstack/react-query";
import { fetchInstructions } from "./api";

const PARTS = [
  { key: "lesson", title: "Lessons" },
  { key: "practice", title: "Practice" },
  { key: "extraction", title: "Knowledge graph" },
] as const;

export function TeacherInstructions() {
  const q = useQuery({ queryKey: ["teacher-instructions"], queryFn: fetchInstructions, staleTime: Infinity });
  return (
    <section aria-labelledby="teacher-instructions-heading" className="grid gap-2">
      <h3 id="teacher-instructions-heading" className="text-base font-semibold">
        AI teacher instructions
      </h3>
      <p className="text-sm text-text-muted">
        What the AI teacher is told before each lesson, practice session and knowledge-graph update. They can't be edited.
      </p>
      {q.isError && <p className="text-sm text-danger">Couldn't load the instructions.</p>}
      {q.data &&
        PARTS.map((p) => (
          <details key={p.key} className="rounded-md border border-divider">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium">{p.title}</summary>
            <pre className="max-h-96 overflow-auto px-3 pb-3 font-mono text-xs leading-5 whitespace-pre-wrap">{q.data[p.key]}</pre>
          </details>
        ))}
    </section>
  );
}
