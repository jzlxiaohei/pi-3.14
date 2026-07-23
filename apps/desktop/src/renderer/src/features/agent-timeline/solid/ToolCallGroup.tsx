import { CheckCircle, ChevronDown, ChevronRight, LoaderCircle, Wrench, XCircle } from "lucide-solid";
import { Index, Match, Show, Switch, createEffect, on } from "solid-js";
import type { TimelineToolCall } from "../core";
import { ToolCallBlock } from "./ToolCallBlock";
import {
  isToolGroupOpen,
  setTimelineSectionOpen,
  toolGroupKey,
} from "./timeline-ui-state";

type ToolCallGroupProps = {
  /** Stable view entry id (`tool-group-<firstToolCallId>`). */
  groupId: string;
  tools: TimelineToolCall[];
  active?: boolean;
  pendingApprovalToolCallId?: string | null;
  onAllowApproval?: () => void;
  onDenyApproval?: () => void;
};

export function ToolCallGroup(props: ToolCallGroupProps) {
  let bodyRef: HTMLDivElement | undefined;
  let pinnedScrollTop = 0;
  const anchorId = () => props.tools[0]?.toolCallId ?? props.groupId;
  const groupKey = () => toolGroupKey(anchorId());
  const open = () => isToolGroupOpen(anchorId(), props.tools, props.active);
  const errorCount = () => props.tools.filter((tool) => tool.status === "error").length;
  const runningCount = () => props.tools.filter((tool) => tool.status === "running").length;

  // New tools used to remount this body (scroll → 0). Keep position across appends.
  createEffect(
    on(
      () => props.tools.length,
      () => {
        const el = bodyRef;
        if (!el) return;
        const top = pinnedScrollTop;
        queueMicrotask(() => {
          if (bodyRef) bodyRef.scrollTop = top;
        });
      },
    ),
  );

  return (
    <div class="at-tool-group" data-open={open() ? "true" : "false"}>
      <button
        type="button"
        class="at-tool-group-toggle"
        aria-expanded={open()}
        onClick={() => setTimelineSectionOpen(groupKey(), !open())}
      >
        <span class="at-tool-icon">
          <Wrench size={15} />
        </span>
        <span class="at-tool-copy">
          <strong>
            {props.tools.length} tool {props.tools.length === 1 ? "call" : "calls"}
            <span class="at-tool-preview"> · {previewLabels(props.tools)}</span>
            <Show when={errorCount() > 0}>
              <span class="at-tool-fail-count"> · {errorCount()} failed</span>
            </Show>
          </strong>
        </span>
        <span class="at-tool-state">
          <Switch>
            <Match when={runningCount() > 0}>
              <LoaderCircle class="at-spin" size={16} />
            </Match>
            <Match when={errorCount() > 0}>
              <XCircle class="at-tool-fail-icon" size={16} />
            </Match>
            <Match when={true}>
              <CheckCircle size={16} />
            </Match>
          </Switch>
          {open() ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>
      <Show when={open()}>
        <div
          ref={bodyRef}
          class="at-tool-group-body"
          onScroll={(event) => {
            pinnedScrollTop = event.currentTarget.scrollTop;
          }}
        >
          <Index each={props.tools}>
            {(tool) => (
              <ToolCallBlock
                item={tool()}
                pendingApproval={props.pendingApprovalToolCallId === tool().toolCallId}
                onAllow={props.onAllowApproval}
                onDeny={props.onDenyApproval}
              />
            )}
          </Index>
        </div>
      </Show>
    </div>
  );
}

function previewLabels(tools: TimelineToolCall[]): string {
  const names = tools.map((tool) => tool.toolName);
  const unique = [...new Set(names)];
  if (unique.length <= 3) return unique.join(" · ");
  return `${unique.slice(0, 3).join(" · ")} +${unique.length - 3}`;
}
