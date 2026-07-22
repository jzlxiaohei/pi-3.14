import { contextBridge, ipcRenderer } from "electron";
import type { PiHostEvent, PiHostState } from "@pi-3.14/model";
import type {
  PiActivateTaskResult,
  PiPromptResult,
  PiSessionCreateOptions,
  PiSessionCreateResult,
  PiTasksBootstrap,
  PiTimelineSnapshot,
  PiToolApprovalReply,
  PiToolApprovalRequest,
  PiWorkspacePickResult,
  WorkspaceGitDiscardRequest,
  WorkspaceGitDiscardResult,
  WorkspaceGitRequest,
  WorkspaceGitSnapshot,
  WorkspaceListRequest,
  WorkspaceListResult,
  WorkspaceOpenReviewRequest,
  WorkspaceTask,
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
  },
  session: {
    abort: () => ipcRenderer.invoke("pi:session:abort") as Promise<void>,
    create: (options?: PiSessionCreateOptions) =>
      ipcRenderer.invoke("pi:session:create", options) as Promise<PiSessionCreateResult>,
    dispose: () => ipcRenderer.invoke("pi:session:dispose") as Promise<void>,
    getState: () => ipcRenderer.invoke("pi:session:get-state") as Promise<PiHostState>,
    getTimeline: () =>
      ipcRenderer.invoke("pi:session:get-timeline") as Promise<PiTimelineSnapshot>,
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
  },
};

contextBridge.exposeInMainWorld("piDesktop", api);

export type PiDesktopApi = typeof api;
