import { AlertCircle, PanelRight, XCircle } from "lucide-solid";
import { For, createMemo, createSignal } from "solid-js";
import type { TimelineAssistantMessage } from "../core";
import { classifyTimelineError } from "../core/classify-error";
import { ToolFloatPanel } from "./tool-float-panel";

type ErrorGroupProps = {
  groupId: string;
  errors: TimelineAssistantMessage[];
};

/**
 * Compact row for consecutive empty failed assistants (Connection error chains).
 * Same pattern as ToolCallGroup: one line in the list, details in a side float.
 */
export function ErrorGroup(props: ErrorGroupProps) {
  const [open, setOpen] = createSignal(false);
  let anchorRef: HTMLButtonElement | undefined;

  const classified = createMemo(() =>
    props.errors.map((item) =>
      classifyTimelineError(item.errorMessage?.trim() || "Model request failed"),
    ),
  );

  const latest = createMemo(() => classified().at(-1)!);
  const count = () => props.errors.length;

  const title = () => {
    const c = count();
    const head = latest().title;
    return c === 1 ? head : `${head} · ${c} attempts`;
  };

  return (
    <div
      class="at-tool-group at-error-group"
      data-open={open() ? "true" : "false"}
      data-status="error"
      data-timeline-entry-id={props.groupId}
    >
      <button
        ref={anchorRef}
        type="button"
        class="at-tool-row-trigger"
        aria-expanded={open()}
        aria-label={open() ? "关闭错误详情" : "查看错误详情"}
        onClick={() => setOpen(!open())}
      >
        <span class="at-tool-icon">
          <XCircle size={15} />
        </span>
        <span class="at-tool-copy">
          <strong>
            {latest().title}
            <ShowCount count={count()} />
            <span class="at-tool-preview"> · {previewDetail(latest().detail)}</span>
          </strong>
        </span>
        <span class="at-tool-state">
          <AlertCircle size={16} />
          <span class="at-tool-open-hint" aria-hidden="true" title="查看详情">
            <PanelRight size={14} />
          </span>
        </span>
      </button>

      <ToolFloatPanel
        open={open()}
        title={title()}
        getAnchor={() => anchorRef}
        onOpenChange={setOpen}
      >
        <div class="at-tool-popover__list at-error-group__list">
          <For each={classified()}>
            {(err, index) => (
              <div class="at-error-group__item" data-kind={err.kind}>
                <header>
                  <span class="at-error-group__index">#{index() + 1}</span>
                  <strong>{err.title}</strong>
                </header>
                <p class="at-error-group__detail">{err.detail}</p>
              </div>
            )}
          </For>
        </div>
      </ToolFloatPanel>
    </div>
  );
}

function ShowCount(props: { count: number }) {
  if (props.count <= 1) return null;
  return <span class="at-tool-fail-count"> · {props.count}×</span>;
}

function previewDetail(detail: string): string {
  const first = detail.split("\n").find((line) => line.trim())?.trim() ?? detail.trim();
  return first.length > 72 ? `${first.slice(0, 72)}…` : first;
}
