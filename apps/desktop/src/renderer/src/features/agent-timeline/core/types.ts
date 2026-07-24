import type { JsonValue, PiHostState, PiTerminalStopReason } from "@pi-3.14/model";

export type TimelineToolStatus = "running" | "success" | "error";
export type TimelineRunStatus = "idle" | "streaming" | "compacting" | "retrying" | "error" | "aborted";

export type TimelineStatus = {
  errorMessage: string | null;
  retryAttempt: number | null;
  runStatus: TimelineRunStatus;
};

export type TimelineUserMessage = {
  id: string;
  kind: "user";
  text: string;
  timestamp: number;
};

export type TimelineAssistantMessage = {
  id: string;
  kind: "assistant";
  stopReason: PiTerminalStopReason | null;
  text: string;
  /** Streaming/final model reasoning, when the provider exposes it. */
  thinking?: string;
  /** Set when the turn failed (e.g. provider Connection error). */
  errorMessage?: string;
  timestamp: number;
};

export type TimelineToolCall = {
  args: JsonValue;
  detail: string;
  diff: string | null;
  id: string;
  kind: "tool";
  output: string | null;
  status: TimelineToolStatus;
  summary: string;
  timestamp: number;
  toolCallId: string;
  toolName: string;
};

export type TimelineBranchSummary = {
  id: string;
  kind: "branch_summary";
  text: string;
  timestamp: number;
};

export type TimelineCompaction = {
  id: string;
  kind: "compaction";
  text: string;
  timestamp: number;
};

export type TimelineItem =
  | TimelineUserMessage
  | TimelineAssistantMessage
  | TimelineToolCall
  | TimelineBranchSummary
  | TimelineCompaction;

export type TimelineState = {
  activeAssistantId: string | null;
  activeToolIds: Record<string, string>;
  hostState: PiHostState | null;
  items: TimelineItem[];
  status: TimelineStatus;
};

export type TimelineTurnResult = {
  errorMessage?: string;
  stopReason: PiTerminalStopReason;
};
