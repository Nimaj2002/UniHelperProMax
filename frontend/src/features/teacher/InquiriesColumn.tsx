/**
 * 022: the left column — what the student asked the teacher (their own messages, not answer
 * submissions or other actions), in order, as their first few words. Choosing one scrolls the
 * conversation to it.
 */
import type { TeacherTurn } from "./api";

const WORDS = 8;
export const preview = (text: string) => {
  const words = text.trim().split(/\s+/);
  return words.length > WORDS ? `${words.slice(0, WORDS).join(" ")}…` : words.join(" ");
};

export function InquiriesColumn({ turns, onSelect }: { turns: TeacherTurn[]; onSelect: (turnId: string) => void }) {
  const asked = turns.filter((t) => !t.user.action && t.user.text?.trim());
  if (!asked.length) return <p className="p-3 text-sm text-text-muted">What you ask the teacher appears here.</p>;
  return (
    <ol aria-label="Your questions" className="grid content-start gap-0.5 overflow-y-auto p-1.5">
      {asked.map((t) => (
        <li key={t.id}>
          <button
            type="button"
            title={t.user.text ?? ""}
            onClick={() => onSelect(t.id)}
            className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-ring"
          >
            {preview(t.user.text ?? "")}
          </button>
        </li>
      ))}
    </ol>
  );
}
