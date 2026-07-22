import { createSignal } from "solid-js";

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

export function toolGroupKey(toolCallIds: string[]): string {
  return `tool-group:${toolCallIds.join(",")}`;
}
