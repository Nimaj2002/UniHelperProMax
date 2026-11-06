/**
 * 022 research R12: where each idea sits — a force layout (d3-force), computed once per graph
 * version and warm-started from the last positions so a graph that grows doesn't jump around.
 * Deterministic: d3 places new nodes on a fixed spiral, and the simulation runs a fixed number of
 * ticks without timers.
 */
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, type SimulationNodeDatum } from "d3-force";

export interface Pos {
  x: number;
  y: number;
}

interface Node extends SimulationNodeDatum {
  id: string;
}

export function layout(
  ideas: { id: string }[],
  links: { premiseIds: string[]; conclusionId: string }[],
  previous?: Map<string, Pos>,
): Map<string, Pos> {
  const nodes: Node[] = ideas.map((i) => {
    const p = previous?.get(i.id);
    return p ? { id: i.id, x: p.x, y: p.y } : { id: i.id };
  });
  const ids = new Set(ideas.map((i) => i.id));
  const edges = links.flatMap((l) =>
    l.premiseIds.filter((p) => ids.has(p) && ids.has(l.conclusionId)).map((p) => ({ source: p, target: l.conclusionId })),
  );
  const big = nodes.length > 1000;
  const sim = forceSimulation(nodes)
    .force("link", forceLink<Node, { source: string; target: string }>(edges).id((d) => d.id).distance(50))
    .force("charge", forceManyBody().strength(-90).theta(0.9).distanceMax(400))
    .force("center", forceCenter(0, 0))
    .stop();
  // overlap removal is the costliest force: small graphs only
  if (!big) sim.force("collide", forceCollide(10));
  // fewer steps for big graphs and for a warm start (SC-009: a 2,000-idea graph opens in < 2 s)
  const fresh = nodes.filter((n) => !previous?.has(n.id)).length;
  const ticks = fresh === 0 ? 0 : big ? 60 : previous ? 150 : 300;
  if (big) sim.alphaDecay(1 - Math.pow(0.001, 1 / ticks)); // cool down within the shorter run
  sim.tick(ticks);
  return new Map(nodes.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]));
}

// the last layout, kept between visits so a grown graph is laid out from where it was
let last: Map<string, Pos> | undefined;

/** `layout`, warm-started from the previous call's positions. */
export function layoutWarm(ideas: { id: string }[], links: { premiseIds: string[]; conclusionId: string }[]): Map<string, Pos> {
  last = layout(ideas, links, last);
  return last;
}
