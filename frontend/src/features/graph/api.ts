/** 022 US6: the knowledge graph API. */
import { useQuery } from "@tanstack/react-query";
import { apiFetch, type Schemas } from "@/lib/api";

export type Idea = Schemas["IdeaSummary"];
export type Graph = Schemas["GraphOut"];
export type IdeaDetail = Schemas["IdeaDetail"];

export const graphKey = ["knowledge-graph"] as const;
export const ideaKey = (id: string) => ["knowledge-graph", "idea", id] as const;

export const fetchGraph = () => apiFetch<Graph>("/knowledge-graph");
export const searchIdeas = (params: { q?: string; courseId?: string | null; sort?: "relevance" | "recent"; limit?: number }, signal?: AbortSignal) =>
  apiFetch<Idea[]>("/knowledge-graph/ideas", { query: params, signal });
export const fetchIdea = (id: string) => apiFetch<IdeaDetail>(`/knowledge-graph/ideas/${encodeURIComponent(id)}`);
export const deleteIdea = (id: string) => apiFetch<void>(`/knowledge-graph/ideas/${encodeURIComponent(id)}`, { method: "DELETE" });

export const useGraph = () => useQuery({ queryKey: graphKey, queryFn: fetchGraph });
export const useIdea = (id: string | null) => useQuery({ queryKey: ideaKey(id ?? ""), queryFn: () => fetchIdea(id!), enabled: !!id });
export function useIdeaSearch(q: string, courseId?: string | null, sort: "relevance" | "recent" = "relevance", limit = 30, enabled = true) {
  return useQuery({
    queryKey: ["knowledge-graph", "search", q, courseId ?? null, sort, limit],
    queryFn: ({ signal }) => searchIdeas({ q: q || undefined, courseId: courseId ?? undefined, sort, limit }, signal),
    enabled,
    placeholderData: (prev) => prev,
  });
}
