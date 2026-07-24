import { Graph, layout } from "@dagrejs/dagre";
import type {
  PiBranchFlowGraph,
  PiCompactionDetail,
} from "../../../../../shared/desktop-contracts";

export const BRANCH_NODE_WIDTH = 220;
/** Padding + kind + 2 lines of label (must match CSS line-clamp). */
export const BRANCH_NODE_HEIGHT_USER = 72;
export const BRANCH_NODE_HEIGHT_SUMMARY = 72;
export const BRANCH_NODE_HEIGHT_COMPACTION = 72;

export type LaidOutBranchNode = {
  id: string;
  kind: "user" | "turn_summary" | "compaction";
  label: string;
  preview: string;
  onActivePath: boolean;
  isFork: boolean;
  childCount: number;
  tags?: string[];
  compaction?: PiCompactionDetail;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type LaidOutBranchEdge = {
  id: string;
  source: string;
  target: string;
  onActivePath: boolean;
  points: Array<{ x: number; y: number }>;
};

export type LaidOutBranchGraph = {
  nodes: LaidOutBranchNode[];
  edges: LaidOutBranchEdge[];
  width: number;
  height: number;
};

/** Run dagre TB layout over a branch flow graph. */
export function layoutBranchFlow(graph: PiBranchFlowGraph): LaidOutBranchGraph {
  if (graph.nodes.length === 0) {
    return { nodes: [], edges: [], width: 0, height: 0 };
  }

  const g = new Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: "TB",
    nodesep: 36,
    ranksep: 48,
    marginx: 24,
    marginy: 24,
  });

  for (const node of graph.nodes) {
    const height =
      node.kind === "user"
        ? BRANCH_NODE_HEIGHT_USER
        : node.kind === "compaction"
          ? BRANCH_NODE_HEIGHT_COMPACTION
          : BRANCH_NODE_HEIGHT_SUMMARY;
    g.setNode(node.id, {
      width: BRANCH_NODE_WIDTH,
      height,
      label: node.label,
      kind: node.kind,
      onActivePath: node.onActivePath,
    });
  }

  for (const edge of graph.edges) {
    if (!g.hasNode(edge.source) || !g.hasNode(edge.target)) continue;
    g.setEdge(edge.source, edge.target, { onActivePath: edge.onActivePath });
  }

  layout(g);

  const nodes: LaidOutBranchNode[] = [];
  for (const id of g.nodes()) {
    const raw = g.node(id) as {
      x: number;
      y: number;
      width: number;
      height: number;
      label?: string;
      kind?: "user" | "turn_summary" | "compaction";
      onActivePath?: boolean;
    };
    const source = graph.nodes.find((node) => node.id === id);
    nodes.push({
      id,
      kind: source?.kind ?? raw.kind ?? "user",
      label: source?.label ?? raw.label ?? id,
      preview: source?.preview ?? source?.label ?? raw.label ?? id,
      onActivePath: source?.onActivePath ?? Boolean(raw.onActivePath),
      isFork: source?.isFork ?? false,
      childCount: source?.childCount ?? 0,
      ...(source?.tags?.length ? { tags: source.tags } : {}),
      ...(source?.compaction ? { compaction: source.compaction } : {}),
      x: raw.x - raw.width / 2,
      y: raw.y - raw.height / 2,
      width: raw.width,
      height: raw.height,
    });
  }

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const edges: LaidOutBranchEdge[] = [];
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
    edges.push({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      onActivePath: edge.onActivePath,
      points,
    });
  }

  const graphLabel = g.graph() as { width?: number; height?: number };
  return {
    nodes,
    edges,
    width: graphLabel.width ?? 0,
    height: graphLabel.height ?? 0,
  };
}

/** Polyline path; keep open (stroke-only) — never close/fill. */
export function pointsToPath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return "";
  if (points.length === 1) {
    const p = points[0]!;
    return `M ${p.x} ${p.y}`;
  }
  // Prefer simple elbow: source → midY bend → target (avoids filled-looking diagonals).
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
