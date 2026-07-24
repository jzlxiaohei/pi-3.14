import { randomUUID } from "node:crypto";
import { copyFile } from "node:fs/promises";
import { basename } from "node:path";
import type {
  PiHostEvent,
  PiHostState,
  PiLiveInspectSnapshot,
  PiModelOption,
  PiNavigateTreeResult,
  PiPreparedBranchSummary,
  PiThinkingLevel,
  PiTurnResult,
} from "@pi-3.14/model";
import { analyzePiSession, buildPiContextProjection } from "@pi-3.14/session";
import { readPiSessionFile } from "@pi-3.14/session/node";
import {
  BrowserWindow,
  dialog,
  ipcMain,
  utilityProcess,
  type WebContents,
} from "electron";
import type { OpenDialogOptions, SaveDialogOptions } from "electron";
import hostModulePath from "./host-process?modulePath";
import type {
  PiActivateTaskResult,
  PiBranchFlowGraph,
  PiBranchSpineView,
  PiHostCommand,
  PiHostProcessMessage,
  PiPromptResult,
  PiSessionCreateOptions,
  PiSessionCreateResult,
  PiSessionExportResult,
  PiSessionInspectResult,
  PiSessionNavigateRequest,
  PiSessionNavigateResult,
  PiTasksBootstrap,
  PiTimelineSnapshot,
  PiToolApprovalReply,
  PiToolApprovalRequest,
  PiWorkspacePickResult,
  TaskWorkflow,
  WorkspaceTask,
} from "../../shared/desktop-contracts";
import {
  buildBranchFlowGraph,
  buildBranchSpineView,
  buildBranchTree,
} from "../../shared/branch-tree";
import { projectSessionToTimeline } from "../../shared/project-timeline";
import { snapshotAtLeaf } from "../../shared/session-leaf";
import type { LegacyPanelPreferences } from "../../shared/desktop-contracts";
import type { PieStore } from "../persistence/pie-store";

const EMPTY_TIMELINE: PiTimelineSnapshot = { leafEntryId: null, items: [] };
const EMPTY_BRANCH_SPINE: PiBranchSpineView = {
  spine: [],
  otherRoots: [],
  forkPoint: null,
};
const EMPTY_BRANCH_FLOW: PiBranchFlowGraph = {
  nodes: [],
  edges: [],
  forkPoint: null,
};
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

  constructor(private readonly tasks: PieStore) {
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

  async bootstrap(legacyPanelPreferences?: LegacyPanelPreferences): Promise<PiTasksBootstrap> {
    const legacyBrowserPreferencesImported =
      await this.tasks.importLegacyBrowserPreferences(legacyPanelPreferences);
    const boot = await this.tasks.bootstrap();
    return { ...boot, legacyBrowserPreferencesImported };
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

    const existing =
      options.taskId != null ? await this.tasks.get(options.taskId) : null;
    const parentTaskId = options.parentTaskId ?? null;
    if (parentTaskId) {
      const parent = await this.tasks.get(parentTaskId);
      if (!parent) throw new Error(`Unknown parent task: ${parentTaskId}`);
      if (parent.cwd !== cwd) {
        throw new Error("Child task cwd must match parent workspace");
      }
    }
    const state = await this.bindHost({
      cwd,
      sessionPath,
      ignoredSkillNames: existing?.ignoredSkillNames,
      appendSystemPrompts: options.appendSystemPrompts,
    });
    const timeline = await this.readTimelineSnapshot(state.sessionPath, state.leafEntryId);

    if (!state.sessionPath || !state.sessionId) {
      await this.dispose();
      throw new Error("PI did not create a persisted Session for this Task");
    }
    let task: WorkspaceTask | null;
    try {
      task =
        options.taskId != null
          ? await this.tasks.update(options.taskId, {
              cwd,
              sessionPath: state.sessionPath,
              sessionId: state.sessionId,
              status: "idle",
              ...(options.title?.trim() ? { title: options.title.trim() } : {}),
            })
          : await this.tasks.create({
              cwd,
              sessionPath: state.sessionPath,
              sessionId: state.sessionId,
              title: options.title?.trim() || folderTitle(cwd),
              parentTaskId,
            });
    } catch (error) {
      await this.dispose();
      throw error;
    }

    if (!task) throw new Error("Failed to persist workspace task");
    this.activeTaskId = task.id;
    await this.tasks.setActiveTask(task.id);

    return { cancelled: false, cwd, state, timeline, task };
  }

  async activateTask(
    sender: WebContents,
    taskId: string,
    options?: { force?: boolean },
  ): Promise<PiActivateTaskResult> {
    const task = await this.tasks.get(taskId);
    if (!task) throw new Error(`Unknown task: ${taskId}`);

    this.subscribedWebContents = sender;

    // Same task already bound: do not abort — renderer HMR / focus remounts hit this path
    // and used to kill in-flight edit approvals. Pass force to reload resources (skills).
    if (
      !options?.force &&
      this.activeTaskId === taskId &&
      this.hostBound &&
      this.childReady
    ) {
      const state = await this.getState();
      const timeline = await this.readTimelineSnapshot(state.sessionPath, state.leafEntryId);
      this.reshowPendingApproval();
      return { ok: true, task, state, timeline };
    }

    await this.abort().catch(() => { });

    const appendSystemPrompts = await this.rolePromptsForTask(task);
    // PI often delays writing the JSONL until the first assistant message, so a
    // brand-new Task can have sessionPath + sessionId but no file yet. Resume
    // only when the file exists; otherwise open a fresh session and persist paths.
    const resumePath =
      task.sessionPath && task.sessionAvailability === "available" ? task.sessionPath : null;
    if (task.sessionPath && !resumePath && task.sessionAvailability === "missing") {
      // Truly missing (deleted file after use) vs not-yet-flushed: both get a new
      // session bind. UI can still relink if the user finds the old file later.
      console.warn(
        `[pi-runtime] session file missing for task ${task.id}; binding a new session`,
        task.sessionPath,
      );
    }

    const state = await this.bindHost({
      cwd: task.cwd,
      sessionPath: resumePath,
      appendSystemPrompts,
      ignoredSkillNames: task.ignoredSkillNames,
    });
    const timeline = await this.readTimelineSnapshot(state.sessionPath, state.leafEntryId);
    const updated =
      (await this.tasks.update(
        task.id,
        {
          sessionPath: state.sessionPath,
          sessionId: state.sessionId,
        },
        { touchUpdatedAt: false },
      )) ?? task;

    this.activeTaskId = updated.id;
    this.cwd = updated.cwd;
    await this.tasks.setActiveTask(updated.id);

    return { ok: true, task: updated, state, timeline };
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

    let result: PiTurnResult;
    try {
      result = (await this.send({
        id: randomUUID(),
        type: "prompt",
        text,
      })) as PiTurnResult;
    } catch (error) {
      if (this.activeTaskId) await this.tasks.setStatus(this.activeTaskId, "error");
      throw error;
    }

    const timeline = await this.readTimelineSnapshot(result.sessionPath, result.leafEntryId);
    let title: string | undefined;
    if (this.activeTaskId) {
      try {
        title = await this.maybeTitleFromPrompt(this.activeTaskId, text, timeline);
      } catch {
        title = undefined;
      }
    }
    const task = this.activeTaskId
      ? await this.tasks.update(this.activeTaskId, {
          sessionPath: result.sessionPath,
          sessionId: result.sessionId,
          status: result.stopReason === "error" ? "error" : "done",
          ...(title ? { title } : {}),
        })
      : null;

    return { ...result, timeline, task };
  }

  /** Retry generation from the current leaf without appending a new user message. */
  async continueTurn(sender: WebContents): Promise<PiPromptResult> {
    this.subscribedWebContents = sender;
    this.assertHostBound();
    if (this.activeTaskId) {
      await this.tasks.setStatus(this.activeTaskId, "running");
    }

    let result: PiTurnResult;
    try {
      result = (await this.send({
        id: randomUUID(),
        type: "continue_turn",
      })) as PiTurnResult;
    } catch (error) {
      if (this.activeTaskId) await this.tasks.setStatus(this.activeTaskId, "error");
      throw error;
    }
    const timeline = await this.readTimelineSnapshot(result.sessionPath, result.leafEntryId);
    const task = this.activeTaskId
      ? await this.tasks.update(this.activeTaskId, {
          sessionPath: result.sessionPath,
          sessionId: result.sessionId,
          status: result.stopReason === "error" ? "error" : "done",
        })
      : null;

    return { ...result, timeline, task };
  }

  async abort(): Promise<void> {
    this.rejectAllApprovals("Aborted");
    if (!this.child || !this.hostBound) return;
    await this.send({ id: randomUUID(), type: "abort" }).catch(() => { });
    if (this.activeTaskId) this.tasks.idleIfRunning(this.activeTaskId);
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

  async setAutoApprove(unlocked: boolean): Promise<{ unlocked: boolean }> {
    this.assertHostBound();
    return (await this.send({
      id: randomUUID(),
      type: "set_auto_approve",
      unlocked,
    })) as { unlocked: boolean };
  }

  async getAutoApprove(): Promise<{ unlocked: boolean }> {
    this.assertHostBound();
    return (await this.send({
      id: randomUUID(),
      type: "get_auto_approve",
    })) as { unlocked: boolean };
  }

  /** Copy the active session JSONL via a Save dialog (local share / backup). */
  async exportSession(sender: WebContents): Promise<PiSessionExportResult> {
    let sessionPath: string | null = null;
    if (this.activeTaskId) {
      const task = await this.tasks.get(this.activeTaskId);
      sessionPath = task?.sessionPath ?? null;
    }
    if (!sessionPath && this.hostBound && this.childReady) {
      try {
        sessionPath = (await this.getState()).sessionPath;
      } catch {
        sessionPath = null;
      }
    }
    if (!sessionPath || !(await fileExists(sessionPath))) {
      return { ok: false, error: "还没有可导出的 session 文件（先发一条消息生成会话）" };
    }

    const window = BrowserWindow.fromWebContents(sender) ?? undefined;
    const options: SaveDialogOptions = {
      title: "导出 session",
      buttonLabel: "导出",
      defaultPath: basename(sessionPath),
      filters: [{ name: "PI Session", extensions: ["jsonl"] }],
    };
    const pick = window
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options);
    if (pick.canceled || !pick.filePath) return { ok: false, cancelled: true };

    const dest = pick.filePath.endsWith(".jsonl") ? pick.filePath : `${pick.filePath}.jsonl`;
    await copyFile(sessionPath, dest);
    return { ok: true, path: dest };
  }

  async getTimeline(): Promise<PiTimelineSnapshot> {
    const state = await this.getState();
    return this.readTimelineSnapshot(state.sessionPath, state.leafEntryId);
  }

  async inspectSession(): Promise<PiSessionInspectResult> {
    this.assertHostBound();
    let live: PiLiveInspectSnapshot | null = null;
    let sessionPath: string | null = null;
    let leafEntryId: string | null = null;
    try {
      live = (await this.send({
        id: randomUUID(),
        type: "inspect_live",
      })) as PiLiveInspectSnapshot;
      const state = await this.getState();
      sessionPath = state.sessionPath;
      leafEntryId = state.leafEntryId;
    } catch {
      live = null;
    }

    if (!sessionPath && this.activeTaskId) {
      sessionPath = (await this.tasks.get(this.activeTaskId))?.sessionPath ?? null;
    }

    if (!sessionPath || !(await fileExists(sessionPath))) {
      return {
        sessionPath,
        leafEntryId,
        live,
        analysis: null,
        context: null,
        branchTree: [],
        branchSpine: EMPTY_BRANCH_SPINE,
        branchFlow: EMPTY_BRANCH_FLOW,
      };
    }

    try {
      const fileSnapshot = await readPiSessionFile(sessionPath);
      const snapshot = snapshotAtLeaf(fileSnapshot, leafEntryId ?? fileSnapshot.leafId);
      return {
        sessionPath,
        leafEntryId: snapshot.leafId,
        live,
        analysis: analyzePiSession(snapshot),
        context: buildPiContextProjection(snapshot, snapshot.leafId),
        branchTree: buildBranchTree(snapshot),
        branchSpine: buildBranchSpineView(snapshot),
        branchFlow: buildBranchFlowGraph(snapshot),
      };
    } catch {
      return {
        sessionPath,
        leafEntryId,
        live,
        analysis: null,
        context: null,
        branchTree: [],
        branchSpine: EMPTY_BRANCH_SPINE,
        branchFlow: EMPTY_BRANCH_FLOW,
      };
    }
  }

  /**
   * Navigate the in-file session tree. Optionally prompt after navigate (edit/branch).
   * Aborts an in-flight turn first.
   */
  async navigateSession(
    sender: WebContents,
    request: PiSessionNavigateRequest,
  ): Promise<PiSessionNavigateResult> {
    this.subscribedWebContents = sender;
    this.assertHostBound();
    this.rejectAllApprovals("Navigating session tree");
    await this.send({ id: randomUUID(), type: "abort" }).catch(() => {});

    const nav = (await this.send({
      id: randomUUID(),
      type: "navigate_tree",
      entryId: request.entryId,
      summarize: request.summarize ?? false,
    })) as PiNavigateTreeResult;

    const state = await this.getState();
    const timeline = await this.readTimelineSnapshot(state.sessionPath, state.leafEntryId);
    if (this.activeTaskId) {
      await this.tasks.update(this.activeTaskId, {
        sessionPath: state.sessionPath,
        sessionId: state.sessionId,
      });
    }

    if (nav.cancelled || !request.promptText?.trim()) {
      return {
        ...nav,
        timeline,
        sessionPath: state.sessionPath,
        leafEntryId: state.leafEntryId,
      };
    }

    const prompt = await this.prompt(sender, request.promptText.trim());
    return {
      ...nav,
      timeline: prompt.timeline,
      sessionPath: prompt.sessionPath,
      leafEntryId: prompt.leafEntryId,
      prompt,
    };
  }

  async prepareBranchSummary(): Promise<PiPreparedBranchSummary> {
    this.assertHostBound();
    return (await this.send({
      id: randomUUID(),
      type: "prepare_branch_summary",
    })) as PiPreparedBranchSummary;
  }

  async getPreparedBranchSummary(): Promise<PiPreparedBranchSummary | null> {
    if (!this.hostBound || !this.childReady) return null;
    return (await this.send({
      id: randomUUID(),
      type: "get_prepared_branch_summary",
    })) as PiPreparedBranchSummary | null;
  }

  async clearPreparedBranchSummary(): Promise<void> {
    if (!this.hostBound || !this.childReady) return;
    await this.send({ id: randomUUID(), type: "clear_prepared_branch_summary" });
  }

  async listTasks(): Promise<WorkspaceTask[]> {
    return this.tasks.listRootTasks();
  }

  async moveTask(request: import("../../shared/desktop-contracts").WorkspaceTaskMoveRequest) {
    return this.tasks.moveRootTask(request);
  }

  async relinkTaskSession(
    sender: WebContents,
    taskId: string,
  ): Promise<import("../../shared/desktop-contracts").WorkspaceTaskRelinkResult> {
    const task = await this.tasks.get(taskId);
    if (!task) return { ok: false, error: `Unknown task: ${taskId}` };
    if (!task.sessionId) {
      return { ok: false, error: "This legacy Task has no Session ID and cannot be relinked safely" };
    }
    const window = BrowserWindow.fromWebContents(sender) ?? undefined;
    const options: OpenDialogOptions = {
      title: "Locate PI Session",
      buttonLabel: "Use Session",
      properties: ["openFile"],
      filters: [{ name: "PI Session", extensions: ["jsonl"] }],
    };
    const pick = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    const sessionPath = pick.filePaths[0];
    if (pick.canceled || !sessionPath) return { ok: false, cancelled: true, error: "Cancelled" };
    try {
      const snapshot = await readPiSessionFile(sessionPath);
      if (snapshot.header?.id !== task.sessionId) {
        return { ok: false, error: "Selected file is not the original PI Session for this Task" };
      }
      return { ok: true, task: await this.tasks.relinkSession(task.id, sessionPath) };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Selected file is not a valid PI Session",
      };
    }
  }

  async updateTask(
    id: string,
    patch: {
      title?: string;
      workflow?: TaskWorkflow | null;
      ignoredSkillNames?: string[];
    },
  ): Promise<WorkspaceTask | null> {
    return this.tasks.update(id, patch);
  }

  /** Soft-delete a Task Tree. PI Session JSONL remains untouched. */
  async archiveTask(taskId: string): Promise<import("../../shared/desktop-contracts").PiTasksArchiveResult> {
    const previousActive = this.activeTaskId;
    const result = await this.tasks.archiveTree(taskId);
    const disposed = previousActive !== null && result.activeTaskId !== previousActive;
    if (disposed) await this.dispose();
    return { ...result, disposed };
  }

  async unarchiveTask(taskId: string): Promise<import("../../shared/desktop-contracts").PiTasksArchiveResult> {
    const result = await this.tasks.restoreTree(taskId);
    return { ...result, disposed: false };
  }

  async dispose(): Promise<void> {
    this.rejectAllApprovals("Session disposed");
    const taskId = this.activeTaskId;
    if (taskId) this.tasks.interruptIfRunning(taskId);
    if (this.child && this.childReady) {
      await this.send({ id: randomUUID(), type: "dispose" }).catch(() => { });
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
    ignoredSkillNames?: string[];
    appendSystemPrompts?: string[];
  }): Promise<PiHostState> {
    await this.ensureChild();
    const appendSystemPrompts = (options.appendSystemPrompts ?? [])
      .map((part) => part.trim())
      .filter(Boolean);
    const state = (await this.send({
      id: randomUUID(),
      type: "create",
      cwd: options.cwd,
      sessionPath: options.sessionPath,
      ...(options.ignoredSkillNames?.length
        ? { ignoredSkillNames: options.ignoredSkillNames }
        : {}),
      ...(appendSystemPrompts.length > 0 ? { appendSystemPrompts } : {}),
    })) as PiHostState;
    this.hostBound = true;
    this.cwd = options.cwd;
    return state;
  }

  /**
   * Resolve workflow step role prompt for a task (stored on the root workflow step).
   */
  private async rolePromptsForTask(task: WorkspaceTask): Promise<string[] | undefined> {
    const root =
      task.parentTaskId === null
        ? task
        : ((await this.tasks.get(task.rootTaskId)) ?? null);
    const workflow = root?.workflow;
    if (!workflow) return undefined;

    const byTaskId = workflow.steps.find((step) => step.taskId === task.id);
    if (byTaskId?.rolePrompt?.trim()) return [byTaskId.rolePrompt.trim()];

    // Step 1 often runs on the root before taskId is stamped on every step.
    if (task.parentTaskId === null) {
      const active = workflow.steps.find((step) => step.id === workflow.stepId);
      if (active?.rolePrompt?.trim()) return [active.rolePrompt.trim()];
    }
    return undefined;
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
      const interruptedTaskId = this.activeTaskId;
      if (interruptedTaskId) {
        try {
          this.tasks.interruptIfRunning(interruptedTaskId);
        } catch (error) {
          console.error("[pi-runtime] failed to persist interrupted status", error);
        }
      }
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
    if (!existing?.title.startsWith("New task")) return undefined;
    const firstUser =
      timeline?.items?.find((item) => item.kind === "user")?.text ?? prompt ?? "";
    const title = String(firstUser).replace(/\s+/g, " ").trim().slice(0, 72);
    return title || undefined;
  }

  private async readTimelineSnapshot(
    sessionPath: string | null,
    leafEntryId?: string | null,
  ): Promise<PiTimelineSnapshot> {
    if (!sessionPath) return EMPTY_TIMELINE;
    try {
      const snapshot = await readPiSessionFile(sessionPath);
      let liveLeaf = leafEntryId;
      if (liveLeaf === undefined && this.hostBound) {
        try {
          liveLeaf = (await this.getState()).leafEntryId;
        } catch {
          liveLeaf = snapshot.leafId;
        }
      }
      return projectSessionToTimeline(snapshot, liveLeaf ?? snapshot.leafId);
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
