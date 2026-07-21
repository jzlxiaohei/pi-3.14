import { Bot, LoaderCircle } from "lucide-solid";
import { For, Show, createEffect, createMemo } from "solid-js";
import type { TimelineItem, TimelineStatus } from "../core";
import { buildTimelineViewEntries, timelineActivityLabel } from "../core/view-items";
import { AssistantMessage } from "./AssistantMessage";
import { ToolCallBlock } from "./ToolCallBlock";
import { ToolCallGroup } from "./ToolCallGroup";
import { UserMessage } from "./UserMessage";

type AgentTimelineProps = {
  items: TimelineItem[];
  status: TimelineStatus;
  pendingApprovalToolCallId?: string | null;
  onAllowApproval?: () => void;
  onDenyApproval?: () => void;
};

export function AgentTimeline(props: AgentTimelineProps) {
  let scrollRef: HTMLElement | undefined;

  const entries = createMemo(() =>
    buildTimelineViewEntries(props.items, {
      runStatus: props.status.runStatus,
      pendingApprovalToolCallId: props.pendingApprovalToolCallId,
    }),
  );

  const activity = createMemo(() => timelineActivityLabel(props.items, props.status.runStatus));

  createEffect(() => {
    // Track length + last item text so streaming deltas also keep the viewport pinned.
    props.items.length;
    props.status.runStatus;
    props.pendingApprovalToolCallId;
    const last = props.items.at(-1);
    if (last?.kind === "assistant" || last?.kind === "tool") {
      last.kind === "assistant" ? last.text.length : (last.output?.length ?? 0);
    }
    queueMicrotask(() => {
      if (scrollRef) scrollRef.scrollTop = scrollRef.scrollHeight;
    });
  });

  return (
    <section ref={scrollRef} class="agent-timeline" aria-label="Agent conversation">
      <Show
        when={props.items.length > 0}
        fallback={
          <div class="at-empty-state">
            <span><Bot size={22} /></span>
            <h2>Start a PI session</h2>
            <p>Choose a workspace, then ask PI to inspect, explain, edit, or verify the code.</p>
          </div>
        }
      >
        <For each={entries()}>
          {(entry) => {
            if (entry.type === "tool_group") {
              return <ToolCallGroup tools={entry.tools} />;
            }
            return renderItem(entry.item, {
              lastItemId: props.items.at(-1)?.id,
              runStatus: props.status.runStatus,
              pendingApprovalToolCallId: props.pendingApprovalToolCallId,
              onAllowApproval: props.onAllowApproval,
              onDenyApproval: props.onDenyApproval,
            });
          }}
        </For>
        <Show when={activity()}>
          {(label) => (
            <p class="at-activity" aria-live="polite">
              <LoaderCircle class="at-spin" size={13} />
              {label()}
            </p>
          )}
        </Show>
      </Show>
    </section>
  );
}

function renderItem(
  item: TimelineItem,
  options: {
    lastItemId: string | undefined;
    runStatus: TimelineStatus["runStatus"];
    pendingApprovalToolCallId?: string | null;
    onAllowApproval?: () => void;
    onDenyApproval?: () => void;
  },
) {
  switch (item.kind) {
    case "user":
      return <UserMessage item={item} />;
    case "assistant":
      return (
        <AssistantMessage
          item={item}
          streaming={options.runStatus === "streaming" && item.id === options.lastItemId}
        />
      );
    case "tool":
      return (
        <ToolCallBlock
          item={item}
          pendingApproval={options.pendingApprovalToolCallId === item.toolCallId}
          onAllow={options.onAllowApproval}
          onDeny={options.onDenyApproval}
        />
      );
  }
}
