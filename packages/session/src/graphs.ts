import { buildPiContextProjection } from "./context.js";
import { buildPiSessionIndex } from "./parser.js";
import {
  entryLabel,
  messageRecord,
  messageRole,
  toolCalls,
} from "./records.js";
import type {
  PiSessionEntrySnapshot,
  PiSessionGraph,
  PiSessionGraphEdge,
  PiSessionGraphNode,
  PiSessionGraphNodeKind,
  PiSessionSnapshot,
} from "./types.js";

export function buildStructureGraph(snapshot: PiSessionSnapshot): PiSessionGraph {
  const activeSet = new Set(snapshot.activePathEntryIds);
  const nodes = snapshot.entries.map((entry) => entryNode(entry, activeSet.has(entry.id)));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = parentEdges(snapshot.entries, nodeIds);
  for (const entry of snapshot.entries) addSemanticEdges(entry, edges, nodeIds);
  return {
    projection: "structure",
    nodes,
    edges,
    rootNodeIds: snapshot.rootIds.map(entryNodeId),
    diagnostics: snapshot.diagnostics,
  };
}

export function buildExecutionGraph(snapshot: PiSessionSnapshot): PiSessionGraph {
  const activeSet = new Set(snapshot.activePathEntryIds);
  const diagnostics = [...snapshot.diagnostics];
  const included = snapshot.entries.filter(isExecutionEntry);
  const nodes = included.map((entry) => entryNode(entry, activeSet.has(entry.id)));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const index = buildPiSessionIndex(snapshot);
  const edges = collapsedParentEdges(included, nodeIds, index.byId);
  const toolNodeByCallId = new Map<string, string>();
  const resultCallIds = new Set<string>();

  for (const entry of included) {
    if (messageRole(entry) === "assistant") {
      for (const call of toolCalls(entry)) {
        const toolNodeId = `tool:${entry.id}:${call.id}`;
        if (toolNodeByCallId.has(call.id)) {
          diagnostics.push({
            code: "duplicate_tool_call_id",
            severity: "error",
            message: `Tool call id ${call.id} appears more than once.`,
            entryId: entry.id,
          });
        } else {
          toolNodeByCallId.set(call.id, toolNodeId);
        }
        nodes.push({
          id: toolNodeId,
          entryId: entry.id,
          kind: "toolCall",
          label: call.name,
          timestamp: entry.timestamp,
          onActivePath: activeSet.has(entry.id),
          data: {
            toolCallId: call.id,
            toolName: call.name,
            arguments: call.arguments,
          },
        });
        nodeIds.add(toolNodeId);
        edges.push({
          id: `invokes:${entry.id}:${call.id}`,
          source: entryNodeId(entry.id),
          target: toolNodeId,
          kind: "invokes",
        });
      }
    }
  }

  for (const entry of included) {
    if (messageRole(entry) !== "toolResult") continue;
    const callId = messageRecord(entry)?.toolCallId;
    if (typeof callId !== "string") continue;
    const toolNodeId = toolNodeByCallId.get(callId);
    if (!toolNodeId) {
      diagnostics.push({
        code: "orphan_tool_result",
        severity: "warning",
        message: `Tool result ${entry.id} references unknown tool call ${callId}.`,
        entryId: entry.id,
      });
      continue;
    }
    resultCallIds.add(callId);
    edges.push({
      id: `result:${callId}:${entry.id}`,
      source: toolNodeId,
      target: entryNodeId(entry.id),
      kind: "result",
    });
  }
  for (const [callId, nodeId] of toolNodeByCallId) {
    if (resultCallIds.has(callId)) continue;
    diagnostics.push({
      code: "missing_tool_result",
      severity: "warning",
      message: `Tool call ${callId} has no matching tool result.`,
      entryId: nodes.find((node) => node.id === nodeId)?.entryId ?? undefined,
    });
  }

  const roots = nodes
    .filter((node) => !edges.some((edge) => edge.kind === "parent" && edge.target === node.id))
    .map((node) => node.id);
  return {
    projection: "execution",
    nodes,
    edges,
    rootNodeIds: roots,
    diagnostics,
  };
}

export function buildContextGraph(
  snapshot: PiSessionSnapshot,
  leafId: string | null = snapshot.leafId,
): PiSessionGraph {
  const projection = buildPiContextProjection(snapshot, leafId);
  const index = buildPiSessionIndex(snapshot);
  const effectiveSet = new Set(projection.effectiveEntryIds);
  const pathSet = new Set(projection.pathEntryIds);
  const pathEntries = projection.pathEntryIds.flatMap((id) => {
    const entry = index.byId.get(id);
    return entry ? [entry] : [];
  });
  const nodes = pathEntries.map((entry) => ({
    ...entryNode(entry, true),
    inEffectiveContext: effectiveSet.has(entry.id),
  }));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = parentEdges(pathEntries, nodeIds);
  for (const entry of pathEntries) addSemanticEdges(entry, edges, nodeIds);
  return {
    projection: "context",
    nodes,
    edges,
    rootNodeIds: pathEntries.length > 0 ? [entryNodeId(pathEntries[0]!.id)] : [],
    diagnostics: [...snapshot.diagnostics, ...projection.diagnostics].filter(
      (diagnostic) => !diagnostic.entryId || pathSet.has(diagnostic.entryId),
    ),
  };
}

function entryNode(entry: PiSessionEntrySnapshot, onActivePath: boolean): PiSessionGraphNode {
  return {
    id: entryNodeId(entry.id),
    entryId: entry.id,
    kind: nodeKind(entry),
    label: entryLabel(entry),
    timestamp: entry.timestamp,
    onActivePath,
    data: {
      entryType: entry.type,
      known: entry.known,
      sourceLine: entry.sourceLine,
      raw: entry.raw,
    },
  };
}

function nodeKind(entry: PiSessionEntrySnapshot): PiSessionGraphNodeKind {
  const role = messageRole(entry);
  if (role === "user") return "user";
  if (role === "assistant") return "assistant";
  if (role === "toolResult") return "toolResult";
  if (entry.type === "compaction") return "compaction";
  if (entry.type === "branch_summary") return "branchSummary";
  if (entry.type === "custom_message") return "customMessage";
  if (
    entry.type === "model_change" ||
    entry.type === "thinking_level_change" ||
    entry.type === "label" ||
    entry.type === "session_info" ||
    entry.type === "custom"
  ) {
    return "metadata";
  }
  return "unknown";
}

function isExecutionEntry(entry: PiSessionEntrySnapshot): boolean {
  const role = messageRole(entry);
  return (
    role === "user" ||
    role === "assistant" ||
    role === "toolResult" ||
    entry.type === "compaction" ||
    entry.type === "branch_summary" ||
    entry.type === "custom_message"
  );
}

function parentEdges(
  entries: PiSessionEntrySnapshot[],
  nodeIds: ReadonlySet<string>,
): PiSessionGraphEdge[] {
  return entries.flatMap((entry) => {
    if (!entry.parentId) return [];
    const source = entryNodeId(entry.parentId);
    const target = entryNodeId(entry.id);
    return nodeIds.has(source) && nodeIds.has(target)
      ? [{ id: `parent:${entry.parentId}:${entry.id}`, source, target, kind: "parent" as const }]
      : [];
  });
}

function collapsedParentEdges(
  entries: PiSessionEntrySnapshot[],
  nodeIds: ReadonlySet<string>,
  byId: ReadonlyMap<string, PiSessionEntrySnapshot>,
): PiSessionGraphEdge[] {
  return entries.flatMap((entry) => {
    let parentId = entry.parentId;
    while (parentId && !nodeIds.has(entryNodeId(parentId))) {
      parentId = byId.get(parentId)?.parentId ?? null;
    }
    return parentId
      ? [
          {
            id: `parent:${parentId}:${entry.id}`,
            source: entryNodeId(parentId),
            target: entryNodeId(entry.id),
            kind: "parent" as const,
          },
        ]
      : [];
  });
}

function addSemanticEdges(
  entry: PiSessionEntrySnapshot,
  edges: PiSessionGraphEdge[],
  nodeIds: ReadonlySet<string>,
): void {
  if (entry.type === "branch_summary" && typeof entry.raw.fromId === "string") {
    addEdgeIfPresent(edges, nodeIds, {
      id: `summarizes:${entry.raw.fromId}:${entry.id}`,
      source: entryNodeId(entry.raw.fromId),
      target: entryNodeId(entry.id),
      kind: "summarizes",
    });
  }
  if (entry.type === "compaction" && typeof entry.raw.firstKeptEntryId === "string") {
    addEdgeIfPresent(edges, nodeIds, {
      id: `keepsFrom:${entry.raw.firstKeptEntryId}:${entry.id}`,
      source: entryNodeId(entry.raw.firstKeptEntryId),
      target: entryNodeId(entry.id),
      kind: "keepsFrom",
    });
  }
}

function addEdgeIfPresent(
  edges: PiSessionGraphEdge[],
  nodeIds: ReadonlySet<string>,
  edge: PiSessionGraphEdge,
): void {
  if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) edges.push(edge);
}

function entryNodeId(entryId: string): string {
  return `entry:${entryId}`;
}
