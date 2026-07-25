import type {
  TimelineAssistantMessage,
  TimelineItem,
  TimelineRunStatus,
  TimelineToolCall,
} from "./types";

export type TimelineViewEntry =
  | { type: "item"; item: TimelineItem }
  | { type: "tool_group"; id: string; tools: TimelineToolCall[] }
  /** Consecutive empty failed/aborted assistants — one compact row in the list. */
  | { type: "error_group"; id: string; errors: TimelineAssistantMessage[] };

/** Keep every consecutive tool run / error-only assistant run in one stable group. */
export function buildTimelineViewEntries(
  items: TimelineItem[],
  options: {
    runStatus: TimelineRunStatus;
    pendingApprovalToolCallId?: string | null;
  },
): TimelineViewEntry[] {
  const visible = items.filter((item) => {
    if (item.kind !== "assistant") return true;
    if (item.text.trim().length > 0 || Boolean(item.thinking?.trim())) return true;
    // Failed/aborted empty turns must stay visible (retry alone is not enough signal).
    if (item.errorMessage || item.stopReason === "error" || item.stopReason === "aborted") {
      return true;
    }
    return options.runStatus === "streaming" && item.id === items.at(-1)?.id;
  });

  const entries: TimelineViewEntry[] = [];
  let pendingTools: TimelineToolCall[] = [];
  let pendingErrors: TimelineAssistantMessage[] = [];

  const flushTools = () => {
    if (pendingTools.length === 0) return;
    entries.push({
      type: "tool_group",
      id: `tool-group-${pendingTools[0]!.toolCallId}`,
      tools: pendingTools,
    });
    pendingTools = [];
  };

  const flushErrors = () => {
    if (pendingErrors.length === 0) return;
    entries.push({
      type: "error_group",
      id: `error-group-${pendingErrors[0]!.id}`,
      errors: pendingErrors,
    });
    pendingErrors = [];
  };

  for (const item of visible) {
    if (item.kind === "tool") {
      flushErrors();
      pendingTools.push(item);
      continue;
    }
    flushTools();
    if (item.kind === "assistant" && isErrorOnlyAssistant(item)) {
      pendingErrors.push(item);
      continue;
    }
    flushErrors();
    entries.push({ type: "item", item });
  }
  flushTools();
  flushErrors();
  return entries;
}

/** Empty failed/aborted assistant — no body text/thinking (Connection error chains). */
export function isErrorOnlyAssistant(
  item: TimelineItem,
): item is TimelineAssistantMessage {
  if (item.kind !== "assistant") return false;
  const failed =
    item.stopReason === "error" ||
    item.stopReason === "aborted" ||
    Boolean(item.errorMessage?.trim());
  if (!failed) return false;
  return !item.text.trim() && !item.thinking?.trim();
}

/**
 * Extra status under the timeline while a turn is live.
 * Empty assistant placeholders already say "Waiting for model…" — skip those.
 * After tools finish (before the next thinking/text tokens), still show a wait cue
 * so the turn does not look finished.
 */
export function timelineActivityLabel(
  items: TimelineItem[],
  runStatus: TimelineRunStatus,
): string | null {
  if (runStatus === "compacting") return "Compacting context…";
  if (runStatus === "retrying") return "Retrying…";
  if (runStatus !== "streaming") return null;

  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.kind === "tool" && item.status === "running") {
      return item.summary;
    }
  }

  const last = items.at(-1);
  if (last?.kind === "assistant") {
    // Bubble already shows waiting / streaming chrome.
    return null;
  }
  // Common gap: tools just completed, model has not started the next assistant chunk yet.
  return "Waiting for model…";
}
