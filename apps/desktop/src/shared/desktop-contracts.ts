import type {
  JsonValue,
  PiHostEvent,
  PiHostState,
  PiLiveInspectSnapshot,
  PiModelOption,
  PiModelRef,
  PiNavigateTreeResult,
  PiPreparedBranchSummary,
  PiTerminalStopReason,
  PiThinkingLevel,
  PiTurnResult,
} from "@pi-3.14/model";
import type { PiContextProjection, PiSessionAnalysis } from "@pi-3.14/session";

export type {
  PiLiveInspectSnapshot,
  PiModelOption,
  PiModelRef,
  PiNavigateTreeResult,
  PiPreparedBranchSummary,
  PiThinkingLevel,
};

export type TaskStatus = "idle" | "running" | "done" | "error" | "interrupted";
export type AgentStatus = TaskStatus;
/** @deprecated Use TaskStatus */
export type WorkspaceTaskStatus = TaskStatus;
export type SessionAvailability = "available" | "missing";

export type SkillPolicy = {
  ignoredSkillNames: string[];
};

/** Matt engineering playbooks (first slice: three paths). */
export type TaskPlaybookId = "feature-default" | "small-tdd" | "bugfix";

export type TaskWorkflowStepStatus = "pending" | "active" | "done" | "skipped";

export type TaskWorkflowStep = {
  id: string;
  status: TaskWorkflowStepStatus;
  /** Bound Agent for this step’s PI Session (lazy on first open/advance). */
  agentId?: string;
};

/** Task-shell SOP progress — decoupled from chat/timeline. */
export type TaskWorkflow = {
  playbookId: TaskPlaybookId;
  /** Playbook cursor (not necessarily the Agent being viewed). */
  stepId: string;
  steps: TaskWorkflowStep[];
};

/** User-facing work unit. Never owns a PI Session. */
export type Task = {
  id: string;
  title: string;
  cwd: string;
  status: TaskStatus;
  position: number;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
  workflow?: TaskWorkflow;
};

export type AgentTemplateSource = "system" | "user";

export type AgentTemplate = {
  id: string;
  name: string;
  /** Library-only blurb; not part of Agent snapshot / model prompt. */
  description: string;
  systemPrompt: string;
  skillPolicy: SkillPolicy;
  source: AgentTemplateSource;
  createdAt: number;
  updatedAt: number;
};

export type AgentTemplateCreateRequest = {
  name: string;
  description?: string;
  systemPrompt?: string;
  skillPolicy?: SkillPolicy;
};

export type AgentTemplateUpdateRequest = {
  id: string;
  name?: string;
  description?: string;
  systemPrompt?: string;
  skillPolicy?: SkillPolicy;
};

export type AgentTemplateDeleteResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export type AgentTemplateResetResult =
  | { ok: true; template: AgentTemplate }
  | { ok: false; error: string };

/** Executable runner: 1:1 PI Session + instance snapshot. */
export type Agent = {
  id: string;
  taskId: string;
  parentAgentId: string | null;
  templateId: string | null;
  name: string;
  /** Role Prompt (role base). Non-empty replaces PI default coding base on bind. */
  systemPrompt: string;
  skillPolicy: SkillPolicy;
  inputContext: string | null;
  outputContext: string | null;
  sessionId: string | null;
  sessionPath: string | null;
  /** Derived at read time from session_path on disk. */
  sessionAvailability: SessionAvailability;
  /** null = Role Prompt not yet confirmed for this instance. */
  rolePromptConfirmedAt: number | null;
  status: AgentStatus;
  position: number;
  createdAt: number;
  updatedAt: number;
};

/**
 * @deprecated Prefer `Task`. Temporary alias for incremental renames —
 * Tasks no longer carry session fields.
 */
export type WorkspaceTask = Task;

export type AppPreferences = {
  theme: "dark" | "light";
  tasksOpen: boolean;
  inspectorOpen: boolean;
  tasksWidth: number;
  inspectorWidth: number;
  inspectorTab: "files" | "terminal" | "context";
  showArchived: boolean;
};

export type AppPreferencesUpdate = Partial<AppPreferences>;

export type WorkspacePreferences = {
  cwd: string;
  taskGroupCollapsed: boolean;
  reviewBaseRef: string | null;
};

export type WorkspacePreferencesUpdate = Partial<
  Pick<WorkspacePreferences, "taskGroupCollapsed" | "reviewBaseRef">
>;

export type LegacyPanelPreferences = {
  tasksOpen?: boolean;
  inspectorOpen?: boolean;
};

export type PiTasksBootstrapRequest = {
  legacyPanelPreferences?: LegacyPanelPreferences;
};

export type WorkspaceTaskMoveRequest = {
  taskId: string;
  beforeTaskId: string | null;
};

export type WorkspaceTaskRelinkResult =
  | { ok: true; agent: Agent }
  | { ok: false; cancelled?: boolean; error: string };

export type TaskCreateRequest = {
  cwd: string;
  title?: string;
  playbookId?: TaskPlaybookId | null;
};

export type AgentCreateFromTemplateRequest = {
  taskId: string;
  templateId: string;
  stepId?: string;
  parentAgentId?: string | null;
  inputContext?: string | null;
  name?: string;
};

export type AgentSpawnChildRequest = {
  parentAgentId: string;
  templateId?: string | null;
  name: string;
  systemPrompt?: string;
  skillPolicy?: SkillPolicy;
  inputContext?: string | null;
};

export type AgentUpdateRequest = {
  id: string;
  name?: string;
  systemPrompt?: string;
  skillPolicy?: SkillPolicy;
  inputContext?: string | null;
  outputContext?: string | null;
  /**
   * When true, set rolePromptConfirmedAt = now.
   * Used by: banner confirm, save Role Prompt, restore default.
   */
  confirmRolePrompt?: boolean;
  /** Explicit timestamp write; prefer confirmRolePrompt for normal UI. */
  rolePromptConfirmedAt?: number | null;
};

export type AgentRestoreRolePromptResult =
  | { ok: true; agent: Agent }
  | { ok: false; error: string };

export type AdvanceWorkflowRequest = {
  taskId: string;
  mode: "done" | "skipped";
  /** Last assistant handoff text from the active step Agent. */
  handoffText?: string | null;
};

export type AdvanceWorkflowResult = {
  task: Task;
  previousAgent: Agent | null;
  nextAgent: Agent | null;
  starterPrompt: string | null;
  completed: boolean;
};

export type ReviewedFilesRequest = {
  cwd: string;
  baseRef: string;
  files: Array<{ path: string; fingerprint: string }>;
};

export type ReviewedFileUpdate = {
  cwd: string;
  baseRef: string;
  path: string;
  fingerprint: string;
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
  /** Create Task shell (optional playbook). No session on Task. */
  taskId?: string;
  title?: string;
  playbookId?: TaskPlaybookId | null;
  ignoredSkillNames?: string[];
};

/** Write a skill into the user's PI personal library (~/.pi/agent/skills). */
export type PersonalSkillWriteRequest = {
  /** Folder name under ~/.pi/agent/skills */
  slug: string;
  skillMd: string;
  overwrite?: boolean;
};

export type PersonalSkillWriteResult =
  | { ok: true; slug: string; skillPath: string; skillsDir: string }
  | { ok: false; error: string };

export type PiWorkspacePickResult =
  | {
      cancelled: true;
    }
  | {
      cancelled: false;
      cwd: string;
    };

/** Save a copy of the active task's PI session JSONL. */
export type PiSessionExportResult =
  | { ok: true; path: string }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled?: false; error: string };

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
      thinking?: string;
      /** Set when the turn failed (e.g. provider Connection error). */
      errorMessage?: string;
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
    }
  | {
      id: string;
      kind: "branch_summary";
      text: string;
      timestamp: number;
    }
  | {
      id: string;
      kind: "compaction";
      /** Response: model summary text. */
      text: string;
      timestamp: number;
      tokensBefore?: number | null;
      firstKeptEntryId?: string | null;
      readFiles?: string[];
      modifiedFiles?: string[];
    };

export type PiTimelineSnapshot = {
  leafEntryId: string | null;
  items: PiTimelineItem[];
};

/** Collapsed session tree for the Branches popover (user-centric). */
export type PiBranchTreeNode = {
  entryId: string;
  kind: "user" | "turn_summary" | "compaction";
  label: string;
  onActivePath: boolean;
  /** Direct child count in the full session tree (branch signal). */
  childCount: number;
  children: PiBranchTreeNode[];
  /** Small badges on the card (e.g. 压缩). */
  tags?: string[];
};

/** Sibling / alternate root chip for spine + fork-point UI. */
export type PiBranchForkChip = {
  entryId: string;
  label: string;
  onActivePath: boolean;
};

/** Active-path spine view: linear path + sibling forks + collapsed other roots. */
export type PiBranchSpineNode = {
  entryId: string;
  kind: "user" | "turn_summary";
  label: string;
  /** User siblings under the same parent (includes self when kind is user). */
  siblingForks: PiBranchForkChip[];
};

export type PiBranchSpineView = {
  spine: PiBranchSpineNode[];
  /** Root-level user paths not on the active spine (UI collapses by default). */
  otherRoots: PiBranchForkChip[];
  /**
   * Leaf sits at a fork parent: user children exist but none are on the active path
   * (typical after Revert navigates off a user entry).
   */
  forkPoint: { siblingForks: PiBranchForkChip[] } | null;
};

/** Stored compaction payload for graph / timeline detail (request meta + response summary). */
export type PiCompactionDetail = {
  /** Context size when compaction ran (request-side signal). */
  tokensBefore: number | null;
  firstKeptEntryId: string | null;
  readFiles: string[];
  modifiedFiles: string[];
  /** Model summary written into context (response). */
  summary: string;
};

/** Flattened session branch graph for the Branches flow panel. */
export type PiBranchFlowNode = {
  id: string;
  kind: "user" | "turn_summary" | "compaction";
  /** Short card label. */
  label: string;
  /** Fuller text for the node preview popover. */
  preview: string;
  onActivePath: boolean;
  /** True when this node has 2+ children (a real branch hub). */
  isFork: boolean;
  /** Direct child count — shown on fork hubs. */
  childCount: number;
  /** Small badges (e.g. 压缩). */
  tags?: string[];
  /** Present when kind is compaction — request meta + response summary. */
  compaction?: PiCompactionDetail;
};

export type PiBranchFlowEdge = {
  id: string;
  source: string;
  target: string;
  onActivePath: boolean;
};

export type PiBranchFlowGraph = {
  nodes: PiBranchFlowNode[];
  edges: PiBranchFlowEdge[];
  /** Same signal as spine forkPoint — leaf at a parent with off-path user children. */
  forkPoint: { siblingForks: PiBranchForkChip[] } | null;
};

export type PiSessionInspectResult = {
  sessionPath: string | null;
  leafEntryId: string | null;
  live: PiLiveInspectSnapshot | null;
  analysis: PiSessionAnalysis | null;
  context: PiContextProjection | null;
  branchTree: PiBranchTreeNode[];
  branchSpine: PiBranchSpineView;
  branchFlow: PiBranchFlowGraph;
};

export type PiSessionNavigateRequest = {
  entryId: string;
  /** When set, navigate then prompt with this text (edit/revert). */
  promptText?: string;
  summarize?: boolean;
};

export type PiSessionNavigateResult = PiNavigateTreeResult & {
  timeline: PiTimelineSnapshot;
  sessionPath: string | null;
  leafEntryId: string | null;
  /** Present when navigate was followed by a prompt. */
  prompt?: PiPromptResult;
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
      task: Task;
      agent: Agent;
    };

export type PiPromptResult = PiTurnResult & {
  timeline: PiTimelineSnapshot;
  task: Task | null;
  agent: Agent | null;
};

export type PiActivateAgentResult =
  | {
      ok: true;
      task: Task;
      agent: Agent;
      state: PiHostState;
      timeline: PiTimelineSnapshot;
    }
  | {
      ok: false;
      reason: "session_missing";
      task: Task;
      agent: Agent;
    };

/** @deprecated Use PiActivateAgentResult */
export type PiActivateTaskResult = PiActivateAgentResult;

export type PiToolApprovalRequest = {
  id: string;
  /** Agent / host that requested approval (concurrent multi-host). */
  agentId?: string;
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
  /** Sidebar Task list (all tasks; no parent tree). */
  tasks: Task[];
  /** @deprecated Alias of tasks */
  rootTasks: Task[];
  activeTask: Task | null;
  activeTaskId: string | null;
  /** @deprecated Same as activeTaskId (no root/child split). */
  activeRootTaskId: string | null;
  activeAgent: Agent | null;
  activeAgentId: string | null;
  /** Agents for active task (and empty map entries as needed). */
  agentsByTaskId: Record<string, Agent[]>;
  appPreferences: AppPreferences;
  workspacePreferences: Record<string, WorkspacePreferences>;
  legacyBrowserPreferencesImported: boolean;
};

/** Result of archiving / restoring a task (row kept; JSONL kept on disk). */
export type PiTasksArchiveResult = {
  tasks: Task[];
  rootTasks: Task[];
  activeTaskId: string | null;
  activeRootTaskId: string | null;
  activeAgentId: string | null;
  /** True when the archived task held the bound Agent (caller should rebind or clear UI). */
  disposed: boolean;
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
  oldPath?: string;
  reviewFingerprint?: string;
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

/**
 * Main → utilityProcess PI host commands.
 *
 * Concurrent model: one utilityProcess, many EmbeddedPiHosts keyed by `hostId`
 * (agent id). `tool_approval_reply` is keyed by approvalId only.
 * `dispose` without hostId tears down every host in the process.
 */
export type PiHostCommand =
  | { id: string; hostId: string; type: "abort" }
  | {
      id: string;
      hostId: string;
      type: "create";
      cwd: string;
      sessionPath?: string | null;
      ignoredSkillNames?: string[];
      /**
       * Role Prompt base. Non-empty → replace PI default coding base.
       * Empty/omitted → PI default base. Product appends stay host-owned.
       */
      rolePrompt?: string;
    }
  | { id: string; hostId?: string; type: "dispose" }
  | { id: string; hostId: string; type: "get_state" }
  | {
      id: string;
      hostId: string;
      type: "inspect_live";
      /** summary skips transcript convertToLlm (HUD); full is Context inspector. */
      detail?: "summary" | "full";
    }
  | { id: string; hostId: string; type: "list_models" }
  | { id: string; hostId: string; type: "list_thinking_levels" }
  | {
      id: string;
      hostId: string;
      type: "navigate_tree";
      entryId: string;
      summarize?: boolean;
      label?: string;
    }
  | { id: string; hostId: string; type: "prepare_branch_summary" }
  | { id: string; hostId: string; type: "get_prepared_branch_summary" }
  | { id: string; hostId: string; type: "clear_prepared_branch_summary" }
  | { id: string; hostId: string; type: "set_model"; provider: string; modelId: string }
  | { id: string; hostId: string; type: "set_thinking_level"; level: PiThinkingLevel }
  | { id: string; hostId: string; type: "set_auto_approve"; unlocked: boolean }
  | { id: string; hostId: string; type: "get_auto_approve" }
  | { id: string; hostId: string; text: string; type: "prompt" }
  | { id: string; hostId: string; type: "continue_turn" }
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
        | PiLiveInspectSnapshot
        | PiNavigateTreeResult
        | PiPreparedBranchSummary
        | null
        | { disposed: true }
        | { aborted: true }
        | { ok: true }
        | { unlocked: boolean };
    }
  | { errorMessage: string; id: string; ok: false };

export type PiHostToolApprovalRequestMessage = {
  type: "tool_approval";
  hostId: string;
  approvalId: string;
  toolCallId: string;
  toolName: string;
  args: JsonValue;
};

export type PiHostProcessMessage =
  | PiHostResponse
  | { type: "ready" }
  | { type: "event"; hostId: string; event: PiHostEvent }
  | PiHostToolApprovalRequestMessage;
