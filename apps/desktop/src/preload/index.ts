import { contextBridge, ipcRenderer } from "electron";
import type { PiHostEvent, PiHostState, PiModelOption, PiThinkingLevel } from "@pi-3.14/model";
import type {
  PiActivateTaskResult,
  PiPromptResult,
  PiSessionCreateOptions,
  PiSessionCreateResult,
  PiSessionExportResult,
  PiTasksBootstrap,
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
  WorkspaceTask,
  WorkspaceTaskUpdate,
} from "../shared/desktop-contracts";

export type DesktopAppInfo = {
  name: string;
  version: string;
  platform: NodeJS.Platform;
};

const api = {
  getAppInfo: () => ipcRenderer.invoke("app:get-info") as Promise<DesktopAppInfo>,
  tasks: {
    bootstrap: () => ipcRenderer.invoke("pi:tasks:bootstrap") as Promise<PiTasksBootstrap>,
    list: () => ipcRenderer.invoke("pi:tasks:list") as Promise<WorkspaceTask[]>,
    activate: (taskId: string) =>
      ipcRenderer.invoke("pi:tasks:activate", taskId) as Promise<PiActivateTaskResult>,
    update: (request: WorkspaceTaskUpdate) =>
      ipcRenderer.invoke("pi:tasks:update", request) as Promise<WorkspaceTask | null>,
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
    getTimeline: () =>
      ipcRenderer.invoke("pi:session:get-timeline") as Promise<PiTimelineSnapshot>,
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
  },
  skills: {
    personalDir: () => ipcRenderer.invoke("skills:personal-dir") as Promise<{ dir: string }>,
    writePersonal: (request: PersonalSkillWriteRequest) =>
      ipcRenderer.invoke("skills:write-personal", request) as Promise<PersonalSkillWriteResult>,
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
