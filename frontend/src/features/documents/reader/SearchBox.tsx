import { CaretDown, CaretUp, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export interface SearchResult {
  /** pdf.js FindState: 0 found, 1 not found, 2 wrapped, 3 pending. */
  state: number | null;
  current: number;
  total: number;
  /** Every page's text is empty (scanned document). */
  noText: boolean;
}

export function resultText(r: SearchResult, query: string): string {
  if (!query.trim() || r.state === null) return "";
  if (r.state === 3 && r.total === 0) return "Searching…";
  if (r.total > 0) return `${r.current} of ${r.total}`;
  if (r.state === 1) return r.noText ? "This document has no searchable text." : "No matches";
  return "";
}

interface Props {
  result: SearchResult;
  /** `again`: same query, move to the next/previous match. */
  onSearch: (query: string, opts: { again: boolean; previous: boolean }) => void;
  onClose: () => void;
  /** Bumped by Ctrl/Cmd+F while open: focus and select the field again. */
  focusKey: number;
}

/** Inline search in the reader (007 FR-018, contracts/ui-reader.md). */
export function SearchBox({ result, onSearch, onClose, focusKey }: Props) {
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [focusKey]);

  const step = (previous: boolean) => query.trim() && onSearch(query, { again: true, previous });
  const text = resultText(result, query);

  return (
    <div role="search" aria-label="Search in document" className="flex shrink-0 items-center gap-1 border-b border-divider bg-surface px-2 py-1 text-sm">
      <input
        ref={input}
        type="search"
        aria-label="Search in document"
        aria-keyshortcuts="Enter Shift+Enter Escape"
        placeholder="Search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          onSearch(e.target.value, { again: false, previous: false });
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            step(e.shiftKey);
          }
        }}
        className="h-7 w-56 rounded-md border border-input bg-background px-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      />
      <span role="status" aria-live="polite" className="min-w-24 px-1 text-muted-foreground tabular-nums" data-testid="search-status">
        {text}
      </span>
      <Button variant="ghost" size="icon-sm" aria-label="Previous match" disabled={result.total === 0} onClick={() => step(true)}>
        <CaretUp aria-hidden />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Next match" disabled={result.total === 0} onClick={() => step(false)}>
        <CaretDown aria-hidden />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Close search" aria-keyshortcuts="Escape" onClick={onClose}>
        <X aria-hidden />
      </Button>
    </div>
  );
}
