import type { TimelineItem, TimelineRunStatus, TimelineToolCall } from "./types";

export type TimelineViewEntry =
  | { type: "item"; item: TimelineItem }
  | { type: "tool_group"; id: string; tools: TimelineToolCall[] };

/** Keep every consecutive tool run in one stable group from the first tool onward. */
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
    return options.runStatus === "streaming" && item.id === items.at(-1)?.id;
  });

  const entries: TimelineViewEntry[] = [];
  let pendingTools: TimelineToolCall[] = [];

  const flushTools = () => {
    if (pendingTools.length === 0) return;
    entries.push({
      type: "tool_group",
      id: `tool-group-${pendingTools[0]!.toolCallId}`,
      tools: pendingTools,
    });
    pendingTools = [];
  };

  for (const item of visible) {
    if (item.kind !== "tool") {
      flushTools();
      entries.push({ type: "item", item });
      continue;
    }
    pendingTools.push(item);
  }
  flushTools();
  return entries;
}

/**
 * Extra status under the timeline while a turn is live.
 * Idle "waiting for model" is handled by the empty assistant placeholder — skip it here.
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
  return null;
}
