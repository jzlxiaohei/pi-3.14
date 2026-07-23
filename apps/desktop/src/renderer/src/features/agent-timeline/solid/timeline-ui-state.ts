import { createSignal } from "solid-js";
import type { TimelineToolCall } from "../core";

/**
 * Persist tool/group expand chrome across timeline remounts (live overlay → JSONL snapshot).
 * Keyed by stable toolCallId (not ephemeral item.id).
 */
const [openByKey, setOpenByKey] = createSignal<Record<string, boolean>>({});

export function timelineSectionOpen(key: string): boolean {
  return openByKey()[key] === true;
}

export function setTimelineSectionOpen(key: string, open: boolean): void {
  setOpenByKey((current) => {
    if (current[key] === open) return current;
    return { ...current, [key]: open };
  });
}

export function toggleTimelineSection(key: string): void {
  setTimelineSectionOpen(key, !timelineSectionOpen(key));
}

export function toolArgsKey(toolCallId: string): string {
  return `tool-args:${toolCallId}`;
}

export function toolOutputKey(toolCallId: string): string {
  return `tool-output:${toolCallId}`;
}

/** Stable group key — first tool in the consecutive run. */
export function toolGroupKey(anchorToolCallId: string): string {
  return `tool-group:${anchorToolCallId}`;
}

/**
 * Group open state. Explicit true/false wins; a new running group starts open,
 * then settles closed unless the user opened the group or one of its sections.
 */
export function isToolGroupOpen(
  anchorToolCallId: string,
  tools: TimelineToolCall[],
  active = false,
): boolean {
  const key = toolGroupKey(anchorToolCallId);
  const stored = openByKey()[key];
  if (stored === true) return true;
  if (stored === false) return false;
  return tools.some(
    (tool) =>
      active ||
      tool.status === "running" ||
      timelineSectionOpen(toolArgsKey(tool.toolCallId)) ||
      timelineSectionOpen(toolOutputKey(tool.toolCallId)),
  );
}
