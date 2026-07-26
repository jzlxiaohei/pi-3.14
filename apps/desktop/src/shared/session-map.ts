import {
  buildPiSessionIndex,
  messageRole,
  textContent,
  toolCalls,
  type PiSessionEntrySnapshot,
  type PiSessionSnapshot,
} from "@pi-3.14/session";
import type {
  SessionMapDensity,
  SessionMapStructureEdge,
  SessionMapStructureGraph,
  SessionMapStructureNode,
} from "./desktop-contracts";

const PREVIEW_MAX = 120;

export function clampPreview(text: string, max = PREVIEW_MAX): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export function entryPreview(entry: PiSessionEntrySnapshot): string {
  if (entry.type === "compaction") {
    return typeof entry.raw.summary === "string"
      ? clampPreview(entry.raw.summary)
      : "上下文压缩";
  }
  if (entry.type === "branch_summary") {
    return typeof entry.raw.summary === "string"
      ? clampPreview(entry.raw.summary)
      : "分支摘要";
  }
  if (entry.type === "message") {
    const msg = entry.raw.message;
    if (msg && typeof msg === "object" && !Array.isArray(msg)) {
      const content = (msg as { content?: unknown }).content;
      const text = textContent(content as never);
      const role = messageRole(entry);
      if (role === "assistant") {
        const calls = toolCalls(entry);
        if (!text && calls.length > 0) {
          return clampPreview(calls.map((c) => c.name).join(", "));
        }
      }
      if (role === "toolResult") {
        const name =
          typeof (msg as { toolName?: unknown }).toolName === "string"
            ? String((msg as { toolName: string }).toolName)
            : "tool";
        return clampPreview(text || name);
      }
      return clampPreview(text || role || "message");
    }
  }
  if (entry.type === "model_change") {
    const id = entry.raw.modelId;
    return typeof id === "string" ? `model → ${id}` : "model change";
  }
  if (entry.type === "thinking_level_change") {
    const level = entry.raw.thinkingLevel;
    return typeof level === "string" ? `thinking → ${level}` : "thinking change";
  }
  return entry.type;
}

function entryKind(entry: PiSessionEntrySnapshot): SessionMapStructureNode["kind"] {
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

function isMapEligible(entry: PiSessionEntrySnapshot): boolean {
  const kind = entryKind(entry);
  return (
    kind === "user" ||
    kind === "assistant" ||
    kind === "toolResult" ||
    kind === "compaction" ||
    kind === "branchSummary" ||
    kind === "customMessage"
  );
}

function isMetadata(entry: PiSessionEntrySnapshot): boolean {
  return entryKind(entry) === "metadata" || entryKind(entry) === "unknown";
}

function nearestAncestorUser(
  entryId: string,
  byId: ReadonlyMap<string, PiSessionEntrySnapshot>,
): string | null {
  let cursor = byId.get(entryId);
  while (cursor) {
    if (messageRole(cursor) === "user") return cursor.id;
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return null;
}

function nearestAncestorUserParent(
  userEntryId: string,
  byId: ReadonlyMap<string, PiSessionEntrySnapshot>,
): string | null {
  const user = byId.get(userEntryId);
  if (!user?.parentId) return null;
  return nearestAncestorUser(user.parentId, byId);
}

/**
 * Build structure graph for Session Map (no raw message blobs).
 * Turn density: one node per user + rolled-up counts.
 * Entry density: one node per map-eligible entry (+ optional metadata via includeMeta).
 */
export function buildSessionMapStructure(
  snapshot: PiSessionSnapshot,
  density: SessionMapDensity,
  options?: { includeMetadata?: boolean },
): SessionMapStructureGraph {
  const index = buildPiSessionIndex(snapshot);
  const active = new Set(snapshot.activePathEntryIds);
  const includeMeta = options?.includeMetadata ?? density === "entry";

  if (density === "entry") {
    return buildEntryGraph(snapshot, index, active, includeMeta);
  }
  return buildTurnGraph(snapshot, index, active);
}

function buildEntryGraph(
  snapshot: PiSessionSnapshot,
  index: ReturnType<typeof buildPiSessionIndex>,
  active: Set<string>,
  includeMeta: boolean,
): SessionMapStructureGraph {
  const nodes: SessionMapStructureNode[] = [];
  const edges: SessionMapStructureEdge[] = [];
  const included = snapshot.entries.filter((e) => isMapEligible(e) || (includeMeta && isMetadata(e)));
  const idSet = new Set(included.map((e) => e.id));

  for (const entry of included) {
    const children = (index.childrenById.get(entry.id) ?? []).filter((c) => idSet.has(c.id));
    const userChildren = children.filter((c) => messageRole(c) === "user");
    const kind = entryKind(entry);
    nodes.push({
      id: entry.id,
      entryId: entry.id,
      kind,
      label: kind === "user" ? "你" : kind === "assistant" ? "助手" : kindLabel(kind),
      preview: entryPreview(entry),
      timestamp: entry.timestamp,
      onActivePath: active.has(entry.id),
      isFork: userChildren.length > 1 || children.filter((c) => isMapEligible(c)).length > 1,
      childCount: children.length,
    });
  }

  for (const entry of included) {
    if (!entry.parentId || !idSet.has(entry.parentId)) continue;
    edges.push({
      id: `e:${entry.parentId}->${entry.id}`,
      source: entry.parentId,
      target: entry.id,
      onActivePath: active.has(entry.parentId) && active.has(entry.id),
    });
  }

  return { nodes, edges, density: "entry" };
}

function buildTurnGraph(
  snapshot: PiSessionSnapshot,
  index: ReturnType<typeof buildPiSessionIndex>,
  active: Set<string>,
): SessionMapStructureGraph {
  const users = snapshot.entries.filter((e) => messageRole(e) === "user");
  const membersByUser = new Map<string, PiSessionEntrySnapshot[]>();

  for (const entry of snapshot.entries) {
    if (messageRole(entry) === "user") {
      const list = membersByUser.get(entry.id) ?? [];
      list.push(entry);
      membersByUser.set(entry.id, list);
      continue;
    }
    if (!isMapEligible(entry) && !isMetadata(entry)) continue;
    const owner = nearestAncestorUser(entry.id, index.byId);
    if (!owner) continue;
    const list = membersByUser.get(owner) ?? [];
    list.push(entry);
    membersByUser.set(owner, list);
  }

  const nodes: SessionMapStructureNode[] = [];
  const edges: SessionMapStructureEdge[] = [];
  const turnIds = new Set(users.map((u) => u.id));

  for (const user of users) {
    const members = membersByUser.get(user.id) ?? [user];
    let assistantCount = 0;
    let toolCount = 0;
    let metaCount = 0;
    let hasError = false;
    let lastAssistantPreview = "";
    for (const m of members) {
      const kind = entryKind(m);
      if (kind === "assistant") {
        assistantCount += 1;
        lastAssistantPreview = entryPreview(m);
        const msg = m.raw.message;
        if (
          msg &&
          typeof msg === "object" &&
          !Array.isArray(msg) &&
          (msg as { stopReason?: string }).stopReason === "error"
        ) {
          hasError = true;
        }
      } else if (kind === "toolResult") {
        toolCount += 1;
        const msg = m.raw.message;
        if (
          msg &&
          typeof msg === "object" &&
          !Array.isArray(msg) &&
          Boolean((msg as { isError?: boolean }).isError)
        ) {
          hasError = true;
        }
      } else if (kind === "metadata" || kind === "unknown") {
        metaCount += 1;
      }
    }
    const onPath = members.some((m) => active.has(m.id));
    const childUsers = users.filter((u) => nearestAncestorUserParent(u.id, index.byId) === user.id);
    nodes.push({
      id: `turn:${user.id}`,
      entryId: user.id,
      kind: "turn",
      label: "回合",
      preview: entryPreview(user),
      timestamp: user.timestamp,
      onActivePath: onPath,
      isFork: childUsers.length > 1,
      childCount: childUsers.length,
      memberEntryIds: members.map((m) => m.id),
      assistantCount,
      toolCount,
      metaCount,
      hasError,
      subtitle:
        [
          assistantCount > 0 ? `回复 ${assistantCount}` : null,
          toolCount > 0 ? `工具 ${toolCount}` : null,
          metaCount > 0 ? `+${metaCount} meta` : null,
          lastAssistantPreview ? clampPreview(lastAssistantPreview, 60) : null,
        ]
          .filter(Boolean)
          .join(" · ") || undefined,
    });
  }

  // Leading non-user map nodes without user ancestor (e.g. early compaction)
  for (const entry of snapshot.entries) {
    if (!isMapEligible(entry) || messageRole(entry) === "user") continue;
    if (nearestAncestorUser(entry.id, index.byId)) continue;
    nodes.push({
      id: entry.id,
      entryId: entry.id,
      kind: entryKind(entry),
      label: kindLabel(entryKind(entry)),
      preview: entryPreview(entry),
      timestamp: entry.timestamp,
      onActivePath: active.has(entry.id),
      isFork: false,
      childCount: 0,
    });
  }

  for (const user of users) {
    const parentUser = nearestAncestorUserParent(user.id, index.byId);
    if (parentUser && turnIds.has(parentUser)) {
      edges.push({
        id: `t:${parentUser}->${user.id}`,
        source: `turn:${parentUser}`,
        target: `turn:${user.id}`,
        onActivePath: active.has(parentUser) && active.has(user.id),
      });
    }
  }

  return { nodes, edges, density: "turn" };
}

function kindLabel(kind: SessionMapStructureNode["kind"]): string {
  switch (kind) {
    case "user":
      return "你";
    case "assistant":
      return "助手";
    case "toolResult":
      return "工具";
    case "compaction":
      return "压缩";
    case "branchSummary":
      return "分支摘要";
    case "customMessage":
      return "自定义";
    case "metadata":
      return "元数据";
    case "turn":
      return "回合";
    default:
      return "条目";
  }
}

/**
 * Resolve which leaf to use for context projection when selecting a map node.
 */
export function resolveSessionMapLeaf(
  snapshot: PiSessionSnapshot,
  selectionEntryId: string,
): string {
  const index = buildPiSessionIndex(snapshot);
  if (!index.byId.has(selectionEntryId)) {
    return snapshot.leafId ?? selectionEntryId;
  }

  const subtree = collectSubtreeIds(selectionEntryId, index);
  const activeInSubtree = snapshot.activePathEntryIds.filter((id) => subtree.has(id));
  if (activeInSubtree.length > 0) {
    // Deepest on active path = last in activePath that is in subtree
    return activeInSubtree[activeInSubtree.length - 1]!;
  }

  // Canonical leaf: max append index among subtree
  let bestId = selectionEntryId;
  let bestIdx = index.appendIndexById.get(selectionEntryId) ?? -1;
  for (const id of subtree) {
    const idx = index.appendIndexById.get(id) ?? -1;
    if (idx > bestIdx) {
      bestIdx = idx;
      bestId = id;
    }
  }
  return bestId;
}

function collectSubtreeIds(
  rootId: string,
  index: ReturnType<typeof buildPiSessionIndex>,
): Set<string> {
  const out = new Set<string>();
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    for (const child of index.childrenById.get(id) ?? []) {
      stack.push(child.id);
    }
  }
  return out;
}

export function countSessionMapStats(snapshot: PiSessionSnapshot): {
  entryCount: number;
  messageCount: number;
  compactionCount: number;
  branchPointCount: number;
} {
  const index = buildPiSessionIndex(snapshot);
  let messageCount = 0;
  let compactionCount = 0;
  for (const e of snapshot.entries) {
    if (e.type === "message") messageCount += 1;
    if (e.type === "compaction") compactionCount += 1;
  }
  const branchPointCount = [...index.childrenById.entries()].filter(
    ([parentId, children]) => parentId !== null && children.length > 1,
  ).length;
  return {
    entryCount: snapshot.entries.length,
    messageCount,
    compactionCount,
    branchPointCount,
  };
}
