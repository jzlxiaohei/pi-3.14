import { Bot, Bug, Compass, GitCompareArrows, LoaderCircle } from "lucide-solid";
import { For, Show, createEffect, createMemo } from "solid-js";
import type { TimelineItem, TimelineStatus } from "../core";
import { buildTimelineViewEntries, timelineActivityLabel } from "../core/view-items";
import { AssistantMessage } from "./AssistantMessage";
import { ToolCallBlock } from "./ToolCallBlock";
import { ToolCallGroup } from "./ToolCallGroup";
import { UserMessage } from "./UserMessage";

type AgentTimelineProps = {
  items: TimelineItem[];
  loading?: boolean;
  loadingLabel?: string;
  status: TimelineStatus;
  pendingApprovalToolCallId?: string | null;
  onAllowApproval?: () => void;
  onDenyApproval?: () => void;
  onPromptSuggestion?: (prompt: string) => void;
};

const EMPTY_SUGGESTIONS = [
  { icon: Compass, label: "Explain this codebase", prompt: "Give me a high-level overview of this codebase: its purpose, main modules, and how they fit together." },
  { icon: Bug, label: "Find & fix a bug", prompt: "Look for a likely bug in the code, explain the root cause, and propose a fix." },
  { icon: GitCompareArrows, label: "Review recent changes", prompt: "Summarize the uncommitted changes in this workspace and flag anything risky." },
] as const;

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
      <Show when={props.loading}>
        <div class="at-empty-state" aria-busy="true" aria-live="polite">
          <span><LoaderCircle class="at-spin" size={22} /></span>
          <h2>{props.loadingLabel ?? "Opening session…"}</h2>
          <p>Starting the PI host and loading this task’s history.</p>
        </div>
      </Show>
      <Show
        when={!props.loading && props.items.length > 0}
        fallback={
          <Show when={!props.loading}>
            <div class="at-empty-state">
              <span><Bot size={22} /></span>
              <h2>Start a PI session</h2>
              <p>Choose a workspace, then ask PI to inspect, explain, edit, or verify the code.</p>
              <Show when={props.onPromptSuggestion}>
                {(handler) => (
                  <div class="at-empty-suggestions">
                    <For each={EMPTY_SUGGESTIONS}>
                      {(item) => (
                        <button
                          type="button"
                          class="at-empty-suggestion"
                          onClick={() => handler()(item.prompt)}
                        >
                          <item.icon size={15} />
                          {item.label}
                        </button>
                      )}
                    </For>
                  </div>
                )}
              </Show>
            </div>
          </Show>
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
