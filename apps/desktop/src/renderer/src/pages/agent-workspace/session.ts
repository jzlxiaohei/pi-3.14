import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { createStore, reconcile, unwrap } from "solid-js/store";
import {
  applyHostState,
  applyTimelineSnapshot,
  applyTurnResult,
  beginTurnOverlay,
  createInitialTimelineState,
  reduceTimelineEvent,
  type TimelineItem,
  type TimelineState,
  type TimelineTurnResult,
} from "@/features/agent-timeline";
import type { PiHostState, PiModelOption, PiThinkingLevel } from "@pi-3.14/model";
import type {
  PiTimelineSnapshot,
  PiToolApprovalRequest,
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
  const [isReady, setIsReady] = createSignal(false);
  const [turnActive, setTurnActive] = createSignal(false);
  const [activeTaskId, setActiveTaskId] = createSignal<string | null>(null);
  const [committedItems, setCommittedItems] = createSignal<TimelineItem[]>([]);
  const [approval, setApproval] = createSignal<PiToolApprovalRequest | null>(null);
  const [models, setModels] = createSignal<PiModelOption[]>([]);
  const [thinkingLevels, setThinkingLevels] = createSignal<PiThinkingLevel[]>([]);
  const drafts = new Map<string, string>();
  const [timeline, setTimeline] = createStore<TimelineState>(createInitialTimelineState());

  const unsubscribeEvents = window.piDesktop.session.onEvent((event) => {
    if (!turnActive()) return;
    commitOverlay(reduceTimelineEvent(snapshotOverlay(), event));
  });
  const unsubscribeApproval = window.piDesktop.session.onToolApproval((request) => {
    setApproval(request);
  });
  const unsubscribeHostExit = window.piDesktop.session.onHostExited(() => {
    setIsReady(false);
    setTurnActive(false);
    setApproval(null);
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
  });

  /** Bumps when a newer activate/create supersedes an in-flight open. */
  let openGeneration = 0;

  let restored = false;
  createEffect(() => {
    if (restored || !model.bootstrapped()) return;
    restored = true;
    const selected = model.selectedTaskId();
    if (selected) void activateTask(selected);
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
    setTurnActive(false);
  }

  function rememberDraft(): void {
    const id = activeTaskId();
    if (id) drafts.set(id, draft());
  }

  function restoreDraft(taskId: string): void {
    setDraftValue(drafts.get(taskId) ?? "");
  }

  function setDraft(value: string): void {
    setDraftValue(value);
  }

  /** Prefill composer from workflow/setup/suggestions — pulse the input to draw attention. */
  function prefillDraft(value: string): void {
    setDraftValue(value);
    setDraftAttention((tick) => tick + 1);
  }

  const hostState = createMemo(() => timeline.hostState);
  const items = createMemo(() => [...committedItems(), ...timeline.items]);
  const isBusy = createMemo(
    () => turnActive() || busyStatuses.has(timeline.status.runStatus),
  );
  const status = createMemo(() => {
    const current = timeline.status;
    if (
      turnActive() &&
      current.runStatus !== "error" &&
      current.runStatus !== "aborted" &&
      !busyStatuses.has(current.runStatus)
    ) {
      return { ...current, runStatus: "streaming" as const };
    }
    return current;
  });

  async function createNewTask(): Promise<boolean> {
    return openTaskSession({});
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
  }): Promise<boolean> {
    if (isBusy()) {
      await abort();
    }
    rememberDraft();

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
      setTurnActive(false);
      setCommittedItems([]);
      setApproval(null);
      setActiveTaskId(null);

      const result = await window.piDesktop.session.create({
        cwd: pickedCwd,
        ...(options.title?.trim() ? { title: options.title.trim() } : {}),
      });
      if (generation !== openGeneration) return false;
      if (result.cancelled) {
        setIsReady(false);
        return false;
      }

      applyTaskBinding(result.task, result.state, result.timeline);
      model.upsertTask(result.task);
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
      if (generation === openGeneration) setIsCreatingSession(false);
    }
  }

  /**
   * Force re-bind so project resources (e.g. newly installed `.pi/skills`) reload.
   * Pass `draft` to keep a composer prefill across the rebind (activate restores from map).
   */
  async function rebindActiveTask(options?: { draft?: string }): Promise<boolean> {
    const taskId = activeTaskId();
    if (options?.draft !== undefined) {
      if (taskId) drafts.set(taskId, options.draft);
      prefillDraft(options.draft);
    }
    if (!taskId) return false;
    if (options?.draft === undefined) rememberDraft();
    setActiveTaskId(null);
    setIsReady(false);
    return activateTask(taskId);
  }

  async function activateTask(taskId: string): Promise<boolean> {
    if (activeTaskId() === taskId && isReady() && !isCreatingSession()) return true;
    if (isBusy()) {
      await abort();
    }
    rememberDraft();
    // Highlight immediately; do not wait on host bind (avoids list flash/reorder).
    model.selectTaskLocal(taskId);

    const generation = ++openGeneration;
    setIsCreatingSession(true);
    setIsReady(false);
    setTurnActive(false);
    setApproval(null);
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
      const result = await window.piDesktop.tasks.activate(taskId);
      if (generation !== openGeneration) return false;
      applyTaskBinding(result.task, result.state, result.timeline);
      model.upsertTask(result.task, false);
      restoreDraft(taskId);
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
      if (generation === openGeneration) setIsCreatingSession(false);
    }
  }

  function applyTaskBinding(
    task: WorkspaceTask,
    state: PiHostState,
    snapshot: PiTimelineSnapshot,
  ): void {
    setActiveTaskId(task.id);
    setCwd(task.cwd);
    setIsReady(true);
    model.selectTaskLocal(task.id);
    commitSnapshot(snapshot);
    applyHost(state);
    // Renderer remount mid-turn (e.g. Vite HMR after agent edits CSS): keep the turn live.
    if (state.isStreaming) setTurnActive(true);
    void window.piDesktop.session.getPendingApproval().then((request) => {
      if (request) setApproval(request);
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
    const taskId = activeTaskId();
    if (taskId) drafts.set(taskId, "");
    setTurnActive(true);
    commitOverlay(beginTurnOverlay(snapshotOverlay(), text));
    try {
      const result = await window.piDesktop.session.prompt(text);
      commitSnapshot(result.timeline, result);
      if (result.task) model.upsertTask(result.task, true, true);
      await refreshState();
    } catch (error) {
      setIsReady(false);
      setTurnActive(false);
      commitOverlay(
        applyTurnResult(snapshotOverlay(), {
          stopReason: "error",
          errorMessage: errorMessage(error),
        }),
      );
    }
  }

  async function abort(): Promise<void> {
    if (!isBusy()) return;
    setApproval(null);
    await window.piDesktop.session.abort().catch(() => {});
    try {
      const timelineSnapshot = await window.piDesktop.session.getTimeline();
      commitSnapshot(timelineSnapshot, { stopReason: "aborted" });
    } catch {
      commitOverlay(applyTurnResult(snapshotOverlay(), { stopReason: "aborted" }));
      setTurnActive(false);
    }
    await refreshState();
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
  }

  return {
    activeTaskId,
    approval,
    cwd,
    draft,
    draftAttention,
    hostState,
    isBusy,
    isCreatingSession,
    isReady,
    items,
    status,
    timeline,
    abort,
    activateTask,
    createNewTask,
    prefillDraft,
    rebindActiveTask,
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
    replyApproval,
    send,
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
