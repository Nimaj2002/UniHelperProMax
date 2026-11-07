/**
 * 022 US6 (FR-032–FR-037, contracts/ui-contract.md "Home page — Knowledge graph"): the home page
 * right panel's Knowledge graph — search, Graph or List, and the selected idea's detail (what it
 * follows from, what it leads to, the lessons it came from, Delete).
 */
import { ArrowSquareOut, Graph as GraphIcon, ListBullets, X } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Card } from "@/app/shell/Card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { workspacePath } from "@/features/sessions/SessionTimeline";
import { deleteIdea, graphKey, useGraph, useIdea, type Graph, type Idea } from "./api";
import { GraphCanvas } from "./GraphCanvas";
import { layoutWarm, type Pos } from "./layout";

function IdeaButton({ idea, onSelect }: { idea: Pick<Idea, "id" | "name">; onSelect: (id: string) => void }) {
  return (
    <button type="button" className="text-left text-primary underline-offset-2 hover:underline" onClick={() => onSelect(idea.id)}>
      {idea.name}
    </button>
  );
}

function IdeaDetail({ id, onSelect, onClose }: { id: string; onSelect: (id: string) => void; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const idea = useIdea(id);
  const [confirm, setConfirm] = useState(false);
  const d = idea.data;
  const remove = async () => {
    setConfirm(false);
    try {
      await deleteIdea(id);
      onClose();
      void qc.invalidateQueries({ queryKey: graphKey });
    } catch {
      toast.error("Couldn't delete the idea. Try again.");
    }
  };
  return (
    <section aria-label="Idea" className="grid max-h-[55%] shrink-0 gap-2 overflow-y-auto rounded-md border border-strong-border bg-surface-elevated p-3 text-sm">
      <div className="flex items-start gap-2">
        <h3 className="min-w-0 flex-1 font-semibold">{d?.name ?? "…"}</h3>
        <Button variant="ghost" size="icon" className="size-6" aria-label="Close idea" onClick={onClose}>
          <X size={14} aria-hidden />
        </Button>
      </div>
      {d && (
        <>
          <p>{d.statement}</p>
          {d.followsFrom.length > 0 && (
            <div>
              <p className="font-medium">Follows from</p>
              <ul className="list-disc pl-5">
                {d.followsFrom.map((f) => (
                  <li key={f.linkId}>
                    {f.premises.map((p, i) => (
                      <span key={p.id}>
                        {i > 0 && " + "}
                        <IdeaButton idea={p} onSelect={onSelect} />
                      </span>
                    ))}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {d.leadsTo.length > 0 && (
            <div>
              <p className="font-medium">Leads to</p>
              <ul className="list-disc pl-5">
                {d.leadsTo.map((l) => (
                  <li key={l.linkId}>
                    <IdeaButton idea={l.conclusion} onSelect={onSelect} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <p className="font-medium">Taught in</p>
            <ul className="grid gap-1">
              {d.sources.map((s) => (
                <li key={`${s.chatId}-${s.messageId ?? ""}`}>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-left text-primary underline-offset-2 hover:underline"
                    onClick={() => navigate(`${workspacePath(s.courseId, s.sessionKey)}?teacher=${encodeURIComponent(s.chatId)}`)}
                  >
                    {s.chatTitle}
                    <ArrowSquareOut size={12} aria-hidden />
                  </button>
                  {s.sessionLabel && <span className="block text-xs text-text-muted">{s.sessionLabel}</span>}
                </li>
              ))}
            </ul>
          </div>
          <Button variant="outline" size="sm" className="justify-self-start" onClick={() => setConfirm(true)}>
            Delete idea
          </Button>
        </>
      )}
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{d?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>The idea and its links leave your knowledge graph. Your lessons are not changed.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void remove()}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function IdeaList({ ideas, selected, onSelect }: { ideas: Idea[]; selected: string | null; onSelect: (id: string) => void }) {
  return (
    <ul aria-label="Ideas" className="min-h-0 flex-1 overflow-y-auto rounded-md border border-divider">
      {ideas.map((i) => (
        <li key={i.id}>
          <button
            type="button"
            aria-current={i.id === selected || undefined}
            onClick={() => onSelect(i.id)}
            className="grid w-full gap-0.5 px-2 py-1.5 text-left text-sm hover:bg-surface-hover aria-[current]:bg-surface-sunken"
          >
            <span className="font-medium">{i.name}</span>
            <span className="line-clamp-2 text-xs text-text-muted">{i.statement}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Positions per graph version, warm-started from the previous ones. */
function usePositions(graph: Graph | undefined): Map<string, Pos> {
  return useMemo(
    () => (graph ? layoutWarm(graph.ideas, graph.links) : new Map<string, Pos>()),
    // a new layout only when the graph changed
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [graph?.version],
  );
}

export function GraphSection() {
  const graph = useGraph();
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<"graph" | "list">("graph");
  const [selected, setSelected] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const positions = usePositions(graph.data);
  const needle = q.trim().toLowerCase();
  const matching = useMemo(
    () => (graph.data?.ideas ?? []).filter((i) => !needle || i.name.toLowerCase().includes(needle) || i.statement.toLowerCase().includes(needle)),
    [graph.data, needle],
  );
  const matches = useMemo(() => new Set(needle ? matching.map((i) => i.id) : []), [matching, needle]);
  const select = (id: string | null) => {
    setSelected(id);
    if (id) setOpen(id);
  };
  const empty = graph.isSuccess && !graph.data.ideas.length;
  return (
    <>
      <Card
        id="home-knowledge-graph-body"
        className="flex-1"
        body="fill"
        bodyClassName="flex min-h-0 flex-col gap-2 p-2"
        header={
          <div className="flex h-10 min-w-0 shrink-0 items-center gap-1 border-b border-strong-border px-1.5">
            <h2 className="min-w-0 flex-1 truncate px-1 text-sm font-semibold tracking-tight">Knowledge graph</h2>
          </div>
        }
      >
        {empty ? (
          <p className="p-2 text-sm text-text-muted">Ideas appear here as lessons are taught.</p>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Input aria-label="Search ideas" placeholder="Search ideas…" value={q} onChange={(e) => setQ(e.target.value)} className="h-8" />
              <ToggleGroup type="single" variant="outline" size="sm" value={mode} onValueChange={(v) => v && setMode(v as "graph" | "list")} aria-label="Show as">
                <ToggleGroupItem value="graph" aria-label="Graph" title="Graph" className="h-8 px-2">
                  <GraphIcon size={14} aria-hidden />
                </ToggleGroupItem>
                <ToggleGroupItem value="list" aria-label="List" title="List (screen readers)" className="h-8 px-2">
                  <ListBullets size={14} aria-hidden />
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
            {graph.isPending ? (
              <p className="p-2 text-sm text-text-muted">Loading…</p>
            ) : mode === "graph" && graph.data ? (
              <GraphCanvas graph={graph.data} positions={positions} selected={selected} matches={matches} onSelect={select} onOpen={setOpen} />
            ) : (
              <IdeaList ideas={[...matching].sort((a, b) => a.name.localeCompare(b.name))} selected={selected} onSelect={select} />
            )}
            {open && <IdeaDetail id={open} onSelect={select} onClose={() => setOpen(null)} />}
          </>
        )}
      </Card>
    </>
  );
}
