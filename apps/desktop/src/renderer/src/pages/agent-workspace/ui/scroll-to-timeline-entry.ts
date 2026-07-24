let scrollGeneration = 0;

/** Scroll the chat timeline to a session entry when it is mounted on the active path. */
export function scrollToTimelineEntry(entryId: string): void {
  const token = ++scrollGeneration;

  const run = (): boolean => {
    if (token !== scrollGeneration) return true;
    const el = document.querySelector(
      `[data-timeline-entry-id="${CSS.escape(entryId)}"]`,
    );
    if (!(el instanceof HTMLElement)) return false;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("at-message--flash");
    window.setTimeout(() => el.classList.remove("at-message--flash"), 1200);
    return true;
  };

  const schedule = (attempt: number): void => {
    if (token !== scrollGeneration) return;
    if (run()) return;
    if (attempt >= 40) return;
    window.setTimeout(() => schedule(attempt + 1), 32);
  };

  // Wait past Solid flush + any competing microtask scrolls.
  queueMicrotask(() => {
    queueMicrotask(() => {
      window.setTimeout(() => schedule(0), 0);
    });
  });
}
