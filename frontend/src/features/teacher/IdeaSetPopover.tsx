/**
 * 022 US6 (FR-017): the knowledge-graph ideas a chat starts from — by default this course's most
 * recently taught ideas; the student removes some or adds any idea by searching (at most 30).
 */
import { Brain, X } from "@phosphor-icons/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useIdeaSearch, type Idea } from "@/features/graph/api";

export const MAX_IDEAS = 30;

interface Props {
  ideas: Idea[];
  onChange: (ideas: Idea[]) => void;
  disabled?: boolean;
}

export function IdeaSetPopover({ ideas, onChange, disabled }: Props) {
  const [q, setQ] = useState("");
  const [message, setMessage] = useState<string>();
  const found = useIdeaSearch(q.trim(), null, "relevance", 20, q.trim().length > 0);
  const have = new Set(ideas.map((i) => i.id));
  const add = (idea: Idea) => {
    if (ideas.length >= MAX_IDEAS) return setMessage(`Up to ${MAX_IDEAS} ideas.`);
    setMessage(undefined);
    onChange([...ideas, idea]);
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 gap-1" disabled={disabled} aria-label={`Ideas from earlier lessons: ${ideas.length}`}>
          <Brain size={16} aria-hidden />
          Ideas ({ideas.length})
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="grid w-80 gap-2">
        <p className="text-sm font-medium">Start from these ideas</p>
        <p className="text-xs text-text-muted">The teacher checks them while probing instead of teaching them from zero.</p>
        {ideas.length === 0 ? (
          <p className="text-sm text-text-muted">No ideas chosen.</p>
        ) : (
          <ul aria-label="Chosen ideas" className="grid max-h-48 gap-1 overflow-y-auto">
            {ideas.map((i) => (
              <li key={i.id} className="flex items-center gap-1 text-sm">
                <span className="min-w-0 flex-1 truncate" title={i.statement}>
                  {i.name}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  aria-label={`Remove ${i.name}`}
                  onClick={() => {
                    setMessage(undefined);
                    onChange(ideas.filter((x) => x.id !== i.id));
                  }}
                >
                  <X size={12} aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <Input aria-label="Search ideas to add" placeholder="Search your knowledge graph…" value={q} onChange={(e) => setQ(e.target.value)} />
        {message && (
          <p role="status" className="text-xs text-danger">
            {message}
          </p>
        )}
        {q.trim() && (
          <ul aria-label="Ideas found" className="grid max-h-40 gap-1 overflow-y-auto">
            {(found.data ?? [])
              .filter((i) => !have.has(i.id))
              .map((i) => (
                <li key={i.id}>
                  <button type="button" className="w-full truncate rounded px-1 py-0.5 text-left text-sm hover:bg-surface-hover" onClick={() => add(i)} title={i.statement}>
                    + {i.name}
                  </button>
                </li>
              ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
