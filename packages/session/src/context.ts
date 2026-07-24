import type { PiModelRef, PiThinkingLevel } from "@pi-3.14/model";
import { buildPiSessionIndex } from "./parser.js";
import {
  jsonObject,
  messageRecord,
  messageRole,
  modelRef,
  textContent,
  thinkingContent,
  thinkingLevel,
  toolCalls,
} from "./records.js";
import type {
  PiContextProjection,
  PiEffectiveMessage,
  PiSessionDiagnostic,
  PiSessionEntrySnapshot,
  PiSessionSnapshot,
} from "./types.js";

export function buildPiContextProjection(
  snapshot: PiSessionSnapshot,
  leafId: string | null = snapshot.leafId,
): PiContextProjection {
  const index = buildPiSessionIndex(snapshot);
  const diagnostics: PiSessionDiagnostic[] = [];
  const path = resolvePath(leafId, index.byId, diagnostics);
  const latestCompactionIndex = findLatestCompaction(path);
  let latestCompaction: PiContextProjection["latestCompaction"] = null;
  let effective: PiSessionEntrySnapshot[];

  if (latestCompactionIndex < 0) {
    effective = path;
  } else {
    const compaction = path[latestCompactionIndex]!;
    const firstKeptEntryId =
      typeof compaction.raw.firstKeptEntryId === "string"
        ? compaction.raw.firstKeptEntryId
        : "";
    const firstKeptIndex = path.findIndex((entry) => entry.id === firstKeptEntryId);
    latestCompaction = {
      entryId: compaction.id,
      firstKeptEntryId,
      tokensBefore:
        typeof compaction.raw.tokensBefore === "number" ? compaction.raw.tokensBefore : null,
    };
    if (firstKeptIndex < 0 || firstKeptIndex >= latestCompactionIndex) {
      diagnostics.push({
        code: "invalid_compaction_anchor",
        severity: "error",
        message: `Compaction ${compaction.id} references firstKeptEntryId ${firstKeptEntryId || "(missing)"} outside its earlier active path.`,
        entryId: compaction.id,
        ...(firstKeptEntryId ? { relatedEntryIds: [firstKeptEntryId] } : {}),
      });
      effective = [compaction, ...path.slice(latestCompactionIndex + 1)];
    } else {
      effective = [
        compaction,
        ...path.slice(firstKeptIndex, latestCompactionIndex),
        ...path.slice(latestCompactionIndex + 1),
      ];
    }
  }

  const effectiveEntryIds = effective.map((entry) => entry.id);
  const effectiveSet = new Set(effectiveEntryIds);
  const state = resolveRuntimeState(path);
  return {
    leafId,
    pathEntryIds: path.map((entry) => entry.id),
    effectiveEntryIds,
    excludedPathEntryIds: path
      .filter((entry) => !effectiveSet.has(entry.id))
      .map((entry) => entry.id),
    messages: effective.flatMap(toEffectiveMessage),
    model: state.model,
    thinkingLevel: state.thinkingLevel,
    latestCompaction,
    recoverability: {
      exactFromJsonl: [
        "messages",
        "entryTree",
        "activePath",
        "modelChanges",
        "thinkingLevelChanges",
        "usage",
        "compaction",
      ],
      unavailableFromJsonl: ["systemPrompt", "tools", "skills"],
    },
    diagnostics,
  };
}

/**
 * Full active-path messages in chronological order (root → leaf).
 * Unlike {@link buildPiContextProjection}, this does **not** collapse pre-compaction
 * history — intended for UI timelines so users can still read earlier turns.
 */
export function buildPiPathMessages(
  snapshot: PiSessionSnapshot,
  leafId: string | null = snapshot.leafId,
): {
  leafId: string | null;
  pathEntryIds: string[];
  messages: PiEffectiveMessage[];
} {
  const index = buildPiSessionIndex(snapshot);
  const diagnostics: PiSessionDiagnostic[] = [];
  const path = resolvePath(leafId, index.byId, diagnostics);
  return {
    leafId,
    pathEntryIds: path.map((entry) => entry.id),
    messages: path.flatMap(toEffectiveMessage),
  };
}

function resolvePath(
  leafId: string | null,
  byId: ReadonlyMap<string, PiSessionEntrySnapshot>,
  diagnostics: PiSessionDiagnostic[],
): PiSessionEntrySnapshot[] {
  const reversed: PiSessionEntrySnapshot[] = [];
  const seen = new Set<string>();
  let cursor = leafId ? byId.get(leafId) : undefined;
  while (cursor) {
    if (seen.has(cursor.id)) {
      diagnostics.push({
        code: "cycle",
        severity: "error",
        message: `Cycle detected while resolving context path at ${cursor.id}.`,
        entryId: cursor.id,
      });
      break;
    }
    seen.add(cursor.id);
    reversed.push(cursor);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return reversed.reverse();
}

function findLatestCompaction(path: PiSessionEntrySnapshot[]): number {
  let latest = -1;
  for (const [index, entry] of path.entries()) {
    if (entry.type === "compaction") latest = index;
  }
  return latest;
}

function resolveRuntimeState(path: PiSessionEntrySnapshot[]): {
  model: PiModelRef | null;
  thinkingLevel: PiThinkingLevel | null;
} {
  let model: PiModelRef | null = null;
  let level: PiThinkingLevel | null = null;
  for (const entry of path) {
    model = modelRef(entry) ?? model;
    level = thinkingLevel(entry) ?? level;
  }
  return { model, thinkingLevel: level };
}

function toEffectiveMessage(entry: PiSessionEntrySnapshot): PiEffectiveMessage[] {
  if (entry.type === "compaction") {
    return typeof entry.raw.summary === "string"
      ? [{ sourceEntryId: entry.id, role: "compaction", text: entry.raw.summary }]
      : [];
  }
  if (entry.type === "branch_summary") {
    return typeof entry.raw.summary === "string"
      ? [{ sourceEntryId: entry.id, role: "branchSummary", text: entry.raw.summary }]
      : [];
  }
  if (entry.type === "custom_message") {
    return [
      {
        sourceEntryId: entry.id,
        role: "custom",
        text: textContent(entry.raw.content),
      },
    ];
  }
  if (entry.type !== "message") return [];
  const role = messageRole(entry);
  const message = messageRecord(entry);
  if (!message) return [];
  if (role === "user") {
    return [{ sourceEntryId: entry.id, role: "user", text: textContent(message.content) }];
  }
  if (role === "assistant") {
    const calls = toolCalls(entry);
    const thinking = thinkingContent(message.content);
    return [
      {
        sourceEntryId: entry.id,
        role: "assistant",
        text: textContent(message.content),
        ...(thinking ? { thinking } : {}),
        ...(calls.length > 0 ? { toolCalls: calls } : {}),
      },
    ];
  }
  if (role === "toolResult") {
    return [
      {
        sourceEntryId: entry.id,
        role: "toolResult",
        text: textContent(message.content),
        ...(typeof message.toolCallId === "string" ? { toolCallId: message.toolCallId } : {}),
        ...(typeof message.toolName === "string" ? { toolName: message.toolName } : {}),
        ...(message.isError === true ? { isError: true } : {}),
      },
    ];
  }
  if (role === "custom") {
    return [{ sourceEntryId: entry.id, role: "custom", text: textContent(message.content) }];
  }
  if (role === "branchSummary") {
    return [
      {
        sourceEntryId: entry.id,
        role: "branchSummary",
        text: typeof message.summary === "string" ? message.summary : "",
      },
    ];
  }
  const content = jsonObject(message);
  return content
    ? [{ sourceEntryId: entry.id, role: "custom", text: textContent(content.content) }]
    : [];
}
