import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { createStore, reconcile, unwrap } from "solid-js/store";
import {
  applyHostState,
  applyTimelineSnapshot,
  applyTurnResult,
  beginContinueOverlay,
  beginTurnOverlay,
  createInitialTimelineState,
  reduceTimelineEvent,
  type TimelineItem,
  type TimelineState,
  type TimelineTurnResult,
} from "@/features/agent-timeline";
import type { PiHostState, PiModelOption, PiThinkingLevel } from "@pi-3.14/model";
import type {
  Agent,
  PiTimelineSnapshot,
  PiToolApprovalRequest,
  TaskPlaybookId,
  WorkspaceTask,
} from "../../../../shared/desktop-contracts";
import type { WorkspaceModel } from "./model";

const busyStatuses = new Set(["streaming", "compacting", "retrying"]);
const MODEL_VALUE_SEP = ":::";

export function createAgentWorkspaceSession(model: WorkspaceModel) {
  const [cwd, setCwd] = createSignal<string | null>(null);
  const [draft, setDraftValue] = createSignal("");
  /** Bumps when draft is programmatically prefilled (not user typing). */
  const [draftAttention, setDraftAttention] = createSignal(0);
  const [isCreatingSession, setIsCreatingSession] = createSignal(false);
  /** Task id being bound (Root or Child) while isCreatingSession — for sidebar spinners. */
  const [openingTaskId, setOpeningTaskId] = createSignal<string | null>(null);
  const [isReady, setIsReady] = createSignal(false);
  const [turnActive, setTurnActive] = createSignal(false);
  const [activeTaskId, setActiveTaskId] = createSignal<string | null>(null);
  const [activeAgent, setActiveAgent] = createSignal<Agent | null>(null);
  const [committedItems, setCommittedItems] = createSignal<TimelineItem[]>([]);
  const [approval, setApproval] = createSignal<PiToolApprovalRequest | null>(null);
  const [unavailableTask, setUnavailableTask] = createSignal<WorkspaceTask | null>(null);
  /** Session unlock: ask-tier tools auto-run after Allow or explicit Auto. */
  const [autoApproveUnlocked, setAutoApproveUnlocked] = createSignal(false);
  const [models, setModels] = createSignal<PiModelOption[]>([]);
  const [thinkingLevels, setThinkingLevels] = createSignal<PiThinkingLevel[]>([]);
  const drafts = new Map<string, string>();
  let draftSaveTimer: ReturnType<typeof setTimeout> | undefined;
  const [timeline, setTimeline] = createStore<TimelineState>(createInitialTimelineState());

  const unsubscribeEvents = window.piDesktop.session.onEvent((payload) => {
    // Concurrent multi-host: only paint events for the focused Agent.
    if (payload.hostId !== activeAgent()?.id) return;
    if (!turnActive()) return;
    commitOverlay(reduceTimelineEvent(snapshotOverlay(), payload.event));
  });
  const unsubscribeApproval = window.piDesktop.session.onToolApproval((request) => {
    setApproval(request);
  });
  const unsubscribeHostExit = window.piDesktop.session.onHostExited(() => {
    const taskId = activeTaskId();
    const task = taskId ? model.tasks().find((item) => item.id === taskId) : null;
    if (task?.status === "running") {
      model.upsertTask({ ...task, status: "interrupted" }, false, false);
    }
    setIsReady(false);
    endTurn();
    setApproval(null);
    setAutoApproveUnlocked(false);
    commitOverlay(
      applyTurnResult(snapshotOverlay(), {
        stopReason: "error",
        errorMessage: "PI host process exited. Send again to reconnect.",
      }),
    );
  });
  onCleanup(() => {
    unsubscribeEvents();
    unsubscribeApproval();
    unsubscribeHostExit();
    stopTurnWatch();
    clearTimeout(draftSaveTimer);
    const id = activeTaskId();
    if (id) void window.piDesktop.preferences.saveDraft(id, draft());
  });

  /** Bumps when a newer activate/create supersedes an in-flight open. */
  let openGeneration = 0;
  /** Bumps to cancel an in-flight live-turn recovery poll. */
  let liveTurnRecoveryGeneration = 0;
  let turnWatchTimer: ReturnType<typeof setTimeout> | undefined;
  /**
   * Agent ids with an in-flight prompt/continue IPC. Concurrent multi-host means
   * more than one can be open; turn-watch must only care about the focused agent.
   */
  const ipcTurnAgents = new Set<string>();

  function stopTurnWatch(): void {
    liveTurnRecoveryGeneration += 1;
    if (turnWatchTimer !== undefined) {
      clearTimeout(turnWatchTimer);
      turnWatchTimer = undefined;
    }
  }

  function focusedIpcOpen(): boolean {
    const id = activeAgent()?.id;
    return id != null && ipcTurnAgents.has(id);
  }

  /**
   * While prompt()/continueTurn() is still awaiting main IPC, the host may already
   * be idle (agent finished). Poll so the composer unlocks even if the IPC reply
   * is delayed or dropped — switching tasks used to be the only way to clear this.
   */
  function startTurnWatch(): void {
    stopTurnWatch();
    const generation = liveTurnRecoveryGeneration;
    /** Require two consecutive idle samples so brief gaps between tools do not unlock. */
    let idleHits = 0;
    const tick = async () => {
      if (generation !== liveTurnRecoveryGeneration) return;
      if (!turnActive()) {
        turnWatchTimer = undefined;
        return;
      }
      // Never soft-unlock while the focused agent's prompt/continue IPC is still open.
      // Background agents may still have in-flight IPC; ignore those.
      if (focusedIpcOpen()) {
        idleHits = 0;
        turnWatchTimer = setTimeout(() => {
          void tick();
        }, 750);
        return;
      }
      try {
        const state = await window.piDesktop.session.getState();
        if (generation !== liveTurnRecoveryGeneration || !turnActive()) return;
        if (focusedIpcOpen()) {
          idleHits = 0;
        } else {
          const hasRunningTool = snapshotOverlay().items.some(
            (item) => item.kind === "tool" && item.status === "running",
          );
          const hostIdle = !state.isStreaming && !state.isCompacting && !hasRunningTool;
          if (hostIdle) {
            idleHits += 1;
            applyHost(state);
            if (idleHits >= 2) {
              // Host settled; unlock UI. Final commitSnapshot may still arrive later.
              endTurn();
              setLocalTaskStatus("done");
              return;
            }
          } else {
            idleHits = 0;
            applyHost(state);
          }
        }
      } catch {
        // ignore transient getState failures while the turn is live
      }
      if (generation === liveTurnRecoveryGeneration && turnActive()) {
        turnWatchTimer = setTimeout(() => {
          void tick();
        }, 750);
      } else {
        turnWatchTimer = undefined;
      }
    };
    turnWatchTimer = setTimeout(() => {
      void tick();
    }, 900);
  }

  function beginTurn(): void {
    setTurnActive(true);
    startTurnWatch();
  }

  function endTurn(): void {
    setTurnActive(false);
    stopTurnWatch();
  }

  function beginIpcTurn(agentId?: string | null): void {
    if (agentId) ipcTurnAgents.add(agentId);
    beginTurn();
  }

  function endIpcTurn(agentId?: string | null): void {
    if (agentId) ipcTurnAgents.delete(agentId);
    // Only unlock UI when the focused agent has no open IPC. Background finishes
    // must not clear a still-streaming focused turn (and vice versa).
    if (!focusedIpcOpen() && turnActive()) {
      const focused = activeAgent()?.id;
      // If we just finished a background agent while focused is idle, leave focused alone
      // unless this completion was for the focused agent (or no focus id tracked).
      if (!agentId || agentId === focused) endTurn();
    }
  }

  let restored = false;
  createEffect(() => {
    if (restored || !model.bootstrapped()) return;
    restored = true;
    const active = model.activeTaskId();
    if (active) void activateTask(active);
  });

  function snapshotOverlay(): TimelineState {
    return unwrap(timeline);
  }

  function commitOverlay(next: TimelineState): void {
    setTimeline(reconcile(next));
  }

  function applyHost(state: PiHostState): void {
    commitOverlay(applyHostState(snapshotOverlay(), state));
  }

  function commitSnapshot(snapshot: PiTimelineSnapshot, result?: TimelineTurnResult): void {
    setCommittedItems(snapshot.items as TimelineItem[]);
    commitOverlay(
      applyTimelineSnapshot(
        {
          ...createInitialTimelineState(),
          hostState: snapshotOverlay().hostState,
        },
        [],
        result,
      ),
    );
    endTurn();
  }

  function draftKey(): string | null {
    return activeAgent()?.id ?? null;
  }

  async function rememberDraft(): Promise<void> {
    const id = draftKey();
    if (!id) return;
    clearTimeout(draftSaveTimer);
    drafts.set(id, draft());
    await window.piDesktop.preferences.saveDraft(id, draft());
  }

  async function restoreDraft(agentId: string): Promise<void> {
    const cached = drafts.get(agentId);
    const value = cached ?? (await window.piDesktop.preferences.getDraft(agentId).catch(() => ""));
    drafts.set(agentId, value);
    if (activeAgent()?.id === agentId || !activeAgent()) setDraftValue(value);
  }

  function persistDraftSoon(value: string): void {
    const id = draftKey();
    if (!id) return;
    drafts.set(id, value);
    clearTimeout(draftSaveTimer);
    draftSaveTimer = setTimeout(() => {
      void window.piDesktop.preferences.saveDraft(id, value);
    }, 250);
  }

  function setDraft(value: string): void {
    setDraftValue(value);
    persistDraftSoon(value);
  }

  /** Prefill composer from workflow/setup/suggestions — pulse the input to draw attention. */
  function prefillDraft(value: string): void {
    setDraftValue(value);
    persistDraftSoon(value);
    setDraftAttention((tick) => tick + 1);
  }

  const hostState = createMemo(() => timeline.hostState);
  const items = createMemo(() => [...committedItems(), ...timeline.items]);
  const isBusy = createMemo(
    () => turnActive() || busyStatuses.has(timeline.status.runStatus),
  );
  const status = createMemo(() => {
    const current = timeline.status;
    // While a host turn is in flight, surface streaming even after a prior error
    // (Retry starts from runStatus "error" and must not look idle).
    if (turnActive() && !busyStatuses.has(current.runStatus) && current.runStatus !== "aborted") {
      return { ...current, errorMessage: null, runStatus: "streaming" as const };
    }
    return current;
  });

  async function createNewTask(options?: {
    playbookId?: TaskPlaybookId | null;
  }): Promise<boolean> {
    return openTaskSession({
      ...(options?.playbookId ? { playbookId: options.playbookId } : {}),
    });
  }

  /**
   * Open a dedicated extract session in the same workspace cwd, then send the
   * extract prompt (separate task — does not append to the source chat).
   */
  async function startExtractTask(options: {
    cwd: string;
    title: string;
    prompt: string;
  }): Promise<boolean> {
    const ok = await openTaskSession({
      cwd: options.cwd,
      title: options.title,
    });
    if (!ok) return false;
    prefillDraft(options.prompt);
    await send();
    return true;
  }

  async function openTaskSession(options: {
    cwd?: string | null;
    title?: string;
    playbookId?: TaskPlaybookId | null;
  }): Promise<boolean> {
    // Do not abort other concurrent hosts when opening a new Task.
    await rememberDraft();

    let pickedCwd: string | null = options.cwd?.trim() || null;
    const generation = ++openGeneration;
    try {
      if (!pickedCwd) {
        const pick = await window.piDesktop.session.pickWorkspace();
        if (pick.cancelled) return false;
        if (generation !== openGeneration) return false;
        pickedCwd = pick.cwd;
      }
      setCwd(pickedCwd);
      setIsReady(false);
      setIsCreatingSession(true);
      endTurn();
      setCommittedItems([]);
      setApproval(null);
      setAutoApproveUnlocked(false);
      setActiveTaskId(null);
      setActiveAgent(null);
      setUnavailableTask(null);

      const result = await window.piDesktop.session.create({
        cwd: pickedCwd,
        ...(options.title?.trim() ? { title: options.title.trim() } : {}),
        ...(options.playbookId ? { playbookId: options.playbookId } : {}),
      });
      if (result.cancelled) {
        if (generation === openGeneration) setIsReady(false);
        return false;
      }

      // Create already persisted on main — always mirror into the sidebar even if a
      // newer activate/create superseded this open (otherwise "New task · …" never appears).
      const stillCurrent = generation === openGeneration;
      model.upsertTask(result.task, stillCurrent);
      if (!stillCurrent) return false;

      applyTaskBinding(result.task, result.state, result.timeline, result.agent);
      await restoreDraft(result.agent.id);
      return true;
    } catch (error) {
      if (generation !== openGeneration) return false;
      setIsReady(false);
      if (pickedCwd) setCwd(pickedCwd);
      commitOverlay(
        applyTurnResult(snapshotOverlay(), {
          stopReason: "error",
          errorMessage: errorMessage(error),
        }),
      );
      return false;
    } finally {
      if (generation === openGeneration) {
        setIsCreatingSession(false);
        setOpeningTaskId(null);
      }
    }
  }

  /**
   * @deprecated Step Agents are created by `agents.advanceWorkflow` / `ensureStepAgent`.
   * Kept as a no-op so old call sites fail closed instead of inventing Child Tasks.
   */
  async function openWorkflowStepSession(_options: {
    parentTaskId: string;
    cwd: string;
    title: string;
  }): Promise<string | null> {
    return null;
  }

  async function activateAgent(
    agentId: string,
    options?: { force?: boolean },
  ): Promise<boolean> {
    // Switching focus must not abort a background host that is still streaming.
    await rememberDraft();
    const generation = ++openGeneration;
    setIsCreatingSession(true);
    setOpeningTaskId(agentId);
    setIsReady(false);
    endTurn();
    try {
      const result = await window.piDesktop.agents.activate(
        agentId,
        options?.force ? { force: true } : undefined,
      );
      if (generation !== openGeneration) return false;
      if (!result.ok) {
        applyUnavailableAgent(result.task, result.agent);
        return false;
      }
      applyTaskBinding(result.task, result.state, result.timeline, result.agent);
      model.upsertTask(result.task, false);
      await restoreDraft(result.agent.id);
      return true;
    } catch (error) {
      if (generation !== openGeneration) return false;
      setIsReady(false);
      commitOverlay(
        applyTurnResult(snapshotOverlay(), {
          stopReason: "error",
          errorMessage: errorMessage(error),
        }),
      );
      return false;
    } finally {
      if (generation === openGeneration) {
        setIsCreatingSession(false);
        setOpeningTaskId(null);
      }
    }
  }

  function setActiveAgentLocal(agent: Agent | null): void {
    setActiveAgent(agent);
  }

  /**
   * Force re-bind so project resources (e.g. newly installed `.pi/skills`) reload.
   * Pass `draft` to keep a composer prefill across the rebind (activate restores from map).
   * `quiet`: recreate host without blanking timeline / ready (skill filter toggles).
   * `waitForIdle`: with quiet, do not abort a running turn — return false if busy (Role Prompt path).
   */
  async function rebindActiveTask(options?: {
    draft?: string;
    quiet?: boolean;
    waitForIdle?: boolean;
  }): Promise<boolean> {
    const agentId = activeAgent()?.id ?? null;
    const taskId = activeTaskId();
    if (options?.draft !== undefined) {
      if (agentId) drafts.set(agentId, options.draft);
      prefillDraft(options.draft);
    }
    if (!agentId && !taskId) return false;
    if (options?.draft === undefined) await rememberDraft();

    if (options?.quiet && agentId) {
      if (isBusy()) {
        if (options.waitForIdle) return false;
        await abort();
      }
      try {
        const result = await window.piDesktop.agents.activate(agentId, { force: true });
        if (!result.ok) {
          applyUnavailableAgent(result.task, result.agent);
          return false;
        }
        applyTaskBinding(result.task, result.state, result.timeline, result.agent);
        model.upsertTask(result.task, false);
        await restoreDraft(result.agent.id);
        return true;
      } catch {
        return false;
      }
    }

    if (agentId) {
      setIsReady(false);
      return activateAgent(agentId, { force: true });
    }
    if (!taskId) return false;
    setActiveTaskId(null);
    setIsReady(false);
    return activateTask(taskId, { force: true });
  }

  /** Role Prompt rebind: wait out running turns; never abort solely to apply prompt. */
  const [pendingRolePromptAgentId, setPendingRolePromptAgentId] = createSignal<string | null>(
    null,
  );
  let rolePromptRebindWaiters: Array<() => void> = [];

  function settleRolePromptRebindWaiters(): void {
    const waiters = rolePromptRebindWaiters;
    rolePromptRebindWaiters = [];
    for (const resolve of waiters) resolve();
  }

  function clearPendingRolePromptRebind(): void {
    setPendingRolePromptAgentId(null);
    settleRolePromptRebindWaiters();
  }

  async function runQuietRolePromptRebind(): Promise<void> {
    await rebindActiveTask({ quiet: true, waitForIdle: true });
    settleRolePromptRebindWaiters();
  }

  async function scheduleRolePromptRebind(): Promise<void> {
    const agent = activeAgent();
    if (!agent || !isReady()) return;
    if (isBusy()) {
      setPendingRolePromptAgentId(agent.id);
      await new Promise<void>((resolve) => {
        rolePromptRebindWaiters.push(resolve);
      });
      return;
    }
    setPendingRolePromptAgentId(null);
    await runQuietRolePromptRebind();
  }

  createEffect(() => {
    const expectedId = pendingRolePromptAgentId();
    if (!expectedId) return;
    if (isBusy() || isCreatingSession() || !isReady()) return;
    const agentId = activeAgent()?.id;
    if (agentId !== expectedId) {
      // Active Agent changed before idle rebind — drop (caller already persisted Role Prompt).
      clearPendingRolePromptRebind();
      return;
    }
    setPendingRolePromptAgentId(null);
    void runQuietRolePromptRebind();
  });

  // Drop deferred Role Prompt rebind when session unbinds / becomes not ready.
  createEffect(() => {
    if (isReady()) return;
    if (!pendingRolePromptAgentId()) return;
    clearPendingRolePromptRebind();
  });

  /** Sidebar selection = Task id (never Agent id). */
  function resolveSidebarTaskId(taskId: string): string | null {
    const known = model.tasks().find((task) => task.id === taskId);
    if (known) return known.id;
    return model.selectedTaskId();
  }

  async function activateTask(
    taskId: string,
    options?: { force?: boolean },
  ): Promise<boolean> {
    // Sidebar Task row click while already in a step Agent under this Task:
    // only re-highlight the Task — do not jump to playbook cursor (often step 1).
    const currentAgent = activeAgent();
    if (
      !options?.force &&
      currentAgent?.taskId === taskId &&
      !isCreatingSession() &&
      (isReady() || unavailableTask()?.id === taskId)
    ) {
      model.selectTaskLocal(taskId);
      setActiveTaskId(taskId);
      return true;
    }
    if (
      !options?.force &&
      activeTaskId() === taskId &&
      isReady() &&
      !isCreatingSession()
    ) {
      model.selectTaskLocal(taskId);
      return true;
    }
    // Concurrent multi-host: switch focus without aborting the previous Task's stream.
    await rememberDraft();
    // Sidebar selection is always the Task shell id (Agents are nested step rows).
    const sidebarId = resolveSidebarTaskId(taskId);
    if (sidebarId) model.selectTaskLocal(sidebarId);

    const generation = ++openGeneration;
    setIsCreatingSession(true);
    setOpeningTaskId(taskId);
    setIsReady(false);
    endTurn();
    setApproval(null);
    setAutoApproveUnlocked(false);
    setCommittedItems([]);
    setActiveTaskId(null);
    commitOverlay(
      applyTimelineSnapshot(
        {
          ...createInitialTimelineState(),
          hostState: snapshotOverlay().hostState,
        },
        [],
      ),
    );

    try {
      const result = await window.piDesktop.tasks.activate(
        taskId,
        options?.force ? { force: true } : undefined,
      );
      if (generation !== openGeneration) return false;
      if (!result.ok) {
        applyUnavailableAgent(result.task, result.agent);
        return false;
      }
      applyTaskBinding(result.task, result.state, result.timeline, result.agent);
      model.upsertTask(result.task, false);
      await restoreDraft(result.agent.id);
      return true;
    } catch (error) {
      if (generation !== openGeneration) return false;
      setIsReady(false);
      const message = errorMessage(error);
      // Stale selectedTaskId after store prune — drop highlight instead of looping on ghost tasks.
      if (message.startsWith("Unknown task:")) {
        model.selectTaskLocal(null);
        setActiveTaskId(null);
        setActiveAgent(null);
        const fallback = model.tasks().find((task) => task.id !== taskId)?.id;
        if (fallback) {
          setIsCreatingSession(false);
          setOpeningTaskId(null);
          return activateTask(fallback);
        }
      }
      commitOverlay(
        applyTurnResult(snapshotOverlay(), {
          stopReason: "error",
          errorMessage: message,
        }),
      );
      return false;
    } finally {
      if (generation === openGeneration) {
        setIsCreatingSession(false);
        setOpeningTaskId(null);
      }
    }
  }

  function applyUnavailableAgent(task: WorkspaceTask, agent: Agent): void {
    setActiveTaskId(task.id);
    setActiveAgent(agent);
    setCwd(task.cwd);
    setIsReady(false);
    setUnavailableTask(task);
    model.upsertTask(task, true, false);
    model.selectTaskLocal(task.id);
    commitOverlay(
      applyTurnResult(snapshotOverlay(), {
        stopReason: "error",
        errorMessage: "The PI Session file for this Agent is unavailable.",
      }),
    );
    void restoreDraft(agent.id);
  }

  function applyTaskBinding(
    task: WorkspaceTask,
    state: PiHostState,
    snapshot: PiTimelineSnapshot,
    agent?: Agent | null,
  ): void {
    setActiveTaskId(task.id);
    if (agent) setActiveAgent(agent);
    setCwd(task.cwd);
    setIsReady(true);
    setUnavailableTask(null);
    model.selectTaskLocal(task.id);
    void model.refreshAgents(task.id);
    commitSnapshot(snapshot);
    applyHost(state);
    // Renderer remount mid-turn (e.g. Vite HMR after agent edits CSS): keep the turn live.
    if (state.isStreaming || state.isCompacting) beginTurn();
    void window.piDesktop.session.getPendingApproval().then((request) => {
      if (request) setApproval(request);
    });
    void window.piDesktop.session.getAutoApprove().then((result) => {
      setAutoApproveUnlocked(result.unlocked);
    }).catch(() => {
      setAutoApproveUnlocked(false);
    });
    void refreshModelControls();
  }

  async function refreshModelControls(): Promise<void> {
    try {
      const [nextModels, nextLevels] = await Promise.all([
        window.piDesktop.session.listModels(),
        window.piDesktop.session.listThinkingLevels(),
      ]);
      setModels(nextModels);
      setThinkingLevels(nextLevels);
    } catch {
      setModels([]);
      setThinkingLevels([]);
    }
  }

  async function setModel(value: string): Promise<void> {
    const [provider, modelId] = value.split(MODEL_VALUE_SEP);
    if (!provider || !modelId || !isReady()) return;
    const state = await window.piDesktop.session.setModel({ provider, modelId });
    applyHost(state);
    setThinkingLevels(await window.piDesktop.session.listThinkingLevels().catch(() => []));
  }

  async function setThinkingLevel(level: string): Promise<void> {
    if (!isReady()) return;
    const state = await window.piDesktop.session.setThinkingLevel(level as PiThinkingLevel);
    applyHost(state);
  }

  async function ensureSession(): Promise<boolean> {
    if (isReady() && activeTaskId()) return true;
    const taskId = activeTaskId() ?? model.selectedTaskId();
    if (taskId) return activateTask(taskId);
    return createNewTask();
  }

  function setLocalTaskStatus(
    status: WorkspaceTask["status"],
    taskId?: string | null,
  ): void {
    const id = taskId ?? activeTaskId();
    const task = id ? model.tasks().find((item) => item.id === id) : null;
    if (task) model.upsertTask({ ...task, status }, false, false);
  }

  async function refreshState(): Promise<void> {
    try {
      const state = await window.piDesktop.session.getState();
      applyHost(state);
      setIsReady(true);
    } catch {
      setIsReady(false);
    }
  }

  async function send(): Promise<void> {
    const text = draft().trim();
    if (!text || isBusy() || isCreatingSession()) return;
    if (!(await ensureSession())) return;

    setDraft("");
    const sendAgentId = activeAgent()?.id ?? draftKey();
    const sendTaskId = activeTaskId();
    if (sendAgentId) {
      drafts.set(sendAgentId, "");
      void window.piDesktop.preferences.saveDraft(sendAgentId, "");
    }
    beginIpcTurn(sendAgentId);
    setLocalTaskStatus("running", sendTaskId);
    commitOverlay(beginTurnOverlay(snapshotOverlay(), text));
    try {
      const result = await window.piDesktop.session.prompt(
        text,
        sendAgentId ? { agentId: sendAgentId } : undefined,
      );
      // Always refresh catalog rows for the agent that ran (may be background now).
      if (result.task) model.upsertTask(result.task, false, true);
      const stillFocused = activeAgent()?.id === sendAgentId;
      if (stillFocused) {
        commitSnapshot(result.timeline, result);
        if (result.agent) {
          setActiveAgent(result.agent);
        } else {
          // Host confirm-on-first-send may have updated the row even if agent is omitted.
          const current = activeAgent();
          if (current && current.rolePromptConfirmedAt == null) {
            const refreshed = await window.piDesktop.agents
              .list(current.taskId)
              .then((list) => list.find((a) => a.id === current.id) ?? null)
              .catch(() => null);
            if (refreshed) setActiveAgent(refreshed);
          }
        }
        await refreshState();
        // Belt-and-suspenders: host may still report a stale busy flag for one tick.
        if (!turnActive()) {
          const host = snapshotOverlay().hostState;
          if (host && !host.isStreaming && !host.isCompacting) {
            applyHost(host);
          }
        }
      }
      // Background finish while another Agent is focused: leave that UI alone.
    } catch (error) {
      setLocalTaskStatus("error", sendTaskId);
      if (activeAgent()?.id === sendAgentId) {
        setIsReady(false);
        commitOverlay(
          applyTurnResult(snapshotOverlay(), {
            stopReason: "error",
            errorMessage: errorMessage(error),
          }),
        );
        endTurn();
      }
    } finally {
      endIpcTurn(sendAgentId);
    }
  }

  /**
   * Run a prompt on the active session without using the composer draft.
   * Returns the latest assistant text after the turn settles, or null on failure.
   * Used for workflow step handoff generation (ADR-0003).
   */
  async function promptForResult(text: string): Promise<string | null> {
    const trimmed = text.trim();
    if (!trimmed || isBusy() || isCreatingSession()) return null;
    if (!(await ensureSession())) return null;

    const sendAgentId = activeAgent()?.id ?? null;
    const sendTaskId = activeTaskId();
    beginIpcTurn(sendAgentId);
    setLocalTaskStatus("running", sendTaskId);
    commitOverlay(beginTurnOverlay(snapshotOverlay(), trimmed));
    try {
      const result = await window.piDesktop.session.prompt(
        trimmed,
        sendAgentId ? { agentId: sendAgentId } : undefined,
      );
      if (result.task) model.upsertTask(result.task, false, true);
      const stillFocused = activeAgent()?.id === sendAgentId;
      if (stillFocused) {
        commitSnapshot(result.timeline, result);
        if (result.agent) setActiveAgent(result.agent);
        await refreshState();
        if (!turnActive()) {
          const host = snapshotOverlay().hostState;
          if (host && !host.isStreaming && !host.isCompacting) {
            applyHost(host);
          }
        }
      }
      if (result.stopReason === "error" || result.stopReason === "aborted") {
        return null;
      }
      return lastAssistantText(result.timeline.items);
    } catch {
      setLocalTaskStatus("error", sendTaskId);
      if (activeAgent()?.id === sendAgentId) {
        setIsReady(false);
        commitOverlay(
          applyTurnResult(snapshotOverlay(), {
            stopReason: "error",
            errorMessage: "Handoff generation failed",
          }),
        );
        endTurn();
      }
      return null;
    } finally {
      endIpcTurn(sendAgentId);
    }
  }

  function lastAssistantText(
    list: { kind: string; text?: string }[],
  ): string | null {
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const item = list[i];
      if (item?.kind === "assistant" && typeof item.text === "string" && item.text.trim()) {
        return item.text.trim();
      }
    }
    return null;
  }

  async function abort(): Promise<void> {
    if (!isBusy()) return;
    const agentId = activeAgent()?.id;
    setApproval(null);
    await window.piDesktop.session
      .abort(agentId ? { agentId } : undefined)
      .catch(() => {});
    setLocalTaskStatus("idle");
    try {
      const timelineSnapshot = await window.piDesktop.session.getTimeline();
      commitSnapshot(timelineSnapshot, { stopReason: "aborted" });
    } catch {
      commitOverlay(applyTurnResult(snapshotOverlay(), { stopReason: "aborted" }));
      endTurn();
    }
    await refreshState();
  }

  /**
   * Cursor-style Revert: only while the latest turn is still in flight.
   * Abort first. Navigate + restore composer only when the latest user already
   * has assistant/tool output — otherwise Revert equals Stop (keeps the new
   * branch leaf so siblings do not vanish from chat).
   *
   * Important: use JSONL/timeline entry ids after abort — overlay user bubbles
   * use synthetic `user-<ts>-…` ids that do not exist in SessionManager.
   */
  async function revert(): Promise<boolean> {
    if (!isReady() || isCreatingSession() || !isBusy()) return false;
    await abort();
    let timelineSnapshot: PiTimelineSnapshot;
    try {
      timelineSnapshot = await window.piDesktop.session.getTimeline();
    } catch {
      return false;
    }
    commitSnapshot(timelineSnapshot, { stopReason: "aborted" });
    let latestUserIndex = -1;
    for (let i = timelineSnapshot.items.length - 1; i >= 0; i -= 1) {
      if (timelineSnapshot.items[i]?.kind === "user") {
        latestUserIndex = i;
        break;
      }
    }
    if (latestUserIndex < 0) return true;
    const latestUser = timelineSnapshot.items[latestUserIndex]!;
    if (latestUser.kind !== "user") return true;
    const hasModelOutput = timelineSnapshot.items
      .slice(latestUserIndex + 1)
      .some((item) => item.kind === "assistant" || item.kind === "tool");
    if (!hasModelOutput) return true;
    const ok = await navigateTree({ entryId: latestUser.id });
    if (ok) prefillDraft(latestUser.text);
    return ok;
  }

  /**
   * Retry the latest user turn via agent.continue() — no new user entry, no
   * tree navigate. Host strips trailing failed assistants from agent state only
   * (same as PI auto-retry) so the Session leaf / active path stays put.
   */
  async function continueTurn(): Promise<boolean> {
    if (!isReady() || isCreatingSession() || isBusy()) return false;
    if (!latestRetryableUser()) return false;
    const sendAgentId = activeAgent()?.id ?? null;
    const sendTaskId = activeTaskId();
    beginIpcTurn(sendAgentId);
    setLocalTaskStatus("running", sendTaskId);
    // Immediate Waiting… chrome (send() does the same via beginTurnOverlay).
    commitOverlay(beginContinueOverlay(snapshotOverlay()));
    try {
      const result = await window.piDesktop.session.continueTurn(
        sendAgentId ? { agentId: sendAgentId } : undefined,
      );
      if (result.task) model.upsertTask(result.task, false, true);
      if (activeAgent()?.id === sendAgentId) {
        commitSnapshot(result.timeline, result);
        if (result.agent) setActiveAgent(result.agent);
        await refreshState();
      }
      // Retry ran even if the model failed again — detail stays on the error bubble.
      return true;
    } catch (error) {
      setLocalTaskStatus("error", sendTaskId);
      if (activeAgent()?.id !== sendAgentId) {
        return false;
      }
      try {
        const timelineSnapshot = await window.piDesktop.session.getTimeline();
        commitSnapshot(timelineSnapshot, {
          stopReason: "error",
          errorMessage: errorMessage(error),
        });
      } catch {
        commitOverlay(
          applyTurnResult(snapshotOverlay(), {
            stopReason: "error",
            errorMessage: errorMessage(error),
          }),
        );
        endTurn();
      }
      return false;
    } finally {
      endIpcTurn(sendAgentId);
    }
  }

  /**
   * Switch active path or edit/branch by navigating the in-file session tree.
   * When `promptText` is set: navigate first (UI switches off the old branch),
   * then send a normal turn so overlay ids stay synthetic only for the new send.
   *
   * Latest unanswered user:
   * - same text → continueTurn() (no new user entry)
   * - edited text → navigate(parent)+prompt (JSONL sibling is unavoidable;
   *   product treats this as amend; Branches UI hides childless abandoned siblings)
   */
  async function navigateTree(request: {
    entryId: string;
    promptText?: string;
    summarize?: boolean;
  }): Promise<boolean> {
    if (!isReady()) return false;
    if (isBusy()) await abort();
    const resend = request.promptText?.trim() ?? "";
    const retryable = latestRetryableUser();
    if (
      resend &&
      retryable &&
      retryable.id === request.entryId &&
      retryable.text.trim() === resend
    ) {
      return continueTurn();
    }
    try {
      const result = await window.piDesktop.session.navigate({
        entryId: request.entryId,
        ...(request.summarize ? { summarize: true } : {}),
      });
      if (result.cancelled) {
        endTurn();
        return false;
      }
      commitSnapshot(result.timeline);
      await refreshState();
      if (!resend) return true;

      setDraft("");
      const sendAgentId = activeAgent()?.id ?? null;
      const sendTaskId = activeTaskId();
      if (sendAgentId) drafts.set(sendAgentId, "");
      beginIpcTurn(sendAgentId);
      setLocalTaskStatus("running", sendTaskId);
      commitOverlay(beginTurnOverlay(snapshotOverlay(), resend));
      try {
        const promptResult = await window.piDesktop.session.prompt(
          resend,
          sendAgentId ? { agentId: sendAgentId } : undefined,
        );
        if (promptResult.task) model.upsertTask(promptResult.task, false, true);
        if (activeAgent()?.id === sendAgentId) {
          commitSnapshot(promptResult.timeline, promptResult);
          await refreshState();
        }
        return true;
      } finally {
        endIpcTurn(sendAgentId);
      }
    } catch (error) {
      endIpcTurn();
      setLocalTaskStatus("error");
      commitOverlay(
        applyTurnResult(snapshotOverlay(), {
          stopReason: "error",
          errorMessage: errorMessage(error),
        }),
      );
      return false;
    }
  }

  /**
   * Latest user that can be retried without forking:
   * - nothing after it, or
   * - only failed/aborted assistants on the path after it (Connection error chain).
   */
  function latestRetryableUser(): { id: string; text: string } | null {
    const list = items();
    let latestUserIndex = -1;
    for (let i = list.length - 1; i >= 0; i -= 1) {
      if (list[i]?.kind === "user") {
        latestUserIndex = i;
        break;
      }
    }
    if (latestUserIndex < 0) return null;
    const user = list[latestUserIndex]!;
    if (user.kind !== "user") return null;
    const after = list.slice(latestUserIndex + 1);
    if (after.length === 0) return { id: user.id, text: user.text };
    if (!after.every(isFailedOnlyTimelineItem)) return null;
    return { id: user.id, text: user.text };
  }

  function replyApproval(approved: boolean): void {
    const request = approval();
    if (!request) return;
    window.piDesktop.session.replyToolApproval({
      id: request.id,
      approved,
      ...(approved ? {} : { reason: "Denied by user" }),
    });
    setApproval(null);
    // Host unlocks the binding on the first Allow; mirror that in the Composer toggle.
    if (approved) setAutoApproveUnlocked(true);
  }

  async function setAutoApprove(unlocked: boolean): Promise<void> {
    if (!isReady()) return;
    const result = await window.piDesktop.session.setAutoApprove(unlocked);
    setAutoApproveUnlocked(result.unlocked);
  }

  /** Soft-delete: hide from default sidebar; session JSONL stays on disk. */
  async function archiveTask(taskId: string): Promise<boolean> {
    const wasSelected =
      model.selectedTaskId() === taskId || activeTaskId() === taskId;
    if (wasSelected && isBusy()) {
      await abort();
    }
    await rememberDraft();
    const generation = ++openGeneration;
    try {
      const result = await window.piDesktop.tasks.archive(taskId);
      if (generation !== openGeneration) return false;
      model.replaceTasks(result.tasks ?? result.rootTasks, result.activeTaskId, result.activeTaskId);

      if (!result.disposed && !wasSelected) return true;

      setApproval(null);
      endTurn();
      setCommittedItems([]);
      setActiveTaskId(null);
      setUnavailableTask(null);
      setIsReady(false);
      commitOverlay(
        applyTimelineSnapshot(
          {
            ...createInitialTimelineState(),
            hostState: snapshotOverlay().hostState,
          },
          [],
        ),
      );

      if (result.activeTaskId) {
        setIsCreatingSession(false);
        return activateTask(result.activeTaskId);
      }

      setCwd(null);
      return true;
    } catch (error) {
      if (generation !== openGeneration) return false;
      commitOverlay(
        applyTurnResult(snapshotOverlay(), {
          stopReason: "error",
          errorMessage: errorMessage(error),
        }),
      );
      return false;
    }
  }

  async function unarchiveTask(taskId: string): Promise<boolean> {
    try {
      const result = await window.piDesktop.tasks.unarchive(taskId);
      model.replaceTasks(result.tasks ?? result.rootTasks, result.activeTaskId, result.activeTaskId);
      return true;
    } catch (error) {
      commitOverlay(
        applyTurnResult(snapshotOverlay(), {
          stopReason: "error",
          errorMessage: errorMessage(error),
        }),
      );
      return false;
    }
  }

  async function relinkUnavailableTask(): Promise<boolean> {
    const task = unavailableTask();
    const agent = activeAgent();
    if (!task || !agent) return false;
    const result = await window.piDesktop.agents.relink(agent.id);
    if (!result.ok) {
      if (!result.cancelled) {
        commitOverlay(
          applyTurnResult(snapshotOverlay(), {
            stopReason: "error",
            errorMessage: result.error,
          }),
        );
      }
      return false;
    }
    setActiveAgent(result.agent);
    return activateAgent(result.agent.id, { force: true });
  }

  /** Force-bind a new PI Session onto the same Agent (keeps Task link). */
  async function replaceUnavailableTask(): Promise<boolean> {
    const agent = activeAgent();
    if (agent) {
      return activateAgent(agent.id, { force: true });
    }
    const task = unavailableTask();
    if (!task) return false;
    return activateTask(task.id, { force: true });
  }

  return {
    activeTaskId,
    activeAgent,
    approval,
    autoApproveUnlocked,
    cwd,
    draft,
    draftAttention,
    hostState,
    isBusy,
    isCreatingSession,
    openingTaskId,
    isReady,
    items,
    status,
    timeline,
    unavailableTask,
    abort,
    activateTask,
    activateAgent,
    setActiveAgentLocal,
    archiveTask,
    unarchiveTask,
    canRetryLatest: createMemo(
      () =>
        isReady() &&
        !isCreatingSession() &&
        !isBusy() &&
        latestRetryableUser() !== null,
    ),
    continueTurn,
    createNewTask,
    openWorkflowStepSession,
    prefillDraft,
    promptForResult,
    rebindActiveTask,
    scheduleRolePromptRebind,
    relinkUnavailableTask,
    replaceUnavailableTask,
    revert,
    startExtractTask,
    modelLabel: createMemo(() => {
      const modelRef = hostState()?.model;
      return modelRef ? `${modelRef.provider}/${modelRef.id}` : "PI model";
    }),
    modelOptions: createMemo(() =>
      models().map((item) => ({
        label: item.name ? `${item.provider}/${item.id} · ${item.name}` : `${item.provider}/${item.id}`,
        value: `${item.provider}${MODEL_VALUE_SEP}${item.id}`,
      })),
    ),
    modelValue: createMemo(() => {
      const modelRef = hostState()?.model;
      return modelRef ? `${modelRef.provider}${MODEL_VALUE_SEP}${modelRef.id}` : null;
    }),
    navigateTree,
    replyApproval,
    send,
    setAutoApprove,
    setDraft,
    setModel,
    setThinkingLevel,
    thinkingLabel: createMemo(() => `thinking: ${hostState()?.thinkingLevel ?? "unknown"}`),
    thinkingOptions: createMemo(() =>
      thinkingLevels().map((level) => ({
        label: level,
        value: level,
      })),
    ),
    thinkingValue: createMemo(() => hostState()?.thinkingLevel ?? null),
    workspaceLabel: createMemo(() => workspaceLabel(cwd(), isCreatingSession(), isReady())),
    workspaceTitle: createMemo(() => cwd() ?? "Choose a local workspace folder"),
  };
}

export type AgentWorkspaceSession = ReturnType<typeof createAgentWorkspaceSession>;

function workspaceLabel(value: string | null, creating: boolean, ready: boolean): string {
  if (creating) return "Starting session…";
  if (!value) return "Choose workspace";
  const name = value.split(/[\\/]/).filter(Boolean).at(-1) ?? value;
  return ready ? name : `${name} (not ready)`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Assistant/tool after a user that do not count as a successful reply (retry OK). */
function isFailedOnlyTimelineItem(item: {
  kind: string;
  text?: string;
  thinking?: string;
  stopReason?: string | null;
  errorMessage?: string;
  status?: string;
}): boolean {
  if (item.kind === "tool") {
    // Any tool activity means the turn progressed — don't treat as pure retry-from-user.
    return false;
  }
  if (item.kind !== "assistant") return false;
  const failed =
    item.stopReason === "error" ||
    item.stopReason === "aborted" ||
    Boolean(item.errorMessage?.trim());
  if (!failed) return false;
  // Empty failed bubbles always retryable; rare partial text + error still retryable.
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
