import { Bot, Bug, ChevronDown, Compass, GitCompareArrows, LoaderCircle } from "lucide-solid";
import { For, Index, Match, Show, Switch, createEffect, createMemo, createSignal, untrack } from "solid-js";
import type { Accessor } from "solid-js";
import type {
  TimelineAssistantMessage,
  TimelineItem,
  TimelineStatus,
  TimelineToolCall,
  TimelineUserMessage,
  TimelineViewEntry,
} from "../core";
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
  let previousLastItemId: string | undefined;
  const [following, setFollowing] = createSignal(true);

  const entries = createMemo(() =>
    buildTimelineViewEntries(props.items, {
      runStatus: props.status.runStatus,
      pendingApprovalToolCallId: props.pendingApprovalToolCallId,
    }),
  );

  const activity = createMemo(() => timelineActivityLabel(props.items, props.status.runStatus));

  createEffect(() => {
    // Track length + last item text so streaming deltas can follow when the reader stays at the bottom.
    props.items.length;
    props.status.runStatus;
    props.pendingApprovalToolCallId;
    const last = props.items.at(-1);
    if (last?.kind === "assistant" || last?.kind === "tool") {
      last.kind === "assistant" ? last.text.length : (last.output?.length ?? 0);
    }

    const historyChanged =
      previousLastItemId !== undefined &&
      last?.id !== previousLastItemId &&
      !props.items.some((item) => item.id === previousLastItemId);
    const forceFollow = last?.kind === "user" || historyChanged;
    previousLastItemId = last?.id;
    if (forceFollow) setFollowing(true);
    if (!untrack(following) && !forceFollow) return;

    queueMicrotask(() => scrollToLatest("auto"));
  });

  function isNearBottom(element: HTMLElement): boolean {
    return element.scrollHeight - element.scrollTop - element.clientHeight <= 48;
  }

  function scrollToLatest(behavior: ScrollBehavior): void {
    if (!scrollRef) return;
    setFollowing(true);
    scrollRef.scrollTo({ top: scrollRef.scrollHeight, behavior });
  }

  return (
    <div class="at-timeline-shell">
      <section
        ref={scrollRef}
        class="agent-timeline"
        aria-label="Agent conversation"
        onScroll={(event) => setFollowing(isNearBottom(event.currentTarget))}
      >
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
        <Index each={entries()}>
          {(entry) => (
            <TimelineEntry
              entry={entry}
              lastItemId={() => props.items.at(-1)?.id}
              runStatus={() => props.status.runStatus}
              pendingApprovalToolCallId={() => props.pendingApprovalToolCallId}
              onAllowApproval={props.onAllowApproval}
              onDenyApproval={props.onDenyApproval}
            />
          )}
        </Index>
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
      <Show when={!following() && props.items.length > 0}>
        <button
          type="button"
          class="at-scroll-latest"
          onClick={() => scrollToLatest("smooth")}
        >
          <ChevronDown size={14} />
          回到最新
        </button>
      </Show>
    </div>
  );
}

type TimelineEntryProps = {
  entry: Accessor<TimelineViewEntry>;
  lastItemId: Accessor<string | undefined>;
  runStatus: Accessor<TimelineStatus["runStatus"]>;
  pendingApprovalToolCallId: Accessor<string | null | undefined>;
  onAllowApproval?: () => void;
  onDenyApproval?: () => void;
};

function TimelineEntry(props: TimelineEntryProps) {
  // Key Match on stable ids — object identity from buildTimelineViewEntries changes every
  // tick and would remount ToolCallGroup (inner scroll jumps to top) / assistant chrome.
  const groupId = () => {
    const entry = props.entry();
    return entry.type === "tool_group" ? entry.id : null;
  };
  const itemId = () => {
    const entry = props.entry();
    return entry.type === "item" ? entry.item.id : null;
  };
  const groupTools = () => {
    const entry = props.entry();
    return entry.type === "tool_group" ? entry.tools : [];
  };
  const item = () => {
    const entry = props.entry();
    return entry.type === "item" ? entry.item : null;
  };

  return (
    <>
      <Show when={groupId()}>
        {(id) => (
          <ToolCallGroup
            groupId={id()}
            tools={groupTools()}
            active={
              props.runStatus() === "streaming" &&
              groupTools().at(-1)?.id === props.lastItemId()
            }
            pendingApprovalToolCallId={props.pendingApprovalToolCallId()}
            onAllowApproval={props.onAllowApproval}
            onDenyApproval={props.onDenyApproval}
          />
        )}
      </Show>
      <Show when={itemId()}>
        {(id) => (
          <TimelineItemEntry
            item={() => item() ?? ({
              id: id(),
              kind: "assistant",
              stopReason: null,
              text: "",
              timestamp: 0,
            } as TimelineItem)}
            lastItemId={props.lastItemId}
            runStatus={props.runStatus}
            pendingApprovalToolCallId={props.pendingApprovalToolCallId}
            onAllowApproval={props.onAllowApproval}
            onDenyApproval={props.onDenyApproval}
          />
        )}
      </Show>
    </>
  );
}

function TimelineItemEntry(props: Omit<TimelineEntryProps, "entry"> & { item: Accessor<TimelineItem> }) {
  const kind = () => props.item().kind;
  return (
    <Switch>
      <Match when={kind() === "user"}>
        <UserMessage item={props.item() as TimelineUserMessage} />
      </Match>
      <Match when={kind() === "assistant"}>
        <AssistantMessage
          item={props.item() as TimelineAssistantMessage}
          streaming={props.runStatus() === "streaming" && props.item().id === props.lastItemId()}
        />
      </Match>
      <Match when={kind() === "tool"}>
        <ToolCallBlock
          item={props.item() as TimelineToolCall}
          pendingApproval={
            props.pendingApprovalToolCallId() === (props.item() as TimelineToolCall).toolCallId
          }
          onAllow={props.onAllowApproval}
          onDeny={props.onDenyApproval}
        />
      </Match>
    </Switch>
  );
}
