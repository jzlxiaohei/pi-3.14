import {
  isTerminalStopReason,
  type PiHostEvent,
  type PiHostState,
  type PiStopReason,
  type PiTurnResult,
} from "@pi-3.14/model";
import { summarizeToolStart, summarizeToolUpdate } from "./tool-summary";
import type {
  TimelineAssistantMessage,
  TimelineItem,
  TimelineState,
  TimelineToolCall,
  TimelineTurnResult,
} from "./types";

export function createInitialTimelineState(): TimelineState {
  return {
    activeAssistantId: null,
    activeToolIds: {},
    hostState: null,
    items: [],
    status: {
      errorMessage: null,
      retryAttempt: null,
      runStatus: "idle",
    },
  };
}

export function appendUserMessage(state: TimelineState, text: string, at = Date.now()): TimelineState {
  return {
    ...state,
    activeAssistantId: null,
    items: [
      ...state.items,
      {
        id: createId("user", at),
        kind: "user",
        text,
        timestamp: at,
      },
    ],
    status: {
      errorMessage: null,
      retryAttempt: null,
      runStatus: "streaming",
    },
  };
}

export function applyHostState(state: TimelineState, hostState: PiHostState): TimelineState {
  return {
    ...state,
    hostState,
    status: {
      ...state.status,
      runStatus: hostState.isCompacting
        ? "compacting"
        : hostState.isStreaming
          ? "streaming"
          : state.status.runStatus === "streaming"
            ? "idle"
            : state.status.runStatus,
    },
  };
}

export function applyTurnResult(state: TimelineState, result: TimelineTurnResult | PiTurnResult): TimelineState {
  return {
    ...state,
    activeAssistantId: null,
    activeToolIds: {},
    status: {
      errorMessage: result.errorMessage ?? null,
      retryAttempt: null,
      runStatus:
        result.stopReason === "aborted" ? "aborted" : result.stopReason === "error" ? "error" : "idle",
    },
  };
}

/** Replace committed history from JSONL projection and clear the live overlay. */
export function applyTimelineSnapshot(
  state: TimelineState,
  items: TimelineItem[],
  result?: TimelineTurnResult | PiTurnResult,
): TimelineState {
  return {
    ...state,
    activeAssistantId: null,
    activeToolIds: {},
    items,
    status: result
      ? {
          errorMessage: result.errorMessage ?? null,
          retryAttempt: null,
          runStatus:
            result.stopReason === "aborted"
              ? "aborted"
              : result.stopReason === "error"
                ? "error"
                : "idle",
        }
      : {
          errorMessage: null,
          retryAttempt: null,
          runStatus: "idle",
        },
  };
}

/** Start a turn overlay: pending user + empty assistant placeholder for loading UI. */
export function beginTurnOverlay(
  state: TimelineState,
  text: string,
  at = Date.now(),
): TimelineState {
  const withUser = appendUserMessage(
    {
      ...createInitialTimelineState(),
      hostState: state.hostState,
    },
    text,
    at,
  );
  // Seed an empty assistant so the timeline shows Thinking… before the first token/tool.
  return getOrCreateAssistant(withUser, at).state;
}

export function reduceTimelineEvent(state: TimelineState, event: PiHostEvent): TimelineState {
  switch (event.type) {
    case "agent_start":
      return {
        ...state,
        activeAssistantId: null,
        status: { errorMessage: null, retryAttempt: null, runStatus: "streaming" },
      };
    case "text_delta":
      return appendAssistantText(state, event.text, event.at);
    case "tool_start":
      return appendToolStart(state, event);
    case "tool_update":
      return updateTool(state, event.toolCallId, summarizeToolUpdate(event.toolName, event.partialResult, "running"));
    case "tool_end":
      return updateTool(
        state,
        event.toolCallId,
        summarizeToolUpdate(event.toolName, event.result, event.isError ? "error" : "success"),
      );
    case "message_end":
      if (event.role !== "assistant") return state;
      // toolUse shells with no visible text are not chat turns — skip the placeholder.
      if (event.stopReason === "toolUse" && !event.text.trim()) {
        return { ...state, activeAssistantId: null };
      }
      return finishAssistantMessage(state, event.text, event.stopReason, event.at);
    case "queue_update":
      return state;
    case "compaction":
      return {
        ...state,
        status: {
          errorMessage: event.errorMessage ?? null,
          retryAttempt: state.status.retryAttempt,
          runStatus: event.phase === "start" ? "compacting" : event.aborted ? "aborted" : "streaming",
        },
      };
    case "retry":
      return {
        ...state,
        status: {
          errorMessage: event.errorMessage ?? null,
          retryAttempt: event.phase === "start" ? event.attempt : null,
          runStatus: event.phase === "start" ? "retrying" : event.success === false ? "error" : "streaming",
        },
      };
  }
}

function appendAssistantText(state: TimelineState, delta: string, at: number): TimelineState {
  const assistant = getOrCreateAssistant(state, at);
  return {
    ...assistant.state,
    items: assistant.state.items.map((item) =>
      item.id === assistant.id && item.kind === "assistant"
        ? { ...item, text: `${item.text}${delta}` }
        : item,
    ),
  };
}

function finishAssistantMessage(
  state: TimelineState,
  text: string,
  stopReason: PiStopReason | undefined,
  at: number,
): TimelineState {
  const assistant = getOrCreateAssistant(state, at);
  const nextText = text || assistant.state.items.find(
    (item): item is TimelineAssistantMessage => item.id === assistant.id && item.kind === "assistant",
  )?.text || "";
  const terminal = stopReason !== undefined && isTerminalStopReason(stopReason);

  // Drop empty terminal assistants (e.g. thinking-only content with no text parts).
  if (!nextText.trim() && terminal) {
    return {
      ...assistant.state,
      activeAssistantId: null,
      items: assistant.state.items.filter((item) => item.id !== assistant.id),
      status: {
        errorMessage: stopReason === "error" ? assistant.state.status.errorMessage : null,
        retryAttempt: null,
        runStatus: terminalRunStatus(stopReason),
      },
    };
  }

  return {
    ...assistant.state,
    activeAssistantId: null,
    items: assistant.state.items.map((item) =>
      item.id === assistant.id && item.kind === "assistant"
        ? {
            ...item,
            stopReason: terminal ? stopReason : item.stopReason,
            text: nextText,
          }
        : item,
    ),
    status: terminal
      ? {
          errorMessage: stopReason === "error" ? assistant.state.status.errorMessage : null,
          retryAttempt: null,
          runStatus: terminalRunStatus(stopReason),
        }
      : assistant.state.status,
  };
}

function terminalRunStatus(stopReason: PiStopReason): TimelineState["status"]["runStatus"] {
  if (stopReason === "aborted") return "aborted";
  if (stopReason === "error") return "error";
  return "idle";
}

function appendToolStart(
  state: TimelineState,
  event: Extract<PiHostEvent, { type: "tool_start" }>,
): TimelineState {
  const start = summarizeToolStart(event.toolName, event.args);
  const item: TimelineToolCall = {
    args: event.args,
    detail: start.detail,
    diff: null,
    id: createId("tool", event.at, event.toolCallId),
    kind: "tool",
    output: null,
    status: "running",
    summary: start.summary,
    timestamp: event.at,
    toolCallId: event.toolCallId,
    toolName: event.toolName,
  };
  return {
    ...state,
    activeAssistantId: null,
    activeToolIds: { ...state.activeToolIds, [event.toolCallId]: item.id },
    items: [...state.items, item],
  };
}

function updateTool(
  state: TimelineState,
  toolCallId: string,
  update: Pick<TimelineToolCall, "detail" | "diff" | "output" | "status" | "summary">,
): TimelineState {
  const itemId = state.activeToolIds[toolCallId];
  if (!itemId) return state;
  return {
    ...state,
    items: state.items.map((item) => {
      if (item.id !== itemId || item.kind !== "tool") return item;
      return {
        ...item,
        ...update,
        diff: update.diff ?? item.diff,
        output: update.output ?? item.output,
      };
    }),
  };
}

function getOrCreateAssistant(
  state: TimelineState,
  at: number,
): { id: string; state: TimelineState } {
  if (state.activeAssistantId) return { id: state.activeAssistantId, state };
  const id = createId("assistant", at);
  const item: TimelineAssistantMessage = {
    id,
    kind: "assistant",
    stopReason: null,
    text: "",
    timestamp: at,
  };
  return {
    id,
    state: {
      ...state,
      activeAssistantId: id,
      items: [...state.items, item],
    },
  };
}

function createId(prefix: string, at: number, suffix = Math.random().toString(36).slice(2)): string {
  return `${prefix}-${at}-${suffix}`;
}
