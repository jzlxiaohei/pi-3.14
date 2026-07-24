import {
  buildPiSessionIndex,
  messageRecord,
  messageRole,
  textContent,
  type PiSessionSnapshot,
} from "@pi-3.14/session";
import type {
  PiBranchFlowEdge,
  PiBranchFlowGraph,
  PiBranchFlowNode,
  PiBranchForkChip,
  PiBranchSpineNode,
  PiBranchSpineView,
  PiBranchTreeNode,
} from "./desktop-contracts";

/**
 * Build a user-centric tree for the Branches popover.
 * Consecutive assistant/tool stretches collapse into one turn_summary node.
 */
export function buildBranchTree(snapshot: PiSessionSnapshot): PiBranchTreeNode[] {
  const index = buildPiSessionIndex(snapshot);
  const active = new Set(snapshot.activePathEntryIds);
  return buildChildren(null, index, active);
}

/** Active-path spine + sibling fork chips + collapsed alternate roots. */
export function buildBranchSpineView(snapshot: PiSessionSnapshot): PiBranchSpineView {
  const index = buildPiSessionIndex(snapshot);
  const active = new Set(snapshot.activePathEntryIds);
  const spine = buildSpine(snapshot.activePathEntryIds, index, active);
  const otherRoots = rootUserForks(index, active).filter((fork) => !fork.onActivePath);
  return {
    spine,
    otherRoots,
    forkPoint: detectForkPoint(snapshot.leafId, index, active),
  };
}

/** Flatten collapsed branch tree into nodes/edges for the flow panel. */
export function buildBranchFlowGraph(snapshot: PiSessionSnapshot): PiBranchFlowGraph {
  const roots = buildBranchTree(snapshot);
  const index = buildPiSessionIndex(snapshot);
  const active = new Set(snapshot.activePathEntryIds);
  const nodes: PiBranchFlowNode[] = [];
  const edges: PiBranchFlowEdge[] = [];
  const seen = new Set<string>();

  function walk(node: PiBranchTreeNode, parentId: string | null): void {
    if (
      node.kind === "user" &&
      isAbandonedUnansweredUser(node.entryId, index, active)
    ) {
      return;
    }
    if (!seen.has(node.entryId)) {
      seen.add(node.entryId);
      const entry = index.byId.get(node.entryId);
      const full =
        node.kind === "user" && entry
          ? textContent(messageRecord(entry)?.content).trim() || node.label
          : node.label;
      nodes.push({
        id: node.entryId,
        kind: node.kind,
        label: truncateLabel(full, 42),
        preview: turnPreview(node.kind, node.onActivePath, full),
        onActivePath: node.onActivePath,
        isFork: node.childCount > 1,
        childCount: node.childCount,
      });
    }
    if (parentId) {
      const edgeId = `${parentId}->${node.entryId}`;
      edges.push({
        id: edgeId,
        source: parentId,
        target: node.entryId,
        onActivePath: node.onActivePath,
      });
    }
    for (const child of node.children) {
      walk(child, node.entryId);
    }
  }

  for (const root of roots) {
    walk(root, null);
  }

  return {
    nodes,
    edges,
    forkPoint: detectForkPoint(snapshot.leafId, index, active),
  };
}

function buildChildren(
  parentId: string | null,
  index: ReturnType<typeof buildPiSessionIndex>,
  active: Set<string>,
): PiBranchTreeNode[] {
  const kids = index.childrenById.get(parentId) ?? [];
  const out: PiBranchTreeNode[] = [];

  for (const entry of kids) {
    // Context injection only — not a conversation fork node on the graph.
    if (entry.type === "branch_summary") {
      out.push(...buildChildren(entry.id, index, active));
      continue;
    }

    if (messageRole(entry) === "user") {
      const children = buildChildren(entry.id, index, active);
      out.push({
        entryId: entry.id,
        kind: "user",
        label: truncateLabel(textContent(messageRecord(entry)?.content)) || "(empty message)",
        onActivePath: active.has(entry.id),
        childCount: children.length,
        children,
      });
      continue;
    }

    // Collapse linear non-user chain; hang forks off the chain tip.
    const chain = linearNonUserChain(entry.id, index);
    const tipId = chain.at(-1) ?? entry.id;
    const children = buildChildren(tipId, index, active);
    const onActivePath = chain.some((id) => active.has(id));
    out.push({
      entryId: tipId,
      kind: "turn_summary",
      label: formatTurnLabel(chain, index, onActivePath),
      onActivePath,
      childCount: children.length,
      children,
    });
  }

  return out;
}

function buildSpine(
  activePathEntryIds: string[],
  index: ReturnType<typeof buildPiSessionIndex>,
  active: Set<string>,
): PiBranchSpineNode[] {
  const spine: PiBranchSpineNode[] = [];
  let i = 0;
  while (i < activePathEntryIds.length) {
    const id = activePathEntryIds[i]!;
    const entry = index.byId.get(id);
    if (!entry) {
      i += 1;
      continue;
    }

    if (entry.type === "branch_summary") {
      i += 1;
      continue;
    }

    if (messageRole(entry) === "user") {
      spine.push({
        entryId: entry.id,
        kind: "user",
        label: truncateLabel(textContent(messageRecord(entry)?.content)) || "(empty message)",
        siblingForks: siblingUserForks(entry.parentId, index, active),
      });
      i += 1;
      continue;
    }

    const chainIds: string[] = [];
    while (i < activePathEntryIds.length) {
      const nextId = activePathEntryIds[i]!;
      const next = index.byId.get(nextId);
      if (!next || messageRole(next) === "user" || next.type === "branch_summary") break;
      chainIds.push(nextId);
      i += 1;
    }
    if (chainIds.length === 0) {
      i += 1;
      continue;
    }
    const tipId = chainIds.at(-1)!;
    spine.push({
      entryId: tipId,
      kind: "turn_summary",
      label: formatTurnLabel(chainIds, index, true),
      siblingForks: [],
    });
  }
  return spine;
}

function siblingUserForks(
  parentId: string | null,
  index: ReturnType<typeof buildPiSessionIndex>,
  active: Set<string>,
): PiBranchForkChip[] {
  return (index.childrenById.get(parentId) ?? [])
    .filter((entry) => messageRole(entry) === "user")
    // Amend of an unanswered prompt leaves a childless sibling in JSONL; hide it.
    .filter((entry) => !isAbandonedUnansweredUser(entry.id, index, active))
    .map((entry) => ({
      entryId: entry.id,
      label: truncateLabel(textContent(messageRecord(entry)?.content), 28) || "(empty)",
      onActivePath: active.has(entry.id),
    }));
}

/** Off-path user leaf with no children — typo/amend residue, not a real alternate. */
function isAbandonedUnansweredUser(
  entryId: string,
  index: ReturnType<typeof buildPiSessionIndex>,
  active: Set<string>,
): boolean {
  if (active.has(entryId)) return false;
  return (index.childrenById.get(entryId) ?? []).length === 0;
}

function rootUserForks(
  index: ReturnType<typeof buildPiSessionIndex>,
  active: Set<string>,
): PiBranchForkChip[] {
  return siblingUserForks(null, index, active);
}

function detectForkPoint(
  leafId: string | null,
  index: ReturnType<typeof buildPiSessionIndex>,
  active: Set<string>,
): PiBranchSpineView["forkPoint"] {
  if (!leafId) {
    const roots = rootUserForks(index, active);
    if (roots.length === 0 || roots.some((fork) => fork.onActivePath)) return null;
    return { siblingForks: roots };
  }

  const userKids = (index.childrenById.get(leafId) ?? []).filter(
    (entry) =>
      messageRole(entry) === "user" &&
      !isAbandonedUnansweredUser(entry.id, index, active),
  );
  if (userKids.length === 0) return null;
  if (userKids.some((entry) => active.has(entry.id))) return null;
  return {
    siblingForks: userKids.map((entry) => ({
      entryId: entry.id,
      label: truncateLabel(textContent(messageRecord(entry)?.content), 28) || "(empty)",
      onActivePath: false,
    })),
  };
}

/** Follow single-child non-user links; stop before a user, fork, or branch_summary. */
function linearNonUserChain(
  startId: string,
  index: ReturnType<typeof buildPiSessionIndex>,
): string[] {
  const ids = [startId];
  let cursor = startId;
  for (;;) {
    const kids = index.childrenById.get(cursor) ?? [];
    if (kids.length !== 1) break;
    const only = kids[0]!;
    if (messageRole(only) === "user" || only.type === "branch_summary") break;
    ids.push(only.id);
    cursor = only.id;
  }
  return ids;
}

function formatTurnLabel(
  chainIds: string[],
  index: ReturnType<typeof buildPiSessionIndex>,
  onActivePath: boolean,
): string {
  const tools = countTools(chainIds, index);
  const detail = tools > 0 ? `${tools} tool${tools === 1 ? "" : "s"}` : "文本回复";
  // Off-path turns are usually left behind by edit/resend — not a "tool branch".
  return onActivePath ? `回复 · ${detail}` : `旧回复 · ${detail}`;
}

function countTools(
  entryIds: string[],
  index: ReturnType<typeof buildPiSessionIndex>,
): number {
  let count = 0;
  for (const id of entryIds) {
    const entry = index.byId.get(id);
    if (!entry || messageRole(entry) !== "assistant") continue;
    const content = messageRecord(entry)?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (
        typeof block === "object" &&
        block !== null &&
        "type" in block &&
        (block as { type?: unknown }).type === "toolCall"
      ) {
        count += 1;
      }
    }
  }
  return count;
}

function truncateLabel(text: string, max = 64): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 1)}…`;
}

function turnPreview(
  kind: PiBranchTreeNode["kind"],
  onActivePath: boolean,
  body: string,
): string {
  if (onActivePath) return body;
  if (kind === "turn_summary") {
    return `已离开的模型回合（常见于 edit / 重发后留下的旧回复），不是工具自己分叉。\n\n${body}`;
  }
  return `旁支上的用户消息（仍可切换回来继续聊）。\n\n${body}`;
}

/** Deepest descendant entry id under `entryId` (first-child walk), for branch switch. */
export function findBranchLeaf(
  roots: PiBranchTreeNode[],
  entryId: string,
): string | null {
  const node = findNode(roots, entryId);
  if (!node) return null;
  let cursor: PiBranchTreeNode = node;
  while (cursor.children.length > 0) {
    const preferred =
      cursor.children.find((child) => child.onActivePath) ?? cursor.children[0];
    if (!preferred) break;
    cursor = preferred;
  }
  return cursor.entryId;
}

function findNode(nodes: PiBranchTreeNode[], entryId: string): PiBranchTreeNode | null {
  for (const node of nodes) {
    if (node.entryId === entryId) return node;
    const nested = findNode(node.children, entryId);
    if (nested) return nested;
  }
  return null;
}
