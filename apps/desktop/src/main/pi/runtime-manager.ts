import { randomUUID } from "node:crypto";
import type {
  PiHostEvent,
  PiHostState,
  PiModelOption,
  PiThinkingLevel,
  PiTurnResult,
} from "@pi-3.14/model";
import { readPiSessionFile } from "@pi-3.14/session/node";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  utilityProcess,
  type WebContents,
} from "electron";
import type { OpenDialogOptions } from "electron";
import hostModulePath from "./host-process?modulePath";
import type {
  PiActivateTaskResult,
  PiHostCommand,
  PiHostProcessMessage,
  PiPromptResult,
  PiSessionCreateOptions,
  PiSessionCreateResult,
  PiTasksBootstrap,
  PiTimelineSnapshot,
  PiToolApprovalReply,
  PiToolApprovalRequest,
  PiWorkspacePickResult,
  TaskWorkflow,
  WorkspaceTask,
} from "../../shared/desktop-contracts";
import { projectSessionToTimeline } from "../../shared/project-timeline";
import { TaskStore, taskStorePath } from "./task-store";

const EMPTY_TIMELINE: PiTimelineSnapshot = { leafEntryId: null, items: [] };
const APPROVAL_TIMEOUT_MS = 120_000;
const CHILD_START_TIMEOUT_MS = 30_000;

type PiUtilityProcess = ReturnType<typeof utilityProcess.fork>;

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

/**
 * Owns the PI session for the desktop window and the persisted task catalog.
 *
 * PI EmbeddedPiHost runs in a utilityProcess (host-process). Main keeps dialogs,
 * task persistence, JSONL timeline projection, and renderer IPC.
 */
export class PiRuntimeManager {
  private readonly tasks = new TaskStore(taskStorePath(app.getPath("userData")));
  private cwd: string | null = null;
  private activeTaskId: string | null = null;
  private subscribedWebContents: WebContents | null = null;
  private hostBound = false;
  private child: PiUtilityProcess | null = null;
  private childReady = false;
  private startingChild: Promise<void> | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly pendingApprovals = new Map<
    string,
    { resolve: (reply: PiToolApprovalReply) => void; timer: NodeJS.Timeout }
  >();
  /** Latest approval still waiting on the UI (survives renderer HMR remounts). */
  private activeApprovalRequest: PiToolApprovalRequest | null = null;

  constructor() {
    // Renderer → main: resolve the in-flight approval promise for the host bridge.
    ipcMain.on("pi:session:tool-approval-reply", (_event, reply: PiToolApprovalReply) => {
      const pending = this.pendingApprovals.get(reply.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pendingApprovals.delete(reply.id);
      if (this.activeApprovalRequest?.id === reply.id) {
        this.activeApprovalRequest = null;
      }
      pending.resolve(reply);
    });
  }

  async bootstrap(): Promise<PiTasksBootstrap> {
    const tasks = await this.tasks.list();
    const selectedTaskId = await this.tasks.getSelectedId();
    return { tasks, selectedTaskId };
  }

  async pickWorkspace(sender: WebContents): Promise<PiWorkspacePickResult> {
    const cwd = await this.chooseWorkspace(sender);
    if (!cwd) return { cancelled: true };
    this.cwd = cwd;
    return { cancelled: false, cwd };
  }

  async createSession(
    sender: WebContents,
    options: PiSessionCreateOptions = {},
  ): Promise<PiSessionCreateResult> {
    const cwd = options.cwd ?? this.cwd ?? (await this.chooseWorkspace(sender));
    if (!cwd) return { cancelled: true };

    this.subscribedWebContents = sender;
    this.cwd = cwd;

    const sessionPath =
      options.sessionPath && (await fileExists(options.sessionPath))
        ? options.sessionPath
        : null;

    const state = await this.bindHost({ cwd, sessionPath });
    const timeline = await this.readTimelineSnapshot(state.sessionPath);

    const task =
      options.taskId != null
        ? await this.tasks.update(options.taskId, {
            cwd,
            sessionPath: state.sessionPath,
            sessionId: state.sessionId,
            status: "idle",
          })
        : await this.tasks.create({
            cwd,
            sessionPath: state.sessionPath,
            sessionId: state.sessionId,
            title: folderTitle(cwd),
          });

    if (!task) throw new Error("Failed to persist workspace task");
    this.activeTaskId = task.id;
    await this.tasks.select(task.id);

    return { cancelled: false, cwd, state, timeline, task };
  }

  async activateTask(sender: WebContents, taskId: string): Promise<PiActivateTaskResult> {
    const task = await this.tasks.get(taskId);
    if (!task) throw new Error(`Unknown task: ${taskId}`);

    this.subscribedWebContents = sender;

    // Same task already bound: do not abort — renderer HMR / focus remounts hit this path
    // and used to kill in-flight edit approvals.
    if (this.activeTaskId === taskId && this.hostBound && this.childReady) {
      const state = await this.getState();
      const timeline = await this.readTimelineSnapshot(state.sessionPath);
      this.reshowPendingApproval();
      return { task, state, timeline };
    }

    await this.abort().catch(() => {});

    const sessionPath =
      task.sessionPath && (await fileExists(task.sessionPath)) ? task.sessionPath : null;
    const state = await this.bindHost({ cwd: task.cwd, sessionPath });
    const timeline = await this.readTimelineSnapshot(state.sessionPath);
    const updated =
      (await this.tasks.update(
        task.id,
        {
          sessionPath: state.sessionPath,
          sessionId: state.sessionId,
          status: "idle",
        },
        { touchUpdatedAt: false },
      )) ?? task;

    this.activeTaskId = updated.id;
    this.cwd = updated.cwd;
    await this.tasks.select(updated.id);

    return { task: updated, state, timeline };
  }

  getPendingApproval(): PiToolApprovalRequest | null {
    return this.activeApprovalRequest;
  }

  async prompt(sender: WebContents, text: string): Promise<PiPromptResult> {
    this.subscribedWebContents = sender;
    this.assertHostBound();
    if (this.activeTaskId) {
      await this.tasks.setStatus(this.activeTaskId, "running");
    }

    try {
      const result = (await this.send({
        id: randomUUID(),
        type: "prompt",
        text,
      })) as PiTurnResult;
      const timeline = await this.readTimelineSnapshot(result.sessionPath);
      const title = this.activeTaskId
        ? await this.maybeTitleFromPrompt(this.activeTaskId, text, timeline)
        : undefined;
      const task = this.activeTaskId
        ? await this.tasks.update(
            this.activeTaskId,
            {
              sessionPath: result.sessionPath,
              sessionId: result.sessionId,
              status: result.stopReason === "error" ? "error" : "done",
              ...(title ? { title } : {}),
            },
            { moveToFront: true },
          )
        : null;

      return { ...result, timeline, task };
    } catch (error) {
      if (this.activeTaskId) {
        await this.tasks.setStatus(this.activeTaskId, "error");
      }
      throw error;
    }
  }

  async abort(): Promise<void> {
    this.rejectAllApprovals("Aborted");
    if (!this.child || !this.hostBound) return;
    await this.send({ id: randomUUID(), type: "abort" }).catch(() => {});
    if (this.activeTaskId) {
      await this.tasks.setStatus(this.activeTaskId, "idle");
    }
  }

  async getState(): Promise<PiHostState> {
    this.assertHostBound();
    return (await this.send({ id: randomUUID(), type: "get_state" })) as PiHostState;
  }

  async listModels(): Promise<PiModelOption[]> {
    this.assertHostBound();
    return (await this.send({ id: randomUUID(), type: "list_models" })) as PiModelOption[];
  }

  async listThinkingLevels(): Promise<PiThinkingLevel[]> {
    this.assertHostBound();
    return (await this.send({
      id: randomUUID(),
      type: "list_thinking_levels",
    })) as PiThinkingLevel[];
  }

  async setModel(provider: string, modelId: string): Promise<PiHostState> {
    this.assertHostBound();
    return (await this.send({
      id: randomUUID(),
      type: "set_model",
      provider,
      modelId,
    })) as PiHostState;
  }

  async setThinkingLevel(level: PiThinkingLevel): Promise<PiHostState> {
    this.assertHostBound();
    return (await this.send({
      id: randomUUID(),
      type: "set_thinking_level",
      level,
    })) as PiHostState;
  }

  async getTimeline(): Promise<PiTimelineSnapshot> {
    const state = await this.getState();
    return this.readTimelineSnapshot(state.sessionPath);
  }

  async listTasks(): Promise<WorkspaceTask[]> {
    return this.tasks.list();
  }

  async updateTask(
    id: string,
    patch: { workflow?: TaskWorkflow | null },
  ): Promise<WorkspaceTask | null> {
    return this.tasks.update(id, patch);
  }

  async dispose(): Promise<void> {
    this.rejectAllApprovals("Session disposed");
    if (this.child && this.childReady) {
      await this.send({ id: randomUUID(), type: "dispose" }).catch(() => {});
    }
    this.killChild();
    this.subscribedWebContents = null;
    this.activeTaskId = null;
    this.hostBound = false;
  }

  get currentCwd(): string | null {
    return this.cwd;
  }

  private async bindHost(options: {
    cwd: string;
    sessionPath: string | null;
  }): Promise<PiHostState> {
    await this.ensureChild();
    const state = (await this.send({
      id: randomUUID(),
      type: "create",
      cwd: options.cwd,
      sessionPath: options.sessionPath,
    })) as PiHostState;
    this.hostBound = true;
    this.cwd = options.cwd;
    return state;
  }

  private async ensureChild(): Promise<void> {
    if (this.child && this.childReady) return;
    if (this.startingChild) {
      await this.startingChild;
      return;
    }
    this.startingChild = this.spawnChild();
    try {
      await this.startingChild;
    } finally {
      this.startingChild = null;
    }
  }

  private async spawnChild(): Promise<void> {
    this.killChild();

    const child = utilityProcess.fork(hostModulePath, [], {
      serviceName: "pie-pi-host",
      stdio: "pipe",
    });
    this.child = child;

    child.stdout?.on("data", (chunk) => {
      console.log(`[pi-host] ${String(chunk).trimEnd()}`);
    });
    child.stderr?.on("data", (chunk) => {
      console.error(`[pi-host] ${String(chunk).trimEnd()}`);
    });

    child.on("message", (message) => {
      this.onChildMessage(message as PiHostProcessMessage);
    });

    child.on("exit", (code) => {
      console.error(`[pi-host] exited with code ${code ?? "null"}`);
      this.childReady = false;
      this.hostBound = false;
      this.child = null;
      for (const [, pending] of this.pending) {
        pending.reject(new Error("PI host process exited"));
      }
      this.pending.clear();
      this.rejectAllApprovals("PI host process exited");
      if (this.subscribedWebContents && !this.subscribedWebContents.isDestroyed()) {
        this.subscribedWebContents.send("pi:session:host-exited", {
          code: code ?? null,
        });
      }
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("PI host process failed to become ready"));
        this.killChild();
      }, CHILD_START_TIMEOUT_MS);

      const onMessage = (message: PiHostProcessMessage) => {
        if (message && typeof message === "object" && "type" in message && message.type === "ready") {
          clearTimeout(timer);
          child.off("message", onReadyListener);
          this.childReady = true;
          resolve();
        }
      };
      const onReadyListener = (message: unknown) => onMessage(message as PiHostProcessMessage);
      child.on("message", onReadyListener);

      child.on("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`PI host process exited during start (${code ?? "null"})`));
      });
    });
  }

  private onChildMessage(message: PiHostProcessMessage): void {
    if (!message || typeof message !== "object") return;

    if ("type" in message && message.type === "ready") {
      this.childReady = true;
      return;
    }

    if ("type" in message && message.type === "event") {
      this.forwardEvent(message.event);
      return;
    }

    if ("type" in message && message.type === "tool_approval") {
      console.log(
        `[pi-runtime] tool approval requested: ${message.toolName} (${message.approvalId})`,
      );
      void this.handleChildApprovalRequest(message);
      return;
    }

    if ("id" in message && "ok" in message) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.ok) pending.resolve(message.result);
      else pending.reject(new Error(message.errorMessage));
    }
  }

  private async handleChildApprovalRequest(message: {
    approvalId: string;
    toolCallId: string;
    toolName: string;
    args: import("@pi-3.14/model").JsonValue;
  }): Promise<void> {
    const decision = await this.requestToolApprovalFromRenderer({
      id: message.approvalId,
      toolCallId: message.toolCallId,
      toolName: message.toolName,
      args: message.args,
    });
    this.post({
      id: randomUUID(),
      type: "tool_approval_reply",
      approvalId: message.approvalId,
      approved: decision.approved,
      ...(decision.reason ? { reason: decision.reason } : {}),
    });
  }

  private async requestToolApprovalFromRenderer(
    request: PiToolApprovalRequest,
  ): Promise<{ approved: boolean; reason?: string }> {
    const webContents = this.subscribedWebContents;
    if (!webContents || webContents.isDestroyed()) {
      console.error("[pi-runtime] no window for tool approval; denying");
      return { approved: false, reason: "No interactive window for tool approval" };
    }

    this.activeApprovalRequest = request;
    const reply = await new Promise<PiToolApprovalReply>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingApprovals.delete(request.id);
        if (this.activeApprovalRequest?.id === request.id) {
          this.activeApprovalRequest = null;
        }
        resolve({ id: request.id, approved: false, reason: "Tool approval timed out" });
      }, APPROVAL_TIMEOUT_MS);
      this.pendingApprovals.set(request.id, { resolve, timer });
      try {
        webContents.send("pi:session:tool-approval", request);
      } catch (error) {
        clearTimeout(timer);
        this.pendingApprovals.delete(request.id);
        if (this.activeApprovalRequest?.id === request.id) {
          this.activeApprovalRequest = null;
        }
        resolve({
          id: request.id,
          approved: false,
          reason: error instanceof Error ? error.message : "Failed to present tool approval",
        });
      }
    });

    return {
      approved: reply.approved === true,
      ...(reply.reason ? { reason: reply.reason } : {}),
    };
  }

  private reshowPendingApproval(): void {
    const request = this.activeApprovalRequest;
    const webContents = this.subscribedWebContents;
    if (!request || !webContents || webContents.isDestroyed()) return;
    webContents.send("pi:session:tool-approval", request);
  }

  private post(command: PiHostCommand): void {
    if (!this.child || !this.childReady) {
      throw new Error("PI host process is not ready");
    }
    this.child.postMessage(command);
  }

  private send(command: PiHostCommand): Promise<unknown> {
    if (!this.child || !this.childReady) {
      return Promise.reject(new Error("PI host process is not ready"));
    }
    return new Promise((resolve, reject) => {
      this.pending.set(command.id, { resolve, reject });
      try {
        this.child!.postMessage(command);
      } catch (error) {
        this.pending.delete(command.id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private killChild(): void {
    if (this.child) {
      try {
        this.child.kill();
      } catch {
        // ignore
      }
    }
    this.child = null;
    this.childReady = false;
    this.hostBound = false;
    for (const [, pending] of this.pending) {
      pending.reject(new Error("PI host process stopped"));
    }
    this.pending.clear();
  }

  private rejectAllApprovals(reason: string): void {
    for (const [id, pending] of this.pendingApprovals) {
      clearTimeout(pending.timer);
      pending.resolve({ id, approved: false, reason });
    }
    this.pendingApprovals.clear();
    this.activeApprovalRequest = null;
  }

  private assertHostBound(): void {
    if (!this.hostBound || !this.childReady) {
      throw new Error("PI session has not been created");
    }
  }

  private async maybeTitleFromPrompt(
    taskId: string,
    prompt: string,
    timeline: PiTimelineSnapshot,
  ): Promise<string | undefined> {
    const existing = await this.tasks.get(taskId);
    if (!existing) return undefined;
    if (!existing.title.startsWith("New task")) return undefined;
    const firstUser = timeline.items.find((item) => item.kind === "user")?.text ?? prompt;
    const title = firstUser.replace(/\s+/g, " ").trim().slice(0, 72);
    return title || undefined;
  }

  private async readTimelineSnapshot(sessionPath: string | null): Promise<PiTimelineSnapshot> {
    if (!sessionPath) return EMPTY_TIMELINE;
    try {
      const snapshot = await readPiSessionFile(sessionPath);
      return projectSessionToTimeline(snapshot);
    } catch {
      return EMPTY_TIMELINE;
    }
  }

  private async chooseWorkspace(sender: WebContents): Promise<string | null> {
    const window = BrowserWindow.fromWebContents(sender) ?? undefined;
    const options: OpenDialogOptions = {
      buttonLabel: "Use Workspace",
      defaultPath: this.cwd ?? undefined,
      message: "Choose a workspace for this PI session",
      properties: ["openDirectory"],
      title: "Choose workspace",
    };
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? null : result.filePaths[0] ?? null;
  }

  private forwardEvent(event: PiHostEvent): void {
    if (this.subscribedWebContents?.isDestroyed()) {
      this.subscribedWebContents = null;
      return;
    }
    this.subscribedWebContents?.send("pi:session:event", event);
  }
}

function folderTitle(cwd: string): string {
  const name = cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? cwd;
  return `New task · ${name}`;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const { access } = await import("node:fs/promises");
    await access(path);
    return true;
  } catch {
    return false;
  }
}
