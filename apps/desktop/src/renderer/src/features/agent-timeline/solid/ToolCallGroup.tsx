import { CheckCircle, ChevronDown, ChevronRight, Wrench, XCircle } from "lucide-solid";
import { For, Show } from "solid-js";
import type { TimelineToolCall } from "../core";
import { ToolCallBlock } from "./ToolCallBlock";
import {
  setTimelineSectionOpen,
  timelineSectionOpen,
  toolGroupKey,
} from "./timeline-ui-state";

type ToolCallGroupProps = {
  tools: TimelineToolCall[];
};

export function ToolCallGroup(props: ToolCallGroupProps) {
  const groupKey = () => toolGroupKey(props.tools.map((tool) => tool.toolCallId));
  const errorCount = () => props.tools.filter((tool) => tool.status === "error").length;

  return (
    <div class="at-tool-group">
      <button
        type="button"
        class="at-tool-group-toggle"
        aria-expanded={timelineSectionOpen(groupKey())}
        onClick={() => setTimelineSectionOpen(groupKey(), !timelineSectionOpen(groupKey()))}
      >
        <span class="at-tool-icon">
          <Wrench size={15} />
        </span>
        <span class="at-tool-copy">
          <strong>
            {props.tools.length} tool calls
            <Show when={errorCount() > 0}> · {errorCount()} failed</Show>
          </strong>
          <small>{previewLabels(props.tools)}</small>
        </span>
        <span class="at-tool-state">
          <Show when={errorCount() > 0} fallback={<CheckCircle size={16} />}>
            <XCircle size={16} />
          </Show>
          {timelineSectionOpen(groupKey()) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>
      <Show when={timelineSectionOpen(groupKey())}>
        <div class="at-tool-group-body">
          <For each={props.tools}>{(tool) => <ToolCallBlock item={tool} />}</For>
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
