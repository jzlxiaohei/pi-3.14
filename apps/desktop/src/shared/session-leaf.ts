import { buildPiSessionIndex, type PiSessionSnapshot } from "@pi-3.14/session";

/**
 * Re-resolve active path for a live SessionManager leaf.
 * File parse leafId is the last appended entry and can diverge after navigate.
 */
export function snapshotAtLeaf(
  snapshot: PiSessionSnapshot,
  leafEntryId: string | null,
): PiSessionSnapshot {
  if (!leafEntryId || leafEntryId === snapshot.leafId) {
    if (leafEntryId === snapshot.leafId) return snapshot;
    // Explicit null leaf (before first entry) — empty active path.
    if (leafEntryId === null && snapshot.leafId !== null) {
      return { ...snapshot, leafId: null, activePathEntryIds: [] };
    }
    return snapshot;
  }

  const index = buildPiSessionIndex(snapshot);
  if (!index.byId.has(leafEntryId)) return snapshot;

  const reversed: string[] = [];
  const seen = new Set<string>();
  let cursor = index.byId.get(leafEntryId);
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    reversed.push(cursor.id);
    cursor = cursor.parentId ? index.byId.get(cursor.parentId) : undefined;
  }
  reversed.reverse();
  return {
    ...snapshot,
    leafId: leafEntryId,
    activePathEntryIds: reversed,
  };
}
