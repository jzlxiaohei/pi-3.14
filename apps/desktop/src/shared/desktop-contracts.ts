import type {
  JsonValue,
  PiHostEvent,
  PiHostState,
  PiTerminalStopReason,
  PiTurnResult,
} from "@pi-3.14/model";

export type WorkspaceTaskStatus = "idle" | "running" | "done" | "error";

export type WorkspaceTask = {
  id: string;
  title: string;
  cwd: string;
  sessionPath: string | null;
  sessionId: string | null;
  status: WorkspaceTaskStatus;
  createdAt: number;
  updatedAt: number;
};

export type PiSessionCreateOptions = {
  cwd?: string;
  /** Resume this JSONL path when set. */
  sessionPath?: string | null;
  taskId?: string;
};

export type PiWorkspacePickResult =
  | {
      cancelled: true;
    }
  | {
      cancelled: false;
      cwd: string;
    };

export type PiTimelineItem =
  | {
      id: string;
      kind: "user";
      text: string;
      timestamp: number;
    }
  | {
      id: string;
      kind: "assistant";
      stopReason: PiTerminalStopReason | null;
      text: string;
      timestamp: number;
    }
  | {
      id: string;
      kind: "tool";
      args: JsonValue;
      detail: string;
      diff: string | null;
      output: string | null;
      status: "running" | "success" | "error";
      summary: string;
      timestamp: number;
      toolCallId: string;
      toolName: string;
    };

export type PiTimelineSnapshot = {
  leafEntryId: string | null;
  items: PiTimelineItem[];
};

export type PiSessionCreateResult =
  | {
      cancelled: true;
    }
  | {
      cancelled: false;
      cwd: string;
      state: PiHostState;
      timeline: PiTimelineSnapshot;
      task: WorkspaceTask;
    };

export type PiPromptResult = PiTurnResult & {
  timeline: PiTimelineSnapshot;
  task: WorkspaceTask | null;
};

export type PiActivateTaskResult = {
  task: WorkspaceTask;
  state: PiHostState;
  timeline: PiTimelineSnapshot;
};

export type PiToolApprovalRequest = {
  id: string;
  toolCallId: string;
  toolName: string;
  args: JsonValue;
};

export type PiToolApprovalReply = {
  id: string;
  approved: boolean;
  reason?: string;
};

export type PiTasksBootstrap = {
  tasks: WorkspaceTask[];
  selectedTaskId: string | null;
};

export type WorkspaceDirEntry = {
  name: string;
  path: string;
  type: "file" | "folder";
};

export type WorkspaceListRequest = {
  cwd: string;
  path?: string;
};

export type WorkspaceListResult = {
  cwd: string;
  path: string;
  entries: WorkspaceDirEntry[];
};

export type WorkspaceGitFile = {
  path: string;
  status: "added" | "deleted" | "modified" | "renamed" | "untracked";
};

export type WorkspaceGitRequest = {
  cwd: string;
  /**
   * Diff base ref (branch / remote-tracking / HEAD).
   * - omit / undefined: `HEAD` (working-tree status; inspector default)
   * - null: auto-pick `main` / `master` / upstream / `HEAD` (review default)
   * - string: use that ref when valid
   */
  baseRef?: string | null;
};

export type WorkspaceGitSnapshot = {
  isRepo: boolean;
  branch: string | null;
  upstream: string | null;
  /** Resolved base used for `files` / `patch` (working tree vs this ref). */
  baseRef: string;
  /** Compare targets (local + remote-tracking), excluding current branch / its upstream. */
  bases: string[];
  files: WorkspaceGitFile[];
  /** Combined working-tree patch vs `baseRef`, plus untracked file patches (may be truncated). */
  patch: string | null;
};

export type WorkspaceGitDiscardRequest = {
  cwd: string;
  /** Repo-relative path. */
  path: string;
};

export type WorkspaceGitDiscardResult =
  | { ok: true; path: string }
  | { cancelled?: boolean; error: string; ok: false };

export type WorkspaceOpenReviewRequest = {
  cwd: string;
  /** Repo-relative path to preselect in the review window. */
  path?: string | null;
};

/** Main → utilityProcess PI host commands. */
export type PiHostCommand =
  | { id: string; type: "abort" }
  | { id: string; type: "create"; cwd: string; sessionPath?: string | null }
  | { id: string; type: "dispose" }
  | { id: string; type: "get_state" }
  | { id: string; text: string; type: "prompt" }
  | {
      id: string;
      type: "tool_approval_reply";
      approvalId: string;
      approved: boolean;
      reason?: string;
    };

export type PiHostResponse =
  | { id: string; ok: true; result: PiHostState | PiTurnResult | { disposed: true } | { aborted: true } }
  | { errorMessage: string; id: string; ok: false };

export type PiHostToolApprovalRequestMessage = {
  type: "tool_approval";
  approvalId: string;
  toolCallId: string;
  toolName: string;
  args: JsonValue;
};

export type PiHostProcessMessage =
  | PiHostResponse
  | { type: "ready" }
  | { type: "event"; event: PiHostEvent }
  | PiHostToolApprovalRequestMessage;
