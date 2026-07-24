import type { JsonValue, PiTerminalStopReason } from "@pi-3.14/model";
import {
  buildPiContextProjection,
  buildPiSessionIndex,
  type PiSessionEntrySnapshot,
  type PiSessionSnapshot,
} from "@pi-3.14/session";
import type { PiTimelineItem, PiTimelineSnapshot } from "./desktop-contracts";

/**
 * Project the active-path session snapshot into linear timeline items.
 * Authority for committed history after a turn settles.
 *
 * Pass `leafEntryId` from the live SessionManager after navigate/branch —
 * JSONL `snapshot.leafId` is only the last appended entry.
 */
export function projectSessionToTimeline(
  snapshot: PiSessionSnapshot,
  leafEntryId: string | null = snapshot.leafId,
): PiTimelineSnapshot {
  const context = buildPiContextProjection(snapshot, leafEntryId);
  const index = buildPiSessionIndex(snapshot);
  const items: PiTimelineItem[] = [];
  const toolIndexByCallId = new Map<string, number>();

  for (const message of context.messages) {
    const entry = index.byId.get(message.sourceEntryId);
    const timestamp = entryTimestamp(entry);

    if (message.role === "user") {
      if (!message.text.trim()) continue;
      items.push({
        id: message.sourceEntryId,
        kind: "user",
        text: message.text,
        timestamp,
      });
      continue;
    }

    if (message.role === "assistant") {
      const stop = terminalStopReason(entry);
      const errorMessage = entryErrorMessage(entry);
      const hasBody = Boolean(message.text.trim() || message.thinking?.trim());
      // Keep failed/aborted empty turns so the UI can show Connection error / abort,
      // not only a retry affordance under a silent user bubble.
      if (hasBody || stop === "error" || stop === "aborted" || errorMessage) {
        items.push({
          id: message.sourceEntryId,
          kind: "assistant",
          stopReason: stop,
          text: message.text,
          ...(message.thinking?.trim() ? { thinking: message.thinking } : {}),
          ...(errorMessage
            ? { errorMessage }
            : stop === "error"
              ? { errorMessage: "Model request failed" }
              : stop === "aborted"
                ? { errorMessage: "Turn aborted" }
                : {}),
          timestamp,
        });
      }
      for (const call of message.toolCalls ?? []) {
        const start = summarizeTool(call.name, call.arguments, "running");
        toolIndexByCallId.set(call.id, items.length);
        items.push({
          id: `${message.sourceEntryId}:${call.id}`,
          kind: "tool",
          args: call.arguments,
          detail: start.detail,
          diff: start.diff,
          output: start.output,
          status: "running",
          summary: start.summary,
          timestamp,
          toolCallId: call.id,
          toolName: call.name,
        });
      }
      continue;
    }

    if (message.role === "toolResult" && message.toolCallId) {
      const status = message.isError ? "error" : "success";
      const toolName = message.toolName ?? "tool";
      const update = summarizeTool(toolName, message.text, status);
      const existing = toolIndexByCallId.get(message.toolCallId);
      if (existing !== undefined) {
        const prev = items[existing];
        if (prev?.kind === "tool") {
          items[existing] = {
            ...prev,
            ...update,
            status,
            diff: update.diff ?? prev.diff,
            output: update.output ?? prev.output,
          };
        }
        continue;
      }
      items.push({
        id: message.sourceEntryId,
        kind: "tool",
        args: null,
        detail: update.detail,
        diff: update.diff,
        output: update.output,
        status,
        summary: update.summary,
        timestamp,
        toolCallId: message.toolCallId,
        toolName,
      });
      continue;
    }

    if (message.role === "branchSummary") {
      if (!message.text.trim()) continue;
      items.push({
        id: message.sourceEntryId,
        kind: "branch_summary",
        text: message.text,
        timestamp,
      });
      continue;
    }

    if (message.role === "compaction") {
      if (!message.text.trim()) continue;
      items.push({
        id: message.sourceEntryId,
        kind: "compaction",
        text: message.text,
        timestamp,
      });
    }
  }

  // Turns interrupted mid-tool (crash / kill / hung approval) leave toolCalls
  // without results — never keep those spinning in committed history.
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    if (item?.kind === "tool" && item.status === "running") {
      items[index] = {
        ...item,
        status: "error",
        summary: `${toolLabel(item.toolName)} interrupted`,
        output: item.output ?? "Interrupted before the tool finished.",
      };
    }
  }

  return {
    leafEntryId: context.leafId,
    items,
  };
}

function entryTimestamp(entry: PiSessionEntrySnapshot | undefined): number {
  if (!entry) return Date.now();
  const message = entry.raw.message;
  if (typeof message === "object" && message !== null && !Array.isArray(message)) {
    const timestamp = (message as { timestamp?: unknown }).timestamp;
    if (typeof timestamp === "number" && Number.isFinite(timestamp)) return timestamp;
  }
  const parsed = Date.parse(entry.timestamp);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function terminalStopReason(entry: PiSessionEntrySnapshot | undefined): PiTerminalStopReason | null {
  if (!entry) return null;
  const message = entry.raw.message;
  if (typeof message !== "object" || message === null || Array.isArray(message)) return null;
  const reason = (message as { stopReason?: unknown }).stopReason;
  return reason === "stop" || reason === "length" || reason === "error" || reason === "aborted"
    ? reason
    : null;
}

function entryErrorMessage(entry: PiSessionEntrySnapshot | undefined): string | undefined {
  if (!entry) return undefined;
  const message = entry.raw.message;
  if (typeof message !== "object" || message === null || Array.isArray(message)) return undefined;
  const value = (message as { errorMessage?: unknown }).errorMessage;
  return typeof value === "string" && value.trim() ? value : undefined;
}

function summarizeTool(
  toolName: string,
  value: JsonValue | string,
  status: "running" | "success" | "error",
): Pick<Extract<PiTimelineItem, { kind: "tool" }>, "detail" | "diff" | "output" | "summary"> {
  const output = typeof value === "string" ? value : extractOutput(value);
  const path = typeof value === "object" && value !== null ? firstPath(value) : null;
  const exitMatch =
    typeof output === "string"
      ? output.match(/exited with code\s+(\d+)/i)
      : null;
  const label = toolLabel(toolName);
  return {
    summary:
      status === "running"
        ? `${label}...`
        : status === "error"
          ? `${label} failed`
          : `${label} finished`,
    detail: exitMatch?.[1]
      ? `${toolName} · exit ${exitMatch[1]}`
      : path
        ? `${toolName} · ${path}`
        : toolName,
    output: output || null,
    diff: typeof value === "object" && value !== null ? extractDiff(value) : null,
  };
}

function toolLabel(toolName: string): string {
  switch (toolName) {
    case "bash":
    case "Shell":
      return "Command";
    case "read":
    case "Read":
    case "ReadFile":
      return "Read";
    case "edit":
    case "write":
    case "Edit":
    case "Write":
    case "ApplyPatch":
      return "Edit";
    default:
      return toolName;
  }
}

function firstPath(value: JsonValue): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  for (const key of ["path", "file", "filePath", "target_file", "command"]) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  return null;
}

function extractOutput(value: JsonValue): string {
  if (typeof value === "string") return value;
  if (typeof value !== "object" || value === null) return JSON.stringify(value, null, 2);
  if (Array.isArray(value)) return JSON.stringify(value, null, 2);
  for (const key of ["output", "content", "stdout", "result", "text"]) {
    const candidate = value[key];
    if (typeof candidate === "string") return candidate;
  }
  return JSON.stringify(value, null, 2);
}

function extractDiff(value: JsonValue): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  for (const key of ["diff", "patch", "unifiedDiff"]) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  return null;
}
