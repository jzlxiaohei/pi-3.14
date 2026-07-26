import { Graph, layout } from "@dagrejs/dagre";
import type {
  SessionMapStructureEdge,
  SessionMapStructureGraph,
  SessionMapStructureNode,
} from "../../../../../shared/desktop-contracts";

export const MAP_NODE_WIDTH_TURN = 248;
export const MAP_NODE_HEIGHT_TURN = 92;
export const MAP_NODE_WIDTH_ENTRY = 200;
export const MAP_NODE_HEIGHT_ENTRY = 64;

export type LaidOutSessionMapNode = SessionMapStructureNode & {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type LaidOutSessionMapEdge = SessionMapStructureEdge & {
  points: Array<{ x: number; y: number }>;
};

export type LaidOutSessionMapGraph = {
  nodes: LaidOutSessionMapNode[];
  edges: LaidOutSessionMapEdge[];
  width: number;
  height: number;
};

export function layoutSessionMap(graph: SessionMapStructureGraph): LaidOutSessionMapGraph {
  if (graph.nodes.length === 0) {
    return { nodes: [], edges: [], width: 0, height: 0 };
  }

  const isTurn = graph.density === "turn";
  const g = new Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: "TB",
    nodesep: isTurn ? 40 : 28,
    ranksep: isTurn ? 52 : 40,
    marginx: 28,
    marginy: 28,
  });

  for (const node of graph.nodes) {
    const width = isTurn && node.kind === "turn" ? MAP_NODE_WIDTH_TURN : MAP_NODE_WIDTH_ENTRY;
    const height = isTurn && node.kind === "turn" ? MAP_NODE_HEIGHT_TURN : MAP_NODE_HEIGHT_ENTRY;
    g.setNode(node.id, { width, height });
  }

  for (const edge of graph.edges) {
    if (!g.hasNode(edge.source) || !g.hasNode(edge.target)) continue;
    g.setEdge(edge.source, edge.target);
  }

  layout(g);

  const nodes: LaidOutSessionMapNode[] = [];
  for (const id of g.nodes()) {
    const raw = g.node(id) as { x: number; y: number; width: number; height: number };
    const source = graph.nodes.find((n) => n.id === id);
    if (!source) continue;
    nodes.push({
      ...source,
      x: raw.x - raw.width / 2,
      y: raw.y - raw.height / 2,
      width: raw.width,
      height: raw.height,
    });
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges: LaidOutSessionMapEdge[] = [];
  for (const edge of graph.edges) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target) continue;
    const routed = g.edge(edge.source, edge.target) as
      | { points?: Array<{ x: number; y: number }> }
      | undefined;
    const points =
      routed?.points && routed.points.length > 0
        ? routed.points
        : [
            { x: source.x + source.width / 2, y: source.y + source.height },
            { x: target.x + target.width / 2, y: target.y },
          ];
    edges.push({ ...edge, points });
  }

  const graphLabel = g.graph() as { width?: number; height?: number };
  return {
    nodes,
    edges,
    width: graphLabel.width ?? 0,
    height: graphLabel.height ?? 0,
  };
}

export function pointsToPath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return "";
  if (points.length === 1) {
    const p = points[0]!;
    return `M ${p.x} ${p.y}`;
  }
  if (points.length === 2) {
    const a = points[0]!;
    const b = points[1]!;
    const midY = (a.y + b.y) / 2;
    return `M ${a.x} ${a.y} L ${a.x} ${midY} L ${b.x} ${midY} L ${b.x} ${b.y}`;
  }
  const [first, ...rest] = points;
  let d = `M ${first!.x} ${first!.y}`;
  for (const point of rest) {
    d += ` L ${point.x} ${point.y}`;
  }
  return d;
}
