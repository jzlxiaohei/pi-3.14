import { randomUUID } from "node:crypto";
import { copyFile, stat } from "node:fs/promises";
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
import {
  analyzePiSession,
  buildPiContextProjection,
  type PiSessionSnapshot,
} from "@pi-3.14/session";
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
  AdvanceWorkflowRequest,
  AdvanceWorkflowResult,
  Agent,
  AgentUpdateRequest,
  LegacyPanelPreferences,
  PiActivateAgentResult,
  PiBranchFlowGraph,
  PiBranchSpineView,
  PiHostCommand,
  PiHostProcessMessage,
  PiPromptResult,
  PiSessionCreateOptions,
  PiSessionCreateResult,
  PiSessionExportResult,
  PiSessionInspectResult,
  PiSessionMapContextRequest,
  PiSessionMapContextResult,
  PiSessionMapSnapshot,
  PiSessionNavigateRequest,
  PiSessionNavigateResult,
  PiTasksBootstrap,
  PiTimelineSnapshot,
  PiToolApprovalReply,
  PiToolApprovalRequest,
  PiWorkspacePickResult,
  Task,
  TaskPlaybookId,
  TaskWorkflow,
} from "../../shared/desktop-contracts";
import {
  buildBranchFlowGraph,
  buildBranchSpineView,
  buildBranchTree,
} from "../../shared/branch-tree";
import {
  buildHandoffPrefill,
  createWorkflowFromPlaybook,
  createWorkflowFromPlaybookTemplate,
  resolveStepStarter,
  resolveStepTemplateId,
} from "../../shared/playbook-catalog";
import { projectSessionToTimeline } from "../../shared/project-timeline";
import { snapshotAtLeaf } from "../../shared/session-leaf";
import {
  buildSessionMapStructure,
  clampPreview,
  countSessionMapStats,
  resolveSessionMapLeaf,
} from "../../shared/session-map";
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
 * Owns PI sessions for the desktop window and the persisted task catalog.
 *
 * Concurrent model: one utilityProcess with many EmbeddedPiHost instances
 * (hostId = agent id). Switching the active Agent only changes focus — it does
 * not abort background hosts. Main keeps dialogs, task persistence, JSONL
 * timeline projection, and renderer IPC.
 */
export class PiRuntimeManager {
  private cwd: string | null = null;
  private activeTaskId: string | null = null;
  private activeAgentId: string | null = null;
  private subscribedWebContents: WebContents | null = null;
  /** Agent ids that currently have a live host in the utility process. */
  private readonly boundHostIds = new Set<string>();
  private child: PiUtilityProcess | null = null;
  private childReady = false;
  private startingChild: Promise<void> | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly pendingApprovals = new Map<
    string,
    {
      resolve: (reply: PiToolApprovalReply) => void;
      timer: NodeJS.Timeout;
      agentId?: string;
    }
  >();
  /** Latest approval still waiting on the UI (survives renderer HMR remounts). */
  private activeApprovalRequest: PiToolApprovalRequest | null = null;
  /**
   * Parsed session JSONL cache keyed by path + mtime + size.
   * Avoids re-parsing the same file when continueTurn timeline + inspect race.
   */
  private sessionFileCache: {
    path: string;
    mtimeMs: number;
    size: number;
    snapshot: PiSessionSnapshot;
  } | null = null;
  /** Share one in-flight inspect across concurrent renderer callers. */
  private inspectInflight: Promise<PiSessionInspectResult> | null = null;

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
    return {
      tasks: boot.tasks,
      rootTasks: boot.tasks,
      activeTask: boot.activeTask,
      activeTaskId: boot.activeTaskId,
      activeRootTaskId: boot.activeTaskId,
      activeAgent: boot.activeAgent,
      activeAgentId: boot.activeAgentId,
      agentsByTaskId: boot.agentsByTaskId,
      appPreferences: boot.appPreferences,
      workspacePreferences: boot.workspacePreferences,
      legacyBrowserPreferencesImported,
    };
  }

  /** Active workspace cwd for resolving relative links from chat markdown. */
  getWorkspaceCwd(): string | null {
    return this.cwd;
  }

  async pickWorkspace(sender: WebContents): Promise<PiWorkspacePickResult> {
    const cwd = await this.chooseWorkspace(sender);
    if (!cwd) return { cancelled: true };
    this.cwd = cwd;
    return { cancelled: false, cwd };
  }

  /**
   * Create a Task shell (optional playbook) and open its first Agent Session.
   * Task never stores session fields — the Agent does.
   */
  async createSession(
    sender: WebContents,
    options: PiSessionCreateOptions = {},
  ): Promise<PiSessionCreateResult> {
    const cwd = options.cwd ?? this.cwd ?? (await this.chooseWorkspace(sender));
    if (!cwd) return { cancelled: true };

    this.subscribedWebContents = sender;
    this.cwd = cwd;

    let task: Task;
    if (options.taskId) {
      const existing = await this.tasks.getTask(options.taskId);
      if (!existing) throw new Error(`Unknown task: ${options.taskId}`);
      task = existing;
    } else {
      let workflow = null;
      if (options.playbookId) {
        const playbook = await this.tasks.getPlaybook(options.playbookId);
        workflow = playbook
          ? createWorkflowFromPlaybookTemplate(playbook)
          : createWorkflowFromPlaybook(options.playbookId);
      }
      task = await this.tasks.createTask({
        cwd,
        title: options.title?.trim() || folderTitle(cwd),
        workflow,
      });
    }

    // First open: ensure step1 Agent (playbook) or ad-hoc Agent.
    let agent: Agent;
    if (task.workflow) {
      agent = await this.ensureStepAgent(task.id, task.workflow.stepId);
    } else {
      agent = await this.createAdHocAgentWithSession(task, options.sessionPath ?? null);
    }

    // Host was just bound in ensureStepAgent / createAdHoc — focus without recreate.
    const activated = await this.activateAgent(sender, agent.id);
    if (!activated.ok) {
      return {
        cancelled: false,
        cwd,
        state: await this.getState().catch(() => ({
          sessionId: agent.sessionId ?? "",
          sessionPath: agent.sessionPath,
          leafEntryId: null,
          isStreaming: false,
          isCompacting: false,
          model: null,
          thinkingLevel: "off",
        })),
        timeline: EMPTY_TIMELINE,
        task: activated.task,
        agent: activated.agent,
      };
    }
    return {
      cancelled: false,
      cwd,
      state: activated.state,
      timeline: activated.timeline,
      task: activated.task,
      agent: activated.agent,
    };
  }

  /**
   * Sidebar Task select: open a default Agent under the Task.
   * If the user is already viewing an Agent under this Task (e.g. step 2/3),
   * do **not** jump to the playbook cursor Agent — keep the open sub-session.
   */
  async activateTask(
    sender: WebContents,
    taskId: string,
    options?: { force?: boolean },
  ): Promise<PiActivateAgentResult> {
    const task = await this.tasks.getTask(taskId);
    if (!task) throw new Error(`Unknown task: ${taskId}`);

    // Stay on current sub-agent when re-clicking the parent Task row.
    if (!options?.force && this.activeAgentId) {
      const current = await this.tasks.getAgent(this.activeAgentId);
      if (
        current &&
        current.taskId === taskId &&
        this.boundHostIds.has(current.id) &&
        this.childReady
      ) {
        return this.activateAgent(sender, current.id, options);
      }
    }

    let agentId: string | null = null;
    if (task.workflow) {
      const step = task.workflow.steps.find((s) => s.id === task.workflow!.stepId);
      if (step?.agentId) {
        agentId = step.agentId;
      } else {
        const ensured = await this.ensureStepAgent(task.id, task.workflow.stepId);
        agentId = ensured.id;
      }
    } else {
      const agents = await this.tasks.listAgents(taskId);
      agentId = agents[0]?.id ?? null;
      if (!agentId) {
        // Empty free-chat task: create ad-hoc agent on first activate.
        const created = await this.createAdHocAgentWithSession(task, null);
        agentId = created.id;
      }
    }

    // Catalog may still point at a deleted JSONL (e.g. recovered step Agent). Prefer any
    // available Agent under this Task so opening the Task does not land on unavailable.
    if (agentId && !options?.force) {
      const preferred = await this.tasks.getAgent(agentId);
      if (!preferred || preferred.sessionAvailability === "missing") {
        const healed = await this.healAgentSessionPath(preferred);
        if (healed) {
          agentId = healed.id;
        } else {
          const agents = await this.tasks.listAgents(taskId);
          const available =
            agents.find((a) => a.sessionAvailability === "available") ??
            agents.find((a) => a.id !== agentId) ??
            null;
          if (available?.sessionAvailability === "available") {
            agentId = available.id;
          }
        }
      }
    }

    return this.activateAgent(sender, agentId!, options);
  }

  async activateAgent(
    sender: WebContents,
    agentId: string,
    options?: { force?: boolean },
  ): Promise<PiActivateAgentResult> {
    let agent = await this.tasks.getAgent(agentId);
    if (!agent) throw new Error(`Unknown agent: ${agentId}`);
    const task = await this.tasks.getTask(agent.taskId);
    if (!task) throw new Error(`Unknown task: ${agent.taskId}`);

    this.subscribedWebContents = sender;

    // Same agent already focused with a live host — do not recreate (HMR / focus).
    if (
      !options?.force &&
      this.activeAgentId === agentId &&
      this.boundHostIds.has(agentId) &&
      this.childReady
    ) {
      const state = await this.getStateFor(agentId);
      const timeline = await this.readTimelineSnapshot(state.sessionPath, state.leafEntryId);
      this.reshowPendingApproval();
      return { ok: true, task, agent, state, timeline };
    }

    // Live host for this agent still running (background concurrent turn): only
    // switch focus — never abort other hosts.
    if (!options?.force && this.boundHostIds.has(agentId) && this.childReady) {
      this.activeTaskId = task.id;
      this.activeAgentId = agentId;
      this.cwd = task.cwd;
      await this.tasks.setActive(task.id, agentId);
      const state = await this.getStateFor(agentId);
      const timeline = await this.readTimelineSnapshot(state.sessionPath, state.leafEntryId);
      this.reshowPendingApproval();
      return { ok: true, task, agent, state, timeline };
    }

    // Path drift: catalog points at a moved/renamed JSONL — rediscover by session id.
    if (agent.sessionAvailability === "missing") {
      const healed = await this.healAgentSessionPath(agent);
      if (healed) agent = healed;
    }

    // Resume only when the JSONL is on disk. Missing is often *normal*: PI does not
    // flush the session file until the first assistant turn, so a brand-new Task/Agent
    // has a catalog path with no file yet. Heal already covered moved files; otherwise
    // bind a fresh host session and rewrite the Agent row (do not show "unavailable").
    const resumePath =
      agent.sessionPath && agent.sessionAvailability === "available" ? agent.sessionPath : null;
    if (agent.sessionPath && !resumePath) {
      console.info(
        `[pi-runtime] session file not on disk for agent ${agent.id}; binding a live session`,
        agent.sessionPath,
      );
    }

    // force (or first bind): create/replace only this hostId — other agents keep running.
    const state = await this.bindHost(agentId, {
      cwd: task.cwd,
      sessionPath: resumePath,
      rolePrompt: agent.systemPrompt,
      ignoredSkillNames: agent.skillPolicy.ignoredSkillNames,
    });
    const timeline = await this.readTimelineSnapshot(state.sessionPath, state.leafEntryId);
    const updated =
      (await this.tasks.updateAgent(
        agent.id,
        {
          sessionPath: state.sessionPath,
          sessionId: state.sessionId,
        },
        { touchUpdatedAt: false },
      )) ?? agent;

    this.activeTaskId = task.id;
    this.activeAgentId = updated.id;
    this.cwd = task.cwd;
    await this.tasks.setActive(task.id, updated.id);

    return { ok: true, task, agent: updated, state, timeline };
  }

  /**
   * Lazy step Agent: snapshot template, create Session, bind workflow.steps[].agentId.
   */
  async ensureStepAgent(
    taskId: string,
    stepId: string,
    inputContext?: string | null,
  ): Promise<Agent> {
    const task = await this.tasks.getTask(taskId);
    if (!task?.workflow) throw new Error("Task has no workflow");
    const step = task.workflow.steps.find((s) => s.id === stepId);
    if (!step) throw new Error(`Unknown step: ${stepId}`);
    if (step.agentId) {
      const existing = await this.tasks.getAgent(step.agentId);
      if (existing) return existing;
    }

    // Instance stamp wins (per-task rebind); catalog fills legacy steps.
    const templateId = resolveStepTemplateId(task.workflow, stepId);
    if (!templateId) throw new Error(`No template for ${task.workflow.playbookId}/${stepId}`);
    const template = await this.tasks.getTemplate(templateId);
    if (!template) throw new Error(`Missing template: ${templateId}`);

    // Persist stamp so UI / later ensures see the binding even on legacy tasks.
    if (!step.templateId || step.templateId !== templateId) {
      const steps = task.workflow.steps.map((s) =>
        s.id === stepId
          ? {
              ...s,
              templateId,
              starterPrompt: s.starterPrompt ?? resolveStepStarter(task.workflow!, stepId),
            }
          : s,
      );
      await this.tasks.updateTask(taskId, {
        workflow: { ...task.workflow, steps },
      });
    }

    const agentId = randomUUID();
    const state = await this.bindHost(agentId, {
      cwd: task.cwd,
      sessionPath: null,
      rolePrompt: template.systemPrompt,
      ignoredSkillNames: template.skillPolicy.ignoredSkillNames,
    });
    if (!state.sessionPath || !state.sessionId) {
      await this.disposeHost(agentId);
      throw new Error("PI did not create a persisted Session for this Agent");
    }

    try {
      const agent = await this.tasks.createAgent({
        id: agentId,
        taskId,
        parentAgentId: null,
        templateId: template.id,
        name: template.name,
        systemPrompt: template.systemPrompt,
        skillPolicy: template.skillPolicy,
        inputContext: inputContext ?? null,
        sessionId: state.sessionId,
        sessionPath: state.sessionPath,
      });
      await this.tasks.bindStepAgent(taskId, stepId, agent.id);
      return agent;
    } catch (error) {
      await this.disposeHost(agentId);
      throw error;
    }
  }

  async createAdHocAgentWithSession(
    task: Task,
    sessionPath: string | null,
  ): Promise<Agent> {
    const resume =
      sessionPath && (await fileExists(sessionPath)) ? sessionPath : null;
    const agentId = randomUUID();
    const state = await this.bindHost(agentId, {
      cwd: task.cwd,
      sessionPath: resume,
    });
    if (!state.sessionPath || !state.sessionId) {
      await this.disposeHost(agentId);
      throw new Error("PI did not create a persisted Session for this Agent");
    }
    try {
      return await this.tasks.createAgent({
        id: agentId,
        taskId: task.id,
        parentAgentId: null,
        templateId: null,
        name: "Chat",
        systemPrompt: "",
        skillPolicy: { ignoredSkillNames: [] },
        sessionId: state.sessionId,
        sessionPath: state.sessionPath,
      });
    } catch (error) {
      await this.disposeHost(agentId);
      throw error;
    }
  }

  /** Snapshot a system template into a new Agent under a Task (optional step bind). */
  async createAgentFromTemplate(
    request: import("../../shared/desktop-contracts").AgentCreateFromTemplateRequest,
  ): Promise<Agent> {
    const task = await this.tasks.getTask(request.taskId);
    if (!task) throw new Error(`Unknown task: ${request.taskId}`);
    const template = await this.tasks.getTemplate(request.templateId);
    if (!template) throw new Error(`Unknown template: ${request.templateId}`);

    const agentId = randomUUID();
    const state = await this.bindHost(agentId, {
      cwd: task.cwd,
      sessionPath: null,
      rolePrompt: template.systemPrompt,
      ignoredSkillNames: template.skillPolicy.ignoredSkillNames,
    });
    if (!state.sessionPath || !state.sessionId) {
      await this.disposeHost(agentId);
      throw new Error("PI did not create a persisted Session for this Agent");
    }
    try {
      const agent = await this.tasks.createAgent({
        id: agentId,
        taskId: task.id,
        parentAgentId: request.parentAgentId ?? null,
        templateId: template.id,
        name: request.name?.trim() || template.name,
        systemPrompt: template.systemPrompt,
        skillPolicy: template.skillPolicy,
        inputContext: request.inputContext ?? null,
        sessionId: state.sessionId,
        sessionPath: state.sessionPath,
      });
      if (request.stepId && task.workflow) {
        await this.tasks.bindStepAgent(task.id, request.stepId, agent.id);
      }
      return agent;
    } catch (error) {
      await this.disposeHost(agentId);
      throw error;
    }
  }

  /**
   * True subagent spawn: child Agent under the same Task with parentAgentId set.
   * Playbook step Agents must NOT use this (they keep parentAgentId null).
   */
  async spawnChildAgent(
    request: import("../../shared/desktop-contracts").AgentSpawnChildRequest,
  ): Promise<Agent> {
    const parent = await this.tasks.getAgent(request.parentAgentId);
    if (!parent) throw new Error(`Unknown parent agent: ${request.parentAgentId}`);
    const task = await this.tasks.getTask(parent.taskId);
    if (!task) throw new Error(`Unknown task: ${parent.taskId}`);

    let systemPrompt = request.systemPrompt ?? "";
    let skillPolicy = request.skillPolicy ?? { ignoredSkillNames: [] };
    let templateId: string | null = request.templateId ?? null;
    if (request.templateId) {
      const template = await this.tasks.getTemplate(request.templateId);
      if (!template) throw new Error(`Unknown template: ${request.templateId}`);
      systemPrompt = request.systemPrompt ?? template.systemPrompt;
      skillPolicy = request.skillPolicy ?? template.skillPolicy;
      templateId = template.id;
    }

    const agentId = randomUUID();
    const state = await this.bindHost(agentId, {
      cwd: task.cwd,
      sessionPath: null,
      rolePrompt: systemPrompt,
      ignoredSkillNames: skillPolicy.ignoredSkillNames,
    });
    if (!state.sessionPath || !state.sessionId) {
      await this.disposeHost(agentId);
      throw new Error("PI did not create a persisted Session for this Agent");
    }
    try {
      return await this.tasks.createAgent({
        id: agentId,
        taskId: task.id,
        parentAgentId: parent.id,
        templateId,
        name: request.name,
        systemPrompt,
        skillPolicy,
        inputContext: request.inputContext ?? null,
        sessionId: state.sessionId,
        sessionPath: state.sessionPath,
      });
    } catch (error) {
      await this.disposeHost(agentId);
      throw error;
    }
  }

  async advanceTaskWorkflow(
    sender: WebContents,
    request: AdvanceWorkflowRequest,
  ): Promise<AdvanceWorkflowResult> {
    const task = await this.tasks.getTask(request.taskId);
    if (!task?.workflow) throw new Error("Task has no workflow");
    const workflow = task.workflow;
    const currentStep = workflow.steps.find((s) => s.id === workflow.stepId);
    if (!currentStep) throw new Error("Invalid workflow cursor");

    let previousAgent: Agent | null = currentStep.agentId
      ? await this.tasks.getAgent(currentStep.agentId)
      : null;

    const handoff = request.handoffText?.trim() || previousAgent?.outputContext || null;
    if (previousAgent && handoff) {
      previousAgent =
        (await this.tasks.updateAgent(previousAgent.id, {
          outputContext: handoff,
          status: request.mode === "done" ? "done" : "idle",
        })) ?? previousAgent;
    } else if (previousAgent) {
      previousAgent =
        (await this.tasks.updateAgent(previousAgent.id, {
          status: request.mode === "done" ? "done" : "idle",
        })) ?? previousAgent;
    }

    const stepIndex = workflow.steps.findIndex((s) => s.id === workflow.stepId);
    const steps = workflow.steps.map((step, index) => {
      if (index === stepIndex) {
        return { ...step, status: request.mode === "done" ? ("done" as const) : ("skipped" as const) };
      }
      return step;
    });

    const nextIndex = stepIndex + 1;
    if (nextIndex >= steps.length) {
      const nextWorkflow = { ...workflow, steps };
      const updated =
        (await this.tasks.updateTask(task.id, { workflow: nextWorkflow })) ?? task;
      this.tasks.recomputeTaskStatus(task.id);
      return {
        task: (await this.tasks.getTask(updated.id))!,
        previousAgent,
        nextAgent: null,
        starterPrompt: null,
        completed: true,
      };
    }

    const nextStepId = steps[nextIndex]!.id;
    const nextSteps = steps.map((step, index) =>
      index === nextIndex ? { ...step, status: "active" as const } : step,
    );
    const nextWorkflow: TaskWorkflow = {
      ...workflow,
      stepId: nextStepId,
      steps: nextSteps,
    };
    await this.tasks.updateTask(task.id, { workflow: nextWorkflow });

    const nextAgent = await this.ensureStepAgent(task.id, nextStepId, handoff);
    await this.activateAgent(sender, nextAgent.id, { force: true });

    const refreshed = (await this.tasks.getTask(task.id))!;
    const starter = resolveStepStarter(refreshed.workflow ?? nextWorkflow, nextStepId);
    const starterPrompt = buildHandoffPrefill(starter, handoff);

    return {
      task: (await this.tasks.getTask(task.id))!,
      previousAgent,
      nextAgent,
      starterPrompt,
      completed: false,
    };
  }

  getPendingApproval(): PiToolApprovalRequest | null {
    return this.activeApprovalRequest;
  }

  async prompt(
    sender: WebContents,
    text: string,
    options?: { agentId?: string },
  ): Promise<PiPromptResult> {
    this.subscribedWebContents = sender;
    const agentId = this.resolveHostId(options?.agentId);
    const agentRow = await this.tasks.getAgent(agentId);
    const taskId = agentRow?.taskId ?? this.activeTaskId;
    // First user send counts as Role Prompt confirmation (best-effort; never blocks send).
    if (agentRow && agentRow.rolePromptConfirmedAt == null) {
      try {
        await this.tasks.updateAgent(agentId, { confirmRolePrompt: true });
      } catch {
        // ignore confirm write failures
      }
    }
    await this.tasks.setAgentStatus(agentId, "running");

    let result: PiTurnResult;
    try {
      result = (await this.send({
        id: randomUUID(),
        hostId: agentId,
        type: "prompt",
        text,
      })) as PiTurnResult;
    } catch (error) {
      await this.tasks.setAgentStatus(agentId, "error");
      if (taskId) this.tasks.recomputeTaskStatus(taskId);
      throw error;
    }

    const timeline = await this.readTimelineSnapshot(result.sessionPath, result.leafEntryId);
    let title: string | undefined;
    if (taskId) {
      try {
        title = await this.maybeTitleFromPrompt(taskId, text, timeline);
      } catch {
        title = undefined;
      }
    }
    const agent = await this.tasks.updateAgent(agentId, {
      sessionPath: result.sessionPath,
      sessionId: result.sessionId,
      status: result.stopReason === "error" ? "error" : "idle",
    });
    const task = taskId
      ? await this.tasks.updateTask(taskId, {
          ...(title ? { title } : {}),
        })
      : null;
    if (taskId) this.tasks.recomputeTaskStatus(taskId);

    return { ...result, timeline, task, agent };
  }

  /** Retry generation from the current leaf without appending a new user message. */
  async continueTurn(
    sender: WebContents,
    options?: { agentId?: string },
  ): Promise<PiPromptResult> {
    this.subscribedWebContents = sender;
    const agentId = this.resolveHostId(options?.agentId);
    const agentRow = await this.tasks.getAgent(agentId);
    const taskId = agentRow?.taskId ?? this.activeTaskId;
    await this.tasks.setAgentStatus(agentId, "running");

    let result: PiTurnResult;
    try {
      result = (await this.send({
        id: randomUUID(),
        hostId: agentId,
        type: "continue_turn",
      })) as PiTurnResult;
    } catch (error) {
      await this.tasks.setAgentStatus(agentId, "error");
      if (taskId) this.tasks.recomputeTaskStatus(taskId);
      throw error;
    }
    const timeline = await this.readTimelineSnapshot(result.sessionPath, result.leafEntryId);
    const agent = await this.tasks.updateAgent(agentId, {
      sessionPath: result.sessionPath,
      sessionId: result.sessionId,
      status: result.stopReason === "error" ? "error" : "idle",
    });
    const task = taskId ? await this.tasks.getTask(taskId) : null;
    if (taskId) this.tasks.recomputeTaskStatus(taskId);

    return { ...result, timeline, task, agent };
  }

  /** Abort one Agent host (default: focused) — other concurrent hosts keep running. */
  async abort(options?: { agentId?: string }): Promise<void> {
    const agentId = options?.agentId ?? this.activeAgentId;
    if (!agentId || !this.child || !this.boundHostIds.has(agentId)) return;
    this.rejectApprovalsForAgent(agentId, "Aborted");
    await this.send({ id: randomUUID(), hostId: agentId, type: "abort" }).catch(() => { });
    this.tasks.idleIfRunning(agentId);
    const agent = await this.tasks.getAgent(agentId);
    if (agent) this.tasks.recomputeTaskStatus(agent.taskId);
  }

  async getState(): Promise<PiHostState> {
    return this.getStateFor(this.requireActiveHostId());
  }

  private async getStateFor(hostId: string): Promise<PiHostState> {
    if (!this.childReady || !this.boundHostIds.has(hostId)) {
      throw new Error("PI session has not been created");
    }
    return (await this.send({
      id: randomUUID(),
      hostId,
      type: "get_state",
    })) as PiHostState;
  }

  async listModels(): Promise<PiModelOption[]> {
    const hostId = this.requireActiveHostId();
    return (await this.send({
      id: randomUUID(),
      hostId,
      type: "list_models",
    })) as PiModelOption[];
  }

  async listThinkingLevels(): Promise<PiThinkingLevel[]> {
    const hostId = this.requireActiveHostId();
    return (await this.send({
      id: randomUUID(),
      hostId,
      type: "list_thinking_levels",
    })) as PiThinkingLevel[];
  }

  async setModel(provider: string, modelId: string): Promise<PiHostState> {
    const hostId = this.requireActiveHostId();
    return (await this.send({
      id: randomUUID(),
      hostId,
      type: "set_model",
      provider,
      modelId,
    })) as PiHostState;
  }

  async setThinkingLevel(level: PiThinkingLevel): Promise<PiHostState> {
    const hostId = this.requireActiveHostId();
    return (await this.send({
      id: randomUUID(),
      hostId,
      type: "set_thinking_level",
      level,
    })) as PiHostState;
  }

  async setAutoApprove(unlocked: boolean): Promise<{ unlocked: boolean }> {
    const hostId = this.requireActiveHostId();
    return (await this.send({
      id: randomUUID(),
      hostId,
      type: "set_auto_approve",
      unlocked,
    })) as { unlocked: boolean };
  }

  async getAutoApprove(): Promise<{ unlocked: boolean }> {
    const hostId = this.requireActiveHostId();
    return (await this.send({
      id: randomUUID(),
      hostId,
      type: "get_auto_approve",
    })) as { unlocked: boolean };
  }

  /** Copy the active session JSONL via a Save dialog (local share / backup). */
  async exportSession(sender: WebContents): Promise<PiSessionExportResult> {
    let sessionPath: string | null = null;
    if (this.activeAgentId) {
      const agent = await this.tasks.getAgent(this.activeAgentId);
      sessionPath = agent?.sessionPath ?? null;
    }
    if (
      !sessionPath &&
      this.activeAgentId &&
      this.boundHostIds.has(this.activeAgentId) &&
      this.childReady
    ) {
      try {
        sessionPath = (await this.getStateFor(this.activeAgentId)).sessionPath;
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

  /**
   * `full` — Context inspector / branches (transcript + JSONL graphs).
   * `hud` — composer meters only (light live snapshot, no file parse).
   */
  async inspectSession(options?: {
    detail?: "full" | "hud";
  }): Promise<PiSessionInspectResult> {
    const detail = options?.detail ?? "full";
    if (detail === "hud") {
      return this.runInspectHud();
    }
    // Renderer often fires full inspect from inspector + branches at once after a
    // turn settles; share one run so main does not re-parse JSONL N times.
    if (this.inspectInflight) return this.inspectInflight;
    this.inspectInflight = this.runInspectSessionFull().finally(() => {
      this.inspectInflight = null;
    });
    return this.inspectInflight;
  }

  /** Cheap: skills + context % for the composer HUD. No JSONL / branch graphs. */
  private async runInspectHud(): Promise<PiSessionInspectResult> {
    const hostId = this.requireActiveHostId();
    let live: PiLiveInspectSnapshot | null = null;
    let sessionPath: string | null = null;
    let leafEntryId: string | null = null;
    try {
      live = (await this.send({
        id: randomUUID(),
        hostId,
        type: "inspect_live",
        detail: "summary",
      })) as PiLiveInspectSnapshot;
      const state = await this.getStateFor(hostId);
      sessionPath = state.sessionPath;
      leafEntryId = state.leafEntryId;
    } catch {
      live = null;
    }
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

  private async runInspectSessionFull(): Promise<PiSessionInspectResult> {
    const hostId = this.requireActiveHostId();
    let live: PiLiveInspectSnapshot | null = null;
    let sessionPath: string | null = null;
    let leafEntryId: string | null = null;
    try {
      live = (await this.send({
        id: randomUUID(),
        hostId,
        type: "inspect_live",
        detail: "full",
      })) as PiLiveInspectSnapshot;
      const state = await this.getStateFor(hostId);
      sessionPath = state.sessionPath;
      leafEntryId = state.leafEntryId;
    } catch {
      live = null;
    }

    if (!sessionPath && this.activeAgentId) {
      sessionPath = (await this.tasks.getAgent(this.activeAgentId))?.sessionPath ?? null;
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
      const fileSnapshot = await this.loadSessionSnapshot(sessionPath);
      await yieldMain();
      const snapshot = snapshotAtLeaf(fileSnapshot, leafEntryId ?? fileSnapshot.leafId);
      const analysis = analyzePiSession(snapshot);
      await yieldMain();
      const context = buildPiContextProjection(snapshot, snapshot.leafId);
      await yieldMain();
      const branchTree = buildBranchTree(snapshot);
      await yieldMain();
      const branchSpine = buildBranchSpineView(snapshot);
      await yieldMain();
      const branchFlow = buildBranchFlowGraph(snapshot);
      return {
        sessionPath,
        leafEntryId: snapshot.leafId,
        live,
        analysis,
        context,
        branchTree,
        branchSpine,
        branchFlow,
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

  /** Session Map structure (turn + entry graphs) for the active host session. */
  async getSessionMap(): Promise<PiSessionMapSnapshot> {
    const empty: PiSessionMapSnapshot = {
      sessionId: null,
      sessionPath: null,
      liveLeafId: null,
      turn: { nodes: [], edges: [], density: "turn" },
      entry: { nodes: [], edges: [], density: "entry" },
      analysis: {
        branchPointCount: 0,
        entryCount: 0,
        messageCount: 0,
        compactionCount: 0,
      },
      diagnostics: [],
    };

    let sessionPath: string | null = null;
    let liveLeafId: string | null = null;
    let sessionId: string | null = null;
    try {
      const hostId = this.requireActiveHostId();
      const state = await this.getStateFor(hostId);
      sessionPath = state.sessionPath;
      liveLeafId = state.leafEntryId;
      sessionId = state.sessionId;
    } catch {
      if (this.activeAgentId) {
        const agent = await this.tasks.getAgent(this.activeAgentId);
        sessionPath = agent?.sessionPath ?? null;
        sessionId = agent?.sessionId ?? null;
      }
    }

    if (!sessionPath && this.activeAgentId) {
      sessionPath = (await this.tasks.getAgent(this.activeAgentId))?.sessionPath ?? null;
    }
    if (!sessionPath || !(await fileExists(sessionPath))) {
      return { ...empty, sessionId, sessionPath, liveLeafId };
    }

    try {
      const fileSnapshot = await this.loadSessionSnapshot(sessionPath);
      const snapshot = snapshotAtLeaf(fileSnapshot, liveLeafId ?? fileSnapshot.leafId);
      await yieldMain();
      const turn = buildSessionMapStructure(snapshot, "turn");
      await yieldMain();
      const entry = buildSessionMapStructure(snapshot, "entry", { includeMetadata: true });
      const stats = countSessionMapStats(snapshot);
      return {
        sessionId: sessionId ?? snapshot.header?.id ?? null,
        sessionPath,
        liveLeafId: snapshot.leafId,
        turn,
        entry,
        analysis: stats,
        diagnostics: snapshot.diagnostics,
      };
    } catch {
      return { ...empty, sessionId, sessionPath, liveLeafId };
    }
  }

  /** Context projection for a Session Map selection (preview leaf). */
  async getSessionMapContext(
    request: PiSessionMapContextRequest,
  ): Promise<PiSessionMapContextResult> {
    const selectionEntryId = request.selectionEntryId?.trim() ?? "";
    let sessionPath: string | null = null;
    let liveLeafId: string | null = null;
    let liveHud: PiSessionMapContextResult["liveHud"] = null;

    try {
      const hostId = this.requireActiveHostId();
      const state = await this.getStateFor(hostId);
      sessionPath = state.sessionPath;
      liveLeafId = state.leafEntryId;
      try {
        const live = (await this.send({
          id: randomUUID(),
          hostId,
          type: "inspect_live",
          detail: "summary",
        })) as import("@pi-3.14/model").PiLiveInspectSnapshot;
        liveHud = {
          skillNames: (live.skills ?? []).map((s) => s.name).filter(Boolean),
          toolNames: live.activeToolNames?.length
            ? live.activeToolNames
            : (live.tools ?? []).map((t) => t.name),
          systemPromptPreview: live.systemPrompt
            ? clampPreview(live.systemPrompt, 280)
            : null,
        };
      } catch {
        liveHud = null;
      }
    } catch {
      /* host may be down */
    }

    if (!sessionPath && this.activeAgentId) {
      sessionPath = (await this.tasks.getAgent(this.activeAgentId))?.sessionPath ?? null;
    }
    if (!sessionPath || !(await fileExists(sessionPath)) || !selectionEntryId) {
      return {
        selectionEntryId,
        resolvedLeafId: selectionEntryId,
        projection: {
          leafId: null,
          pathEntryIds: [],
          effectiveEntryIds: [],
          excludedPathEntryIds: [],
          messages: [],
          model: null,
          thinkingLevel: null,
          latestCompaction: null,
          recoverability: {
            exactFromJsonl: [],
            unavailableFromJsonl: ["systemPrompt", "tools", "skills"],
          },
          diagnostics: [],
        },
        isLiveLeaf: false,
        liveHud,
      };
    }

    const fileSnapshot = await this.loadSessionSnapshot(sessionPath);
    const snapshot = snapshotAtLeaf(fileSnapshot, liveLeafId ?? fileSnapshot.leafId);
    const resolvedLeafId = resolveSessionMapLeaf(snapshot, selectionEntryId);
    const projection = buildPiContextProjection(snapshot, resolvedLeafId);
    // Truncate message bodies for IPC — detail pane expands short previews.
    const messages = projection.messages.map((m) => ({
      ...m,
      text: clampPreview(m.text, 2000),
      ...(m.thinking ? { thinking: clampPreview(m.thinking, 800) } : {}),
    }));
    return {
      selectionEntryId,
      resolvedLeafId,
      projection: { ...projection, messages },
      isLiveLeaf: Boolean(liveLeafId && resolvedLeafId === liveLeafId),
      liveHud,
    };
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
    const hostId = this.requireActiveHostId();
    this.rejectApprovalsForAgent(hostId, "Navigating session tree");
    await this.send({ id: randomUUID(), hostId, type: "abort" }).catch(() => {});

    const nav = (await this.send({
      id: randomUUID(),
      hostId,
      type: "navigate_tree",
      entryId: request.entryId,
      summarize: request.summarize ?? false,
    })) as PiNavigateTreeResult;

    const state = await this.getStateFor(hostId);
    const timeline = await this.readTimelineSnapshot(state.sessionPath, state.leafEntryId);
    await this.tasks.updateAgent(hostId, {
      sessionPath: state.sessionPath,
      sessionId: state.sessionId,
    });

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
    const hostId = this.requireActiveHostId();
    return (await this.send({
      id: randomUUID(),
      hostId,
      type: "prepare_branch_summary",
    })) as PiPreparedBranchSummary;
  }

  async getPreparedBranchSummary(): Promise<PiPreparedBranchSummary | null> {
    const hostId = this.activeAgentId;
    if (!hostId || !this.boundHostIds.has(hostId) || !this.childReady) return null;
    return (await this.send({
      id: randomUUID(),
      hostId,
      type: "get_prepared_branch_summary",
    })) as PiPreparedBranchSummary | null;
  }

  async clearPreparedBranchSummary(): Promise<void> {
    const hostId = this.activeAgentId;
    if (!hostId || !this.boundHostIds.has(hostId) || !this.childReady) return;
    await this.send({
      id: randomUUID(),
      hostId,
      type: "clear_prepared_branch_summary",
    });
  }

  async listTasks(): Promise<Task[]> {
    return this.tasks.listTasks();
  }

  async listAgents(taskId: string): Promise<Agent[]> {
    return this.tasks.listAgents(taskId);
  }

  async listTemplates() {
    return this.tasks.listTemplates();
  }

  async createTemplate(request: import("../../shared/desktop-contracts").AgentTemplateCreateRequest) {
    return this.tasks.createTemplate(request);
  }

  async updateTemplate(request: import("../../shared/desktop-contracts").AgentTemplateUpdateRequest) {
    return this.tasks.updateTemplate(request);
  }

  async deleteTemplate(id: string) {
    return this.tasks.deleteTemplate(id);
  }

  async duplicateTemplate(id: string) {
    return this.tasks.duplicateTemplate(id);
  }

  async resetTemplateFactory(id: string) {
    return this.tasks.resetTemplateFactory(id);
  }

  async listPlaybooks() {
    return this.tasks.listPlaybooks();
  }

  async getPlaybook(id: string) {
    return this.tasks.getPlaybook(id);
  }

  async createPlaybook(request: import("../../shared/desktop-contracts").PlaybookTemplateCreateRequest) {
    return this.tasks.createPlaybook(request);
  }

  async updatePlaybook(request: import("../../shared/desktop-contracts").PlaybookTemplateUpdateRequest) {
    return this.tasks.updatePlaybook(request);
  }

  async deletePlaybook(id: string) {
    return this.tasks.deletePlaybook(id);
  }

  async duplicatePlaybook(id: string) {
    return this.tasks.duplicatePlaybook(id);
  }

  async resetPlaybookFactory(id: string) {
    return this.tasks.resetPlaybookFactory(id);
  }

  async moveTask(request: import("../../shared/desktop-contracts").WorkspaceTaskMoveRequest) {
    return this.tasks.moveTask(request);
  }

  async relinkAgentSession(
    sender: WebContents,
    agentId: string,
  ): Promise<import("../../shared/desktop-contracts").WorkspaceTaskRelinkResult> {
    const agent = await this.tasks.getAgent(agentId);
    if (!agent) return { ok: false, error: `Unknown agent: ${agentId}` };
    if (!agent.sessionId) {
      return { ok: false, error: "This Agent has no Session ID and cannot be relinked safely" };
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
      if (snapshot.header?.id !== agent.sessionId) {
        return { ok: false, error: "Selected file is not the original PI Session for this Agent" };
      }
      return { ok: true, agent: await this.tasks.relinkAgentSession(agent.id, sessionPath) };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Selected file is not a valid PI Session",
      };
    }
  }

  /** @deprecated use relinkAgentSession */
  async relinkTaskSession(sender: WebContents, agentId: string) {
    return this.relinkAgentSession(sender, agentId);
  }

  async updateTask(
    id: string,
    patch: {
      title?: string;
      workflow?: TaskWorkflow | null;
    },
  ): Promise<Task | null> {
    return this.tasks.updateTask(id, patch);
  }

  async updateAgent(request: AgentUpdateRequest): Promise<Agent | null> {
    const { id, ...patch } = request;
    return this.tasks.updateAgent(id, patch);
  }

  async confirmAgentRolePrompt(agentId: string): Promise<Agent | null> {
    return this.tasks.updateAgent(agentId, { confirmRolePrompt: true });
  }

  async restoreAgentRolePromptFromTemplate(
    agentId: string,
  ): Promise<import("../../shared/desktop-contracts").AgentRestoreRolePromptResult> {
    const agent = await this.tasks.getAgent(agentId);
    if (!agent) return { ok: false, error: "Unknown agent" };
    if (!agent.templateId) {
      return { ok: false, error: "This Agent has no Template to restore from" };
    }
    const template = await this.tasks.getTemplate(agent.templateId);
    if (!template) {
      return { ok: false, error: `Missing template: ${agent.templateId}` };
    }
    const updated = await this.tasks.updateAgent(agentId, {
      systemPrompt: template.systemPrompt,
      confirmRolePrompt: true,
    });
    if (!updated) return { ok: false, error: "Failed to update agent" };
    return { ok: true, agent: updated };
  }

  /** Soft-delete a Task. PI Session JSONL remains untouched. */
  async archiveTask(taskId: string): Promise<import("../../shared/desktop-contracts").PiTasksArchiveResult> {
    const agents = await this.tasks.listAgents(taskId);
    for (const agent of agents) {
      await this.disposeHost(agent.id);
    }
    const previousAgent = this.activeAgentId;
    const result = await this.tasks.archiveTask(taskId);
    const focusLost =
      previousAgent !== null &&
      (result.activeAgentId !== previousAgent || result.activeTaskId !== this.activeTaskId);
    if (focusLost) {
      this.activeTaskId = result.activeTaskId;
      this.activeAgentId = result.activeAgentId;
    }
    return {
      tasks: result.tasks,
      rootTasks: result.tasks,
      activeTaskId: result.activeTaskId,
      activeRootTaskId: result.activeTaskId,
      activeAgentId: result.activeAgentId,
      disposed: focusLost,
    };
  }

  async unarchiveTask(taskId: string): Promise<import("../../shared/desktop-contracts").PiTasksArchiveResult> {
    const result = await this.tasks.restoreTask(taskId);
    return {
      tasks: result.tasks,
      rootTasks: result.tasks,
      activeTaskId: result.activeTaskId,
      activeRootTaskId: result.activeTaskId,
      activeAgentId: result.activeAgentId,
      disposed: false,
    };
  }

  /** Tear down every live host and the utility process (app shutdown / hard reset). */
  async dispose(): Promise<void> {
    this.rejectAllApprovals("Session disposed");
    for (const hostId of this.boundHostIds) {
      this.tasks.interruptIfRunning(hostId);
    }
    if (this.child && this.childReady) {
      await this.send({ id: randomUUID(), type: "dispose" }).catch(() => { });
    }
    this.boundHostIds.clear();
    this.killChild();
    this.subscribedWebContents = null;
    this.activeTaskId = null;
    this.activeAgentId = null;
  }

  get currentCwd(): string | null {
    return this.cwd;
  }

  /** Create or replace a single host (does not touch other agents). */
  private async bindHost(
    hostId: string,
    options: {
      cwd: string;
      sessionPath: string | null;
      rolePrompt?: string;
      ignoredSkillNames?: string[];
    },
  ): Promise<PiHostState> {
    await this.ensureChild();
    const state = (await this.send({
      id: randomUUID(),
      hostId,
      type: "create",
      cwd: options.cwd,
      sessionPath: options.sessionPath,
      rolePrompt: options.rolePrompt ?? "",
      ...(options.ignoredSkillNames?.length
        ? { ignoredSkillNames: options.ignoredSkillNames }
        : {}),
    })) as PiHostState;
    this.boundHostIds.add(hostId);
    this.cwd = options.cwd;
    return state;
  }

  /** Dispose one host without affecting concurrent agents. */
  private async disposeHost(hostId: string): Promise<void> {
    if (this.boundHostIds.has(hostId) && this.child && this.childReady) {
      this.rejectApprovalsForAgent(hostId, "Host disposed");
      await this.send({ id: randomUUID(), hostId, type: "dispose" }).catch(() => {});
    }
    this.boundHostIds.delete(hostId);
    if (this.activeAgentId === hostId) {
      this.activeAgentId = null;
    }
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
      this.child = null;
      const interruptedIds = [...this.boundHostIds];
      this.boundHostIds.clear();
      for (const [, pending] of this.pending) {
        pending.reject(new Error("PI host process exited"));
      }
      this.pending.clear();
      this.rejectAllApprovals("PI host process exited");
      for (const hostId of interruptedIds) {
        try {
          this.tasks.interruptIfRunning(hostId);
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
      this.forwardEvent(message.hostId, message.event);
      return;
    }

    if ("type" in message && message.type === "tool_approval") {
      console.log(
        `[pi-runtime] tool approval requested: ${message.toolName} (${message.approvalId}) host=${message.hostId}`,
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
    hostId: string;
    approvalId: string;
    toolCallId: string;
    toolName: string;
    args: import("@pi-3.14/model").JsonValue;
  }): Promise<void> {
    const decision = await this.requestToolApprovalFromRenderer({
      id: message.approvalId,
      agentId: message.hostId,
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
      this.pendingApprovals.set(request.id, {
        resolve,
        timer,
        ...(request.agentId ? { agentId: request.agentId } : {}),
      });
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
    this.boundHostIds.clear();
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

  private rejectApprovalsForAgent(agentId: string, reason: string): void {
    for (const [id, pending] of this.pendingApprovals) {
      // Keep approvals that clearly belong to another concurrent agent.
      if (pending.agentId !== undefined && pending.agentId !== agentId) continue;
      clearTimeout(pending.timer);
      pending.resolve({ id, approved: false, reason });
      this.pendingApprovals.delete(id);
      if (this.activeApprovalRequest?.id === id) {
        this.activeApprovalRequest = null;
      }
    }
  }

  private requireActiveHostId(): string {
    return this.resolveHostId(this.activeAgentId);
  }

  /** Prefer explicit agentId (concurrent IPC race-safe); fall back to focused host. */
  private resolveHostId(agentId?: string | null): string {
    const hostId = agentId ?? this.activeAgentId;
    if (!hostId || !this.childReady || !this.boundHostIds.has(hostId)) {
      throw new Error("PI session has not been created");
    }
    return hostId;
  }

  private async maybeTitleFromPrompt(
    taskId: string,
    prompt: string,
    timeline: PiTimelineSnapshot,
  ): Promise<string | undefined> {
    const existing = await this.tasks.getTask(taskId);
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
      const snapshot = await this.loadSessionSnapshot(sessionPath);
      let liveLeaf = leafEntryId;
      if (
        liveLeaf === undefined &&
        this.activeAgentId &&
        this.boundHostIds.has(this.activeAgentId)
      ) {
        try {
          liveLeaf = (await this.getStateFor(this.activeAgentId)).leafEntryId;
        } catch {
          liveLeaf = snapshot.leafId;
        }
      }
      return projectSessionToTimeline(snapshot, liveLeaf ?? snapshot.leafId);
    } catch {
      return EMPTY_TIMELINE;
    }
  }

  /**
   * Read + parse session JSONL once per file revision (path/mtime/size).
   * Timeline projection and inspect share this so post-turn storms stay cheap.
   */
  private async loadSessionSnapshot(sessionPath: string): Promise<PiSessionSnapshot> {
    const meta = await stat(sessionPath);
    const mtimeMs = meta.mtimeMs;
    const size = meta.size;
    const hit = this.sessionFileCache;
    if (
      hit &&
      hit.path === sessionPath &&
      hit.mtimeMs === mtimeMs &&
      hit.size === size
    ) {
      return hit.snapshot;
    }
    const snapshot = await readPiSessionFile(sessionPath);
    // Large JSONL parse just finished; yield before projection/inspect builds graphs.
    await yieldMain();
    this.sessionFileCache = { path: sessionPath, mtimeMs, size, snapshot };
    return snapshot;
  }

  /**
   * If the catalog session_path is gone but session_id is known, search
   * ~/.pi/agent/sessions for `*_{sessionId}.jsonl` and rewrite the Agent row.
   */
  private async healAgentSessionPath(agent: Agent | null): Promise<Agent | null> {
    if (!agent?.sessionId) return null;
    if (agent.sessionAvailability === "available" && agent.sessionPath) return agent;
    const found = await findSessionFileById(agent.sessionId);
    if (!found) return null;
    return (
      (await this.tasks.updateAgent(
        agent.id,
        { sessionPath: found },
        { touchUpdatedAt: false },
      )) ?? null
    );
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

  private forwardEvent(hostId: string, event: PiHostEvent): void {
    if (this.subscribedWebContents?.isDestroyed()) {
      this.subscribedWebContents = null;
      return;
    }
    this.subscribedWebContents?.send("pi:session:event", { hostId, event });
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

/** Let the Electron main event loop process input between CPU-heavy inspect steps. */
function yieldMain(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** Locate a PI Session JSONL by header id under ~/.pi/agent/sessions. */
async function findSessionFileById(sessionId: string): Promise<string | null> {
  const { homedir } = await import("node:os");
  const { readdir } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const root = join(homedir(), ".pi", "agent", "sessions");
  if (!(await fileExists(root))) return null;
  const needle = `_${sessionId}.jsonl`;
  try {
    const workspaces = await readdir(root, { withFileTypes: true });
    for (const dir of workspaces) {
      if (!dir.isDirectory()) continue;
      const dirPath = join(root, dir.name);
      const files = await readdir(dirPath);
      const match = files.find((name) => name.endsWith(needle) || name.includes(sessionId));
      if (match) {
        const full = join(dirPath, match);
        if (await fileExists(full)) return full;
      }
    }
  } catch {
    return null;
  }
  return null;
}
