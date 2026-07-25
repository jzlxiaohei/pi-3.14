import { Bot, Bug, ChevronDown, Compass, GitCompareArrows, LoaderCircle } from "lucide-solid";
import {
  For,
  Index,
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  untrack,
} from "solid-js";
import type { Accessor } from "solid-js";
import type {
  TimelineAssistantMessage,
  TimelineBranchSummary,
  TimelineCompaction,
  TimelineItem,
  TimelineStatus,
  TimelineToolCall,
  TimelineUserMessage,
  TimelineViewEntry,
} from "../core";
import { buildTimelineViewEntries, timelineActivityLabel } from "../core/view-items";
import { AssistantMessage } from "./AssistantMessage";
import { ContextNote } from "./ContextNote";
import { ErrorGroup } from "./ErrorGroup";
import { ToolCallBlock } from "./ToolCallBlock";
import { ToolCallGroup } from "./ToolCallGroup";
import { UserMessage } from "./UserMessage";

type AgentTimelineProps = {
  items: TimelineItem[];
  loading?: boolean;
  loadingLabel?: string;
  status: TimelineStatus;
  pendingApprovalToolCallId?: string | null;
  /** When true, skip history-change auto-follow (e.g. Switch & view pinning a message). */
  suppressAutoFollow?: boolean;
  /**
   * Identity of the open conversation (task/session id). When it changes, scroll
   * snaps to the latest message at the bottom.
   */
  conversationKey?: string | null;
  canEditUser?: boolean;
  canRetryLatest?: boolean;
  onAllowApproval?: () => void;
  onDenyApproval?: () => void;
  onPromptSuggestion?: (prompt: string) => void;
  onEditUser?: (
    entryId: string,
    text: string,
    isLatest: boolean,
    options?: { summarizeAbandoned?: boolean },
  ) => void;
  onRetryLatest?: (entryId: string) => void;
};

const EMPTY_SUGGESTIONS = [
  { icon: Compass, label: "Explain this codebase", prompt: "Give me a high-level overview of this codebase: its purpose, main modules, and how they fit together." },
  { icon: Bug, label: "Find & fix a bug", prompt: "Look for a likely bug in the code, explain the root cause, and propose a fix." },
  { icon: GitCompareArrows, label: "Review recent changes", prompt: "Summarize the uncommitted changes in this workspace and flag anything risky." },
] as const;

export function AgentTimeline(props: AgentTimelineProps) {
  let scrollRef: HTMLElement | undefined;
  let previousLastItemId: string | undefined;
  let previousItemCount: number | undefined;
  let previousConversationKey: string | null | undefined;
  const [following, setFollowing] = createSignal(true);

  const entries = createMemo(() =>
    buildTimelineViewEntries(props.items, {
      runStatus: props.status.runStatus,
      pendingApprovalToolCallId: props.pendingApprovalToolCallId,
    }),
  );

  const activity = createMemo(() => timelineActivityLabel(props.items, props.status.runStatus));
  const latestUserId = createMemo(() => {
    for (let index = props.items.length - 1; index >= 0; index -= 1) {
      const item = props.items[index];
      if (item?.kind === "user") return item.id;
    }
    return null;
  });

  createEffect(() => {
    // Track length + last item text so streaming deltas can follow when the reader stays at the bottom.
    const itemCount = props.items.length;
    const loading = Boolean(props.loading);
    props.status.runStatus;
    props.pendingApprovalToolCallId;
    const conversationKey = props.conversationKey ?? null;
    const last = props.items.at(-1);
    if (last?.kind === "assistant" || last?.kind === "tool") {
      last.kind === "assistant" ? last.text.length : (last.output?.length ?? 0);
    }

    // Opening another task/session: always land on the latest message (bottom).
    // Without this, a longer new history looks like tip-id churn and auto-follow is skipped.
    const conversationChanged =
      previousConversationKey !== undefined && conversationKey !== previousConversationKey;
    previousConversationKey = conversationKey;
    if (conversationChanged) {
      previousLastItemId = last?.id;
      previousItemCount = itemCount;
      if (props.suppressAutoFollow) {
        setFollowing(false);
        return;
      }
      setFollowing(true);
      // Wait for loading shell → history paint, then snap to true bottom.
      queueMicrotask(() => {
        scrollToLatest("auto");
        requestAnimationFrame(() => scrollToLatest("auto"));
      });
      return;
    }

    // Live overlay → JSONL commit replaces synthetic tip ids. That is not a branch rewrite;
    // only treat tip disappearance as history rewrite when the list also shrinks.
    const tipReplaced =
      previousLastItemId !== undefined &&
      last?.id !== previousLastItemId &&
      !props.items.some((item) => item.id === previousLastItemId);
    const truncated =
      previousItemCount !== undefined && itemCount < previousItemCount;
    const historyRewritten = Boolean(tipReplaced && truncated);
    const forceFollow = last?.kind === "user" || historyRewritten;
    previousLastItemId = last?.id;
    previousItemCount = itemCount;
    // Branch Switch & view pins a specific entry; don't yank to bottom first.
    if (props.suppressAutoFollow) {
      setFollowing(false);
      return;
    }
    // End-of-turn commit: tip id churn only — keep scrollTop, do not re-snap to bottom.
    if (tipReplaced && !historyRewritten && last?.kind !== "user") {
      return;
    }
    if (forceFollow) setFollowing(true);
    if (!untrack(following) && !forceFollow) return;
    // Opening session still shows the loading shell — scroll after it unmounts.
    if (loading && itemCount === 0) return;

    queueMicrotask(() => {
      scrollToLatest("auto");
      requestAnimationFrame(() => scrollToLatest("auto"));
    });
  });

  function isNearBottom(element: HTMLElement): boolean {
    return element.scrollHeight - element.scrollTop - element.clientHeight <= 48;
  }

  function scrollToLatest(behavior: ScrollBehavior): void {
    if (!scrollRef) return;
    setFollowing(true);
    scrollRef.scrollTo({ top: scrollRef.scrollHeight, behavior });
  }

  /** rAF-coalesce scroll → following; only write when the boolean actually flips. */
  let scrollFollowFrame = 0;
  function onTimelineScroll(event: Event & { currentTarget: HTMLElement }): void {
    const target = event.currentTarget;
    if (scrollFollowFrame) return;
    scrollFollowFrame = requestAnimationFrame(() => {
      scrollFollowFrame = 0;
      const near = isNearBottom(target);
      if (near !== untrack(following)) setFollowing(near);
    });
  }
  onCleanup(() => {
    if (scrollFollowFrame) cancelAnimationFrame(scrollFollowFrame);
  });

  return (
    <div class="at-timeline-shell">
      <section
        ref={scrollRef}
        class="agent-timeline"
        aria-label="Agent conversation"
        onScroll={onTimelineScroll}
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
              latestUserId={latestUserId}
              runStatus={() => props.status.runStatus}
              pendingApprovalToolCallId={() => props.pendingApprovalToolCallId}
              canEditUser={() => Boolean(props.canEditUser && props.onEditUser)}
              canRetryLatest={() =>
                Boolean(props.canRetryLatest && props.onRetryLatest)
              }
              onAllowApproval={props.onAllowApproval}
              onDenyApproval={props.onDenyApproval}
              onPromptSuggestion={props.onPromptSuggestion}
              onEditUser={props.onEditUser}
              onRetryLatest={props.onRetryLatest}
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
  latestUserId: Accessor<string | null>;
  runStatus: Accessor<TimelineStatus["runStatus"]>;
  pendingApprovalToolCallId: Accessor<string | null | undefined>;
  canEditUser: Accessor<boolean>;
  canRetryLatest: Accessor<boolean>;
  onAllowApproval?: () => void;
  onDenyApproval?: () => void;
  onPromptSuggestion?: (prompt: string) => void;
  onEditUser?: (
    entryId: string,
    text: string,
    isLatest: boolean,
    options?: { summarizeAbandoned?: boolean },
  ) => void;
  onRetryLatest?: (entryId: string) => void;
};

function TimelineEntry(props: TimelineEntryProps) {
  // Key chrome on stable slots — NOT volatile JSONL/overlay item.id.
  // Overlay → snapshot commit rewrites message ids; remounting here flashes the list and jumps scroll.
  const toolGroupId = () => {
    const entry = props.entry();
    return entry.type === "tool_group" ? entry.id : null;
  };
  const errorGroupId = () => {
    const entry = props.entry();
    return entry.type === "error_group" ? entry.id : null;
  };
  /** user | assistant | tool | … — stable across commit for a given Index row. */
  const itemKind = () => {
    const entry = props.entry();
    return entry.type === "item" ? entry.item.kind : null;
  };
  const groupTools = () => {
    const entry = props.entry();
    return entry.type === "tool_group" ? entry.tools : [];
  };
  const groupErrors = () => {
    const entry = props.entry();
    return entry.type === "error_group" ? entry.errors : [];
  };
  const item = () => {
    const entry = props.entry();
    return entry.type === "item" ? entry.item : null;
  };

  return (
    <>
      <Show when={toolGroupId()}>
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
      <Show when={errorGroupId()}>
        {(id) => <ErrorGroup groupId={id()} errors={groupErrors()} />}
      </Show>
      <Show when={itemKind()} keyed>
        <TimelineItemEntry
          item={() =>
            item() ??
            ({
              id: "pending",
              kind: "assistant",
              stopReason: null,
              text: "",
              timestamp: 0,
            } as TimelineItem)
          }
          lastItemId={props.lastItemId}
          latestUserId={props.latestUserId}
          runStatus={props.runStatus}
          pendingApprovalToolCallId={props.pendingApprovalToolCallId}
          canEditUser={props.canEditUser}
          canRetryLatest={props.canRetryLatest}
          onAllowApproval={props.onAllowApproval}
          onDenyApproval={props.onDenyApproval}
          onPromptSuggestion={props.onPromptSuggestion}
          onEditUser={props.onEditUser}
          onRetryLatest={props.onRetryLatest}
        />
      </Show>
    </>
  );
}

function TimelineItemEntry(props: Omit<TimelineEntryProps, "entry"> & { item: Accessor<TimelineItem> }) {
  // String keys (not booleans) so Switch keeps the same Match across streaming updates.
  const kind = () => props.item().kind;
  return (
    <Switch>
      <Match when={kind() === "user" ? "user" : false}>
        <UserMessage
          item={props.item() as TimelineUserMessage}
          canEdit={props.canEditUser()}
          canRetry={
            props.canRetryLatest() && props.item().id === props.latestUserId()
          }
          isLatestUser={props.item().id === props.latestUserId()}
          onEdit={props.onEditUser}
          onRetry={props.onRetryLatest}
        />
      </Match>
      <Match when={kind() === "assistant" ? "assistant" : false}>
        <AssistantMessage
          item={props.item() as TimelineAssistantMessage}
          streaming={props.runStatus() === "streaming" && props.item().id === props.lastItemId()}
          isLatest={props.item().id === props.lastItemId()}
          onPrefillAnswers={props.onPromptSuggestion}
        />
      </Match>
      <Match when={kind() === "tool" ? "tool" : false}>
        <ToolCallBlock
          item={props.item() as TimelineToolCall}
          pendingApproval={
            props.pendingApprovalToolCallId() === (props.item() as TimelineToolCall).toolCallId
          }
          onAllow={props.onAllowApproval}
          onDeny={props.onDenyApproval}
        />
      </Match>
      <Match when={kind() === "branch_summary" || kind() === "compaction" ? "note" : false}>
        <ContextNote item={props.item() as TimelineBranchSummary | TimelineCompaction} />
      </Match>
    </Switch>
  );
}
