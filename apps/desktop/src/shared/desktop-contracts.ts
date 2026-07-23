import type {
  JsonValue,
  PiHostEvent,
  PiHostState,
  PiModelOption,
  PiModelRef,
  PiTerminalStopReason,
  PiThinkingLevel,
  PiTurnResult,
} from "@pi-3.14/model";

export type { PiModelOption, PiModelRef, PiThinkingLevel };

export type WorkspaceTaskStatus = "idle" | "running" | "done" | "error";

/** Matt engineering playbooks (first slice: three paths). */
export type TaskPlaybookId = "feature-default" | "small-tdd" | "bugfix";

export type TaskWorkflowStepStatus = "pending" | "active" | "done" | "skipped";

export type TaskWorkflowStep = {
  id: string;
  status: TaskWorkflowStepStatus;
};

/** Task-shell SOP progress — decoupled from chat/timeline. */
export type TaskWorkflow = {
  playbookId: TaskPlaybookId;
  stepId: string;
  steps: TaskWorkflowStep[];
};

export type WorkspaceTask = {
  id: string;
  title: string;
  cwd: string;
  sessionPath: string | null;
  sessionId: string | null;
  status: WorkspaceTaskStatus;
  createdAt: number;
  updatedAt: number;
  workflow?: TaskWorkflow;
};

export type WorkspaceTaskUpdate = {
  id: string;
  title?: string;
  /** Set to attach/update; `null` clears the playbook. */
  workflow?: TaskWorkflow | null;
};

export type PiSessionCreateOptions = {
  cwd?: string;
  /** Resume this JSONL path when set. */
  sessionPath?: string | null;
  taskId?: string;
  title?: string;
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

/** Install Matt engineering skills into `{cwd}/.pi/skills`. */
export type WorkspaceInstallMattSkillsRequest = {
  cwd: string;
};

export type WorkspaceInstallMattSkillsResult =
  | {
      ok: true;
      skillsDir: string;
      skillNames: string[];
      /** Wrote cwd → trusted in ~/.pi/agent/trust.json */
      trusted: boolean;
    }
  | { ok: false; error: string };

/** Probe whether Matt engineering skills already exist under `{cwd}/.pi/skills`. */
export type WorkspaceMattSkillsStatusRequest = {
  cwd: string;
};

export type WorkspaceMattSkillsStatus = {
  cwd: string;
  skillsDir: string;
  /** True when core engineering skills are present under `.pi/skills`. */
  installed: boolean;
  skillNames: string[];
  missing: string[];
  /**
   * True when `/setup-matt-pocock-skills` artifacts exist:
   * `docs/agents/issue-tracker.md`, `domain.md`, optional `triage-labels.md`,
   * and `## Agent skills` in CLAUDE.md / AGENTS.md.
   */
  setupComplete: boolean;
  /** Missing setup artifacts (empty when setupComplete). */
  setupMissing: string[];
};

/** Main → utilityProcess PI host commands. */
export type PiHostCommand =
  | { id: string; type: "abort" }
  | { id: string; type: "create"; cwd: string; sessionPath?: string | null }
  | { id: string; type: "dispose" }
  | { id: string; type: "get_state" }
  | { id: string; type: "list_models" }
  | { id: string; type: "list_thinking_levels" }
  | { id: string; type: "set_model"; provider: string; modelId: string }
  | { id: string; type: "set_thinking_level"; level: PiThinkingLevel }
  | { id: string; text: string; type: "prompt" }
  | {
      id: string;
      type: "tool_approval_reply";
      approvalId: string;
      approved: boolean;
      reason?: string;
    };

export type PiHostResponse =
  | {
      id: string;
      ok: true;
      result:
        | PiHostState
        | PiTurnResult
        | PiModelOption[]
        | PiThinkingLevel[]
        | { disposed: true }
        | { aborted: true };
    }
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
