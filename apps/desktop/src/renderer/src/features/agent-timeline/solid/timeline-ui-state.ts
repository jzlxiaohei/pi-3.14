import { createSignal } from "solid-js";

/**
 * Persist ephemeral timeline chrome across remounts when needed.
 * Tool rows no longer expand inline — details open in a portalled popover.
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
