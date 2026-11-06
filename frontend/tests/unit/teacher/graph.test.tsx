/** 022 T062/T068: the knowledge graph — layout speed, keyboard moves, list view, detail, delete. */
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { fitView, neighbourInDirection } from "@/features/graph/GraphCanvas";
import { GraphSection } from "@/features/graph/GraphSection";
import { layout } from "@/features/graph/layout";
import { json, mockFetch, on, renderWithProviders } from "../test-utils";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

const idea = (id: string, name: string) => ({ id, name, statement: `${name} statement.`, courseIds: ["c1"], sourceCount: 1, updatedAt: "2026-11-05T10:00:00Z" });

afterEach(() => vi.unstubAllGlobals());

describe("layout", () => {
  it("lays out 2,000 ideas fast and deterministically (SC-009)", () => {
    const ideas = Array.from({ length: 2000 }, (_, i) => ({ id: `i${i}` }));
    const links = Array.from({ length: 3000 }, (_, i) => ({ premiseIds: [`i${i % 2000}`], conclusionId: `i${(i * 7 + 1) % 2000}` }));
    const t = performance.now();
    const a = layout(ideas, links);
    expect(performance.now() - t).toBeLessThan(1500);
    expect(a.size).toBe(2000);
    expect(layout(ideas.slice(0, 50), links.slice(0, 40))).toEqual(layout(ideas.slice(0, 50), links.slice(0, 40)));
    // a warm start with nothing new keeps every position
    expect(layout(ideas, links, a)).toEqual(a);
  });

  it("fits the view and moves to the neighbour in an arrow's direction", () => {
    const pos = new Map([["a", { x: 0, y: 0 }], ["b", { x: 100, y: 0 }]]);
    const v = fitView(pos, 300, 200);
    expect(v.k).toBeGreaterThan(0);
    const cands = [{ id: "r", p: { x: 10, y: 1 } }, { id: "l", p: { x: -10, y: 0 } }, { id: "d", p: { x: 0, y: 10 } }];
    expect(neighbourInDirection({ x: 0, y: 0 }, cands, "ArrowRight")).toBe("r");
    expect(neighbourInDirection({ x: 0, y: 0 }, cands, "ArrowLeft")).toBe("l");
    expect(neighbourInDirection({ x: 0, y: 0 }, cands, "ArrowDown")).toBe("d");
    expect(neighbourInDirection({ x: 0, y: 0 }, cands, "ArrowUp")).toBeNull();
  });
});

describe("GraphSection", () => {
  const graph = {
    version: "v1",
    ideas: [idea("i1", "Determinant"), idea("i2", "Singular matrix")],
    links: [{ id: "l1", premiseIds: ["i1"], conclusionId: "i2" }],
  };

  it("explains an empty graph", async () => {
    mockFetch(on("GET", "/api/v1/knowledge-graph", () => json({ version: "0", ideas: [], links: [] })));
    renderWithProviders(<GraphSection />);
    expect(await screen.findByText("Ideas appear here as lessons are taught.")).toBeInTheDocument();
  });

  it("lists, searches and opens an idea with its links and sources, then deletes it", async () => {
    const del = vi.fn(() => new Response(null, { status: 204 }));
    mockFetch(
      on("GET", "/api/v1/knowledge-graph", () => json(graph)),
      on("GET", "/api/v1/knowledge-graph/ideas/i2", () =>
        json({
          ...idea("i2", "Singular matrix"),
          followsFrom: [{ linkId: "l1", premises: [idea("i1", "Determinant")] }],
          leadsTo: [],
          sources: [{ chatId: "t1", chatTitle: "Determinants lesson", sessionKey: "s1", sessionLabel: "Linear Algebra · Tue", courseId: "c1", messageId: "a1", createdAt: "t", available: true }],
        }),
      ),
      on("DELETE", "/api/v1/knowledge-graph/ideas/i2", del),
    );
    const { container } = renderWithProviders(<GraphSection />);
    expect(await screen.findByRole("img", { name: /Knowledge graph, 2 ideas/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "List" }));
    await userEvent.type(screen.getByLabelText("Search ideas"), "singular");
    const list = screen.getByRole("list", { name: "Ideas" });
    expect(list.textContent).toContain("Singular matrix");
    expect(list.textContent).not.toContain("Determinant statement");
    await userEvent.click(screen.getByRole("button", { name: /Singular matrix/ }));
    expect(await screen.findByText("Follows from")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Determinants lesson/ })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(screen.getByRole("button", { name: "Delete idea" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(del).toHaveBeenCalled();
  });
});
