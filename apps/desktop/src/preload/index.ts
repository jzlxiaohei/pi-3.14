import { contextBridge, ipcRenderer } from "electron";
import type {
  PiHostEvent,
  PiHostState,
  PiModelOption,
  PiPreparedBranchSummary,
  PiThinkingLevel,
} from "@pi-3.14/model";
import type { ProviderQuotaSnapshot } from "@pi-3.14/usage";
import type {
  AppPreferences,
  AppPreferencesUpdate,
  PiActivateTaskResult,
  PiPromptResult,
  PiSessionCreateOptions,
  PiSessionCreateResult,
  PiSessionExportResult,
  PiSessionInspectResult,
  PiSessionNavigateRequest,
  PiSessionNavigateResult,
  PiTasksBootstrap,
  PiTasksBootstrapRequest,
  PiTasksArchiveResult,
  ReviewedFileUpdate,
  ReviewedFilesRequest,
  PiTimelineSnapshot,
  PiToolApprovalReply,
  PiToolApprovalRequest,
  PersonalSkillWriteRequest,
  PersonalSkillWriteResult,
  PiWorkspacePickResult,
  WorkspaceGitDiscardRequest,
  WorkspaceGitDiscardResult,
  WorkspaceGitRequest,
  WorkspaceGitSnapshot,
  WorkspaceInstallMattSkillsRequest,
  WorkspaceInstallMattSkillsResult,
  WorkspaceListRequest,
  WorkspaceListResult,
  WorkspaceMattSkillsStatus,
  WorkspaceMattSkillsStatusRequest,
  WorkspaceOpenReviewRequest,
  WorkspacePreferences,
  WorkspacePreferencesUpdate,
  WorkspaceTask,
  WorkspaceTaskMoveRequest,
  WorkspaceTaskRelinkResult,
  WorkspaceTaskUpdate,
} from "../shared/desktop-contracts";

export type DesktopAppInfo = {
  name: string;
  version: string;
  platform: NodeJS.Platform;
};

const api = {
  getAppInfo: () => ipcRenderer.invoke("app:get-info") as Promise<DesktopAppInfo>,
  /** Clipboard via main process — sandboxed preload has no reliable electron.clipboard. */
  clipboard: {
    writeText: (text: string) =>
      ipcRenderer.invoke("clipboard:write-text", text) as Promise<{ ok: true }>,
  },
  tasks: {
    bootstrap: (request?: PiTasksBootstrapRequest) =>
      ipcRenderer.invoke("pi:tasks:bootstrap", request) as Promise<PiTasksBootstrap>,
    list: () => ipcRenderer.invoke("pi:tasks:list") as Promise<WorkspaceTask[]>,
    listChildren: (parentTaskId: string) =>
      ipcRenderer.invoke("pi:tasks:list-children", parentTaskId) as Promise<WorkspaceTask[]>,
    activate: (taskId: string, options?: { force?: boolean }) =>
      ipcRenderer.invoke("pi:tasks:activate", taskId, options) as Promise<PiActivateTaskResult>,
    update: (request: WorkspaceTaskUpdate) =>
      ipcRenderer.invoke("pi:tasks:update", request) as Promise<WorkspaceTask | null>,
    move: (request: WorkspaceTaskMoveRequest) =>
      ipcRenderer.invoke("pi:tasks:move", request) as Promise<WorkspaceTask[]>,
    relink: (taskId: string) =>
      ipcRenderer.invoke("pi:tasks:relink", taskId) as Promise<WorkspaceTaskRelinkResult>,
    archive: (taskId: string) =>
      ipcRenderer.invoke("pi:tasks:archive", taskId) as Promise<PiTasksArchiveResult>,
    unarchive: (taskId: string) =>
      ipcRenderer.invoke("pi:tasks:unarchive", taskId) as Promise<PiTasksArchiveResult>,
  },
  session: {
    abort: () => ipcRenderer.invoke("pi:session:abort") as Promise<void>,
    create: (options?: PiSessionCreateOptions) =>
      ipcRenderer.invoke("pi:session:create", options) as Promise<PiSessionCreateResult>,
    dispose: () => ipcRenderer.invoke("pi:session:dispose") as Promise<void>,
    getState: () => ipcRenderer.invoke("pi:session:get-state") as Promise<PiHostState>,
    listModels: () => ipcRenderer.invoke("pi:session:list-models") as Promise<PiModelOption[]>,
    listThinkingLevels: () =>
      ipcRenderer.invoke("pi:session:list-thinking-levels") as Promise<PiThinkingLevel[]>,
    setModel: (request: { provider: string; modelId: string }) =>
      ipcRenderer.invoke("pi:session:set-model", request) as Promise<PiHostState>,
    setThinkingLevel: (level: PiThinkingLevel) =>
      ipcRenderer.invoke("pi:session:set-thinking-level", level) as Promise<PiHostState>,
    setAutoApprove: (unlocked: boolean) =>
      ipcRenderer.invoke("pi:session:set-auto-approve", unlocked) as Promise<{ unlocked: boolean }>,
    getAutoApprove: () =>
      ipcRenderer.invoke("pi:session:get-auto-approve") as Promise<{ unlocked: boolean }>,
    getTimeline: () =>
      ipcRenderer.invoke("pi:session:get-timeline") as Promise<PiTimelineSnapshot>,
    inspect: () =>
      ipcRenderer.invoke("pi:session:inspect") as Promise<PiSessionInspectResult>,
    navigate: (request: PiSessionNavigateRequest) =>
      ipcRenderer.invoke("pi:session:navigate", request) as Promise<PiSessionNavigateResult>,
    prepareBranchSummary: () =>
      ipcRenderer.invoke("pi:session:prepare-branch-summary") as Promise<PiPreparedBranchSummary>,
    getPreparedBranchSummary: () =>
      ipcRenderer.invoke(
        "pi:session:get-prepared-branch-summary",
      ) as Promise<PiPreparedBranchSummary | null>,
    clearPreparedBranchSummary: () =>
      ipcRenderer.invoke("pi:session:clear-prepared-branch-summary") as Promise<void>,
    exportSession: () =>
      ipcRenderer.invoke("pi:session:export") as Promise<PiSessionExportResult>,
    getPendingApproval: () =>
      ipcRenderer.invoke("pi:session:get-pending-approval") as Promise<PiToolApprovalRequest | null>,
    pickWorkspace: () =>
      ipcRenderer.invoke("pi:session:pick-workspace") as Promise<PiWorkspacePickResult>,
    onEvent(listener: (event: PiHostEvent) => void) {
      const handler = (_event: Electron.IpcRendererEvent, piEvent: PiHostEvent) => listener(piEvent);
      ipcRenderer.on("pi:session:event", handler);
      return () => ipcRenderer.off("pi:session:event", handler);
    },
    onToolApproval(listener: (request: PiToolApprovalRequest) => void) {
      const handler = (_event: Electron.IpcRendererEvent, request: PiToolApprovalRequest) =>
        listener(request);
      ipcRenderer.on("pi:session:tool-approval", handler);
      return () => ipcRenderer.off("pi:session:tool-approval", handler);
    },
    onHostExited(listener: (info: { code: number | null }) => void) {
      const handler = (_event: Electron.IpcRendererEvent, info: { code: number | null }) =>
        listener(info);
      ipcRenderer.on("pi:session:host-exited", handler);
      return () => ipcRenderer.off("pi:session:host-exited", handler);
    },
    replyToolApproval: (reply: PiToolApprovalReply) => {
      ipcRenderer.send("pi:session:tool-approval-reply", reply);
    },
    prompt: (text: string) =>
      ipcRenderer.invoke("pi:session:prompt", text) as Promise<PiPromptResult>,
    continueTurn: () =>
      ipcRenderer.invoke("pi:session:continue") as Promise<PiPromptResult>,
  },
  preferences: {
    updateApp: (patch: AppPreferencesUpdate) =>
      ipcRenderer.invoke("preferences:update-app", patch) as Promise<AppPreferences>,
    getWorkspace: (cwd: string) =>
      ipcRenderer.invoke("preferences:get-workspace", cwd) as Promise<WorkspacePreferences>,
    updateWorkspace: (cwd: string, patch: WorkspacePreferencesUpdate) =>
      ipcRenderer.invoke("preferences:update-workspace", cwd, patch) as Promise<WorkspacePreferences>,
    getDraft: (taskId: string) =>
      ipcRenderer.invoke("preferences:get-draft", taskId) as Promise<string>,
    saveDraft: (taskId: string, draft: string) =>
      ipcRenderer.invoke("preferences:save-draft", taskId, draft) as Promise<void>,
    getReviewedPaths: (request: ReviewedFilesRequest) =>
      ipcRenderer.invoke("preferences:get-reviewed", request) as Promise<string[]>,
    setReviewedFile: (request: ReviewedFileUpdate) =>
      ipcRenderer.invoke("preferences:set-reviewed", request) as Promise<void>,
    clearReviewedFile: (request: Omit<ReviewedFileUpdate, "fingerprint">) =>
      ipcRenderer.invoke("preferences:clear-reviewed", request) as Promise<void>,
  },
  skills: {
    personalDir: () => ipcRenderer.invoke("skills:personal-dir") as Promise<{ dir: string }>,
    writePersonal: (request: PersonalSkillWriteRequest) =>
      ipcRenderer.invoke("skills:write-personal", request) as Promise<PersonalSkillWriteResult>,
  },
  usage: {
    providerQuotas: (force?: boolean) =>
      ipcRenderer.invoke("usage:provider-quotas", force) as Promise<ProviderQuotaSnapshot[]>,
  },
  workspace: {
    list: (request: WorkspaceListRequest) =>
      ipcRenderer.invoke("workspace:list", request) as Promise<WorkspaceListResult>,
    git: (request: string | WorkspaceGitRequest) =>
      ipcRenderer.invoke("workspace:git", request) as Promise<WorkspaceGitSnapshot>,
    gitDiscard: (request: WorkspaceGitDiscardRequest) =>
      ipcRenderer.invoke("workspace:git-discard", request) as Promise<WorkspaceGitDiscardResult>,
    openReview: (request: WorkspaceOpenReviewRequest) =>
      ipcRenderer.invoke("workspace:open-review", request) as Promise<{ ok: true }>,
    closeReview: () => ipcRenderer.invoke("workspace:close-review") as Promise<{ ok: true }>,
    installMattSkills: (request: WorkspaceInstallMattSkillsRequest) =>
      ipcRenderer.invoke(
        "workspace:install-matt-skills",
        request,
      ) as Promise<WorkspaceInstallMattSkillsResult>,
    mattSkillsStatus: (request: WorkspaceMattSkillsStatusRequest) =>
      ipcRenderer.invoke(
        "workspace:matt-skills-status",
        request,
      ) as Promise<WorkspaceMattSkillsStatus>,
  },
};

contextBridge.exposeInMainWorld("piDesktop", api);

export type PiDesktopApi = typeof api;
