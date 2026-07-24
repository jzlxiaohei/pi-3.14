import { ChevronDown, GitFork, Layers2 } from "lucide-solid";
import { Show, createSignal } from "solid-js";
import type { TimelineBranchSummary, TimelineCompaction } from "../core";

type ContextNoteProps = {
  item: TimelineBranchSummary | TimelineCompaction;
};

/** Lightweight card for branch_summary / compaction entries injected into context. */
export function ContextNote(props: ContextNoteProps) {
  const [open, setOpen] = createSignal(false);
  const isBranch = () => props.item.kind === "branch_summary";
  const preview = () => {
    const compact = props.item.text.replace(/\s+/g, " ").trim();
    return compact.length > 140 ? `${compact.slice(0, 139)}…` : compact;
  };

  return (
    <article
      class="at-message at-context-note"
      classList={{
        "at-context-note--branch": isBranch(),
        "at-context-note--compaction": !isBranch(),
      }}
      aria-label={isBranch() ? "Branch summary" : "Compaction summary"}
      data-timeline-entry-id={props.item.id}
    >
      <button
        type="button"
        class="at-context-note__toggle"
        onClick={() => setOpen((value) => !value)}
      >
        <span class="at-context-note__icon">
          <Show when={isBranch()} fallback={<Layers2 size={14} />}>
            <GitFork size={14} />
          </Show>
        </span>
        <span class="at-context-note__meta">
          <strong>{isBranch() ? "Branch summary" : "Compaction"}</strong>
          <Show when={!open()}>
            <span class="at-context-note__preview">{preview()}</span>
          </Show>
        </span>
        <ChevronDown
          size={14}
          class="at-context-note__chevron"
          classList={{ "at-context-note__chevron--open": open() }}
        />
      </button>
      <Show when={open()}>
        <pre class="at-context-note__body">{props.item.text}</pre>
      </Show>
    </article>
  );
}
