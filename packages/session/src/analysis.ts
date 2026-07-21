import type { PiModelRef, PiThinkingLevel } from "@pi-3.14/model";
import { buildPiContextProjection } from "./context.js";
import { buildPiSessionIndex } from "./parser.js";
import {
  addUsage,
  emptyUsage,
  entryTimestampMs,
  entryUsage,
  messageRecord,
  messageRole,
  modelRef,
  stopReason,
  thinkingLevel,
  toolCalls,
} from "./records.js";
import type {
  PiSessionAnalysis,
  PiSessionDiagnostic,
  PiSessionEntrySnapshot,
  PiSessionSnapshot,
  PiToolAnalysis,
  PiTurnAnalysis,
} from "./types.js";

export function analyzePiSession(snapshot: PiSessionSnapshot): PiSessionAnalysis {
  const index = buildPiSessionIndex(snapshot);
  const path = snapshot.activePathEntryIds.flatMap((id) => {
    const entry = index.byId.get(id);
    return entry ? [entry] : [];
  });
  const context = buildPiContextProjection(snapshot);
  const diagnostics = [...snapshot.diagnostics, ...context.diagnostics];
  const turns: PiTurnAnalysis[] = [];
  const calls: PiSessionAnalysis["calls"] = [];
  const tools: PiToolAnalysis[] = [];
  const toolByCallId = new Map<
    string,
    { name: string; assistantEntryId: string; startedAt: number | null }
  >();
  const toolResultByCallId = new Map<
    string,
    { entryId: string; isError: boolean; finishedAt: number | null }
  >();
  let currentTurn: PiTurnAnalysis | null = null;
  let model: PiModelRef | null = null;
  let level: PiThinkingLevel | null = null;
  let usage = emptyUsage();

  const ensureTurn = (entry: PiSessionEntrySnapshot): PiTurnAnalysis => {
    if (!currentTurn) {
      currentTurn = newTurn(turns.length, null, entry.timestamp);
      turns.push(currentTurn);
    }
    return currentTurn;
  };

  for (const entry of path) {
    model = modelRef(entry) ?? model;
    level = thinkingLevel(entry) ?? level;
    const role = messageRole(entry);
    if (role === "user") {
      currentTurn = newTurn(turns.length, entry.id, entry.timestamp);
      turns.push(currentTurn);
      continue;
    }
    if (role === "assistant") {
      const turn = ensureTurn(entry);
      const callUsage = entryUsage(entry);
      const reason = stopReason(entry);
      turn.assistantEntryIds.push(entry.id);
      turn.usage = addUsage(turn.usage, callUsage);
      turn.terminalStopReason = reason ?? turn.terminalStopReason;
      turn.finishedAt = entry.timestamp;
      usage = addUsage(usage, callUsage);
      calls.push({
        entryId: entry.id,
        turnIndex: turn.index,
        model: modelRef(entry) ?? model,
        stopReason: reason,
        usage: callUsage,
      });
      for (const call of toolCalls(entry)) {
        if (toolByCallId.has(call.id)) {
          diagnostics.push({
            code: "duplicate_tool_call_id",
            severity: "error",
            message: `Tool call id ${call.id} appears more than once on the active path.`,
            entryId: entry.id,
          });
          continue;
        }
        toolByCallId.set(call.id, {
          name: call.name,
          assistantEntryId: entry.id,
          startedAt: entryTimestampMs(entry),
        });
        turn.toolCallIds.push(call.id);
      }
      continue;
    }
    if (role === "toolResult") {
      const turn = ensureTurn(entry);
      turn.toolResultEntryIds.push(entry.id);
      turn.finishedAt = entry.timestamp;
      const message = messageRecord(entry);
      const callId = message?.toolCallId;
      if (typeof callId !== "string" || !toolByCallId.has(callId)) {
        diagnostics.push({
          code: "orphan_tool_result",
          severity: "warning",
          message: `Tool result ${entry.id} has no matching tool call on the active path.`,
          entryId: entry.id,
        });
      } else {
        toolResultByCallId.set(callId, {
          entryId: entry.id,
          isError: message?.isError === true,
          finishedAt: entryTimestampMs(entry),
        });
      }
    }
  }

  for (const [callId, call] of toolByCallId) {
    const result = toolResultByCallId.get(callId);
    if (!result) {
      diagnostics.push({
        code: "missing_tool_result",
        severity: "warning",
        message: `Tool call ${callId} has no matching tool result on the active path.`,
        entryId: call.assistantEntryId,
      });
    }
    tools.push({
      toolCallId: callId,
      name: call.name,
      assistantEntryId: call.assistantEntryId,
      resultEntryId: result?.entryId ?? null,
      isError: result?.isError ?? null,
      durationMsEstimate:
        call.startedAt !== null && result?.finishedAt != null
          ? Math.max(0, result.finishedAt - call.startedAt)
          : null,
      timingBasis:
        call.startedAt !== null && result?.finishedAt != null
          ? "assistantMessageToToolResult"
          : null,
    });
  }

  return {
    scope: "activePath",
    leafId: snapshot.leafId,
    model: context.model ?? model,
    thinkingLevel: context.thinkingLevel ?? level,
    entryCount: snapshot.entries.length,
    activePathEntryCount: path.length,
    branchPointCount: [...index.childrenById.entries()].filter(
      ([parentId, children]) => parentId !== null && children.length > 1,
    ).length,
    maxDepth: maxDepth(snapshot.entries, index.byId),
    turnCount: turns.length,
    assistantCallCount: calls.length,
    toolCallCount: tools.length,
    toolErrorCount: tools.filter((tool) => tool.isError === true).length,
    compactionCount: path.filter((entry) => entry.type === "compaction").length,
    usage,
    turns,
    calls,
    tools,
    diagnostics: dedupeDiagnostics(diagnostics),
  };
}

function newTurn(
  index: number,
  userEntryId: string | null,
  timestamp: string,
): PiTurnAnalysis {
  return {
    index,
    userEntryId,
    assistantEntryIds: [],
    toolCallIds: [],
    toolResultEntryIds: [],
    terminalStopReason: null,
    usage: emptyUsage(),
    startedAt: timestamp,
    finishedAt: timestamp,
  };
}

function maxDepth(
  entries: PiSessionEntrySnapshot[],
  byId: ReadonlyMap<string, PiSessionEntrySnapshot>,
): number {
  const depthById = new Map<string, number>();
  let maximum = 0;
  for (const entry of entries) {
    if (depthById.has(entry.id)) continue;
    const chain: PiSessionEntrySnapshot[] = [];
    const seen = new Set<string>();
    let cursor: PiSessionEntrySnapshot | undefined = entry;
    while (cursor && !seen.has(cursor.id) && !depthById.has(cursor.id)) {
      seen.add(cursor.id);
      chain.push(cursor);
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }
    let depth = cursor ? (depthById.get(cursor.id) ?? 0) : 0;
    for (let index = chain.length - 1; index >= 0; index--) {
      depth++;
      depthById.set(chain[index]!.id, depth);
      maximum = Math.max(maximum, depth);
    }
  }
  return maximum;
}

function dedupeDiagnostics(diagnostics: PiSessionDiagnostic[]): PiSessionDiagnostic[] {
  const seen = new Set<string>();
  return diagnostics.filter((diagnostic) => {
    const key = [
      diagnostic.code,
      diagnostic.sourceLine ?? "",
      diagnostic.entryId ?? "",
      diagnostic.message,
    ].join(":");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
