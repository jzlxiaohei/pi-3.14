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
  const compaction = () =>
    props.item.kind === "compaction" ? (props.item as TimelineCompaction) : null;
  const preview = () => {
    const compact = props.item.text.replace(/\s+/g, " ").trim();
    return compact.length > 140 ? `${compact.slice(0, 139)}…` : compact;
  };
  const tokensLabel = () => {
    const c = compaction();
    if (!c || c.tokensBefore == null) return null;
    return c.tokensBefore.toLocaleString();
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
          <strong class="at-context-note__title-row">
            {isBranch() ? "Branch summary" : "Compaction"}
            <Show when={!isBranch()}>
              <span class="at-context-note__tag">压缩</span>
            </Show>
            <Show when={tokensLabel()}>
              {(tok) => <span class="at-context-note__stat">{tok()} tok</span>}
            </Show>
          </strong>
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
        <Show
          when={compaction()}
          fallback={<pre class="at-context-note__body">{props.item.text}</pre>}
        >
          {(c) => (
            <div class="at-context-note__panels">
              <section class="at-context-note__panel">
                <header>Request</header>
                <dl class="at-context-note__dl">
                  <div>
                    <dt>tokensBefore</dt>
                    <dd>
                      {c().tokensBefore != null
                        ? c().tokensBefore!.toLocaleString()
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>firstKept</dt>
                    <dd class="at-context-note__mono">
                      {c().firstKeptEntryId ?? "—"}
                    </dd>
                  </div>
                  <Show when={(c().readFiles?.length ?? 0) > 0}>
                    <div>
                      <dt>readFiles</dt>
                      <dd>
                        <pre class="at-context-note__list">
                          {(c().readFiles ?? []).join("\n")}
                        </pre>
                      </dd>
                    </div>
                  </Show>
                  <Show when={(c().modifiedFiles?.length ?? 0) > 0}>
                    <div>
                      <dt>modifiedFiles</dt>
                      <dd>
                        <pre class="at-context-note__list">
                          {(c().modifiedFiles ?? []).join("\n")}
                        </pre>
                      </dd>
                    </div>
                  </Show>
                </dl>
                <p class="at-context-note__footnote">
                  Summarization 的完整 prompt 未持久化到 session JSONL；以上为压缩边界与文件轨迹。
                </p>
              </section>
              <section class="at-context-note__panel">
                <header>Response</header>
                <pre class="at-context-note__body">{c().text}</pre>
              </section>
            </div>
          )}
        </Show>
      </Show>
    </article>
  );
}
