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
  /** Task id being bound (Root or Child) while isCreatingSession — for sidebar spinners. */
  const [openingTaskId, setOpeningTaskId] = createSignal<string | null>(null);
  const [isReady, setIsReady] = createSignal(false);
  const [turnActive, setTurnActive] = createSignal(false);
  const [activeTaskId, setActiveTaskId] = createSignal<string | null>(null);
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

  const unsubscribeEvents = window.piDesktop.session.onEvent((event) => {
    if (!turnActive()) return;
    commitOverlay(reduceTimelineEvent(snapshotOverlay(), event));
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
    setTurnActive(false);
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
    clearTimeout(draftSaveTimer);
    const id = activeTaskId();
    if (id) void window.piDesktop.preferences.saveDraft(id, draft());
  });

  /** Bumps when a newer activate/create supersedes an in-flight open. */
  let openGeneration = 0;
  /** Bumps to cancel an in-flight live-turn recovery poll. */
  let liveTurnRecoveryGeneration = 0;

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
    setTurnActive(false);
  }

  async function rememberDraft(): Promise<void> {
    const id = activeTaskId();
    if (!id) return;
    clearTimeout(draftSaveTimer);
    drafts.set(id, draft());
    await window.piDesktop.preferences.saveDraft(id, draft());
  }

  async function restoreDraft(taskId: string): Promise<void> {
    const cached = drafts.get(taskId);
    const value = cached ?? (await window.piDesktop.preferences.getDraft(taskId).catch(() => ""));
    drafts.set(taskId, value);
    if (activeTaskId() === taskId) setDraftValue(value);
  }

  function persistDraftSoon(value: string): void {
    const id = activeTaskId();
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

  async function createNewTask(options?: {
    appendSystemPrompts?: string[];
  }): Promise<boolean> {
    return openTaskSession({
      ...(options?.appendSystemPrompts?.length
        ? { appendSystemPrompts: options.appendSystemPrompts }
        : {}),
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
    parentTaskId?: string | null;
    appendSystemPrompts?: string[];
  }): Promise<boolean> {
    if (isBusy()) {
      await abort();
    }
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
      setTurnActive(false);
      setCommittedItems([]);
      setApproval(null);
      setAutoApproveUnlocked(false);
      setActiveTaskId(null);

      const result = await window.piDesktop.session.create({
        cwd: pickedCwd,
        ...(options.title?.trim() ? { title: options.title.trim() } : {}),
        ...(options.parentTaskId ? { parentTaskId: options.parentTaskId } : {}),
        ...(options.appendSystemPrompts?.length
          ? { appendSystemPrompts: options.appendSystemPrompts }
          : {}),
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

      applyTaskBinding(result.task, result.state, result.timeline);
      await restoreDraft(result.task.id);
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
   * Spawn a Child Task + new PI Session for a workflow step (subagent unit).
   * Returns the new task id, or null on failure.
   */
  async function openWorkflowStepSession(options: {
    parentTaskId: string;
    cwd: string;
    title: string;
    rolePrompt: string;
  }): Promise<string | null> {
    const ok = await openTaskSession({
      cwd: options.cwd,
      title: options.title,
      parentTaskId: options.parentTaskId,
      appendSystemPrompts: [options.rolePrompt],
    });
    if (!ok) return null;
    return activeTaskId();
  }

  /**
   * Force re-bind so project resources (e.g. newly installed `.pi/skills`) reload.
   * Pass `draft` to keep a composer prefill across the rebind (activate restores from map).
   * `quiet`: recreate host without blanking timeline / ready (skill filter toggles).
   */
  async function rebindActiveTask(options?: {
    draft?: string;
    quiet?: boolean;
  }): Promise<boolean> {
    const taskId = activeTaskId();
    if (options?.draft !== undefined) {
      if (taskId) drafts.set(taskId, options.draft);
      prefillDraft(options.draft);
    }
    if (!taskId) return false;
    if (options?.draft === undefined) await rememberDraft();

    if (options?.quiet) {
      if (isBusy()) await abort();
      try {
        const result = await window.piDesktop.tasks.activate(taskId, { force: true });
        if (!result.ok) {
          applyUnavailableTask(result.task);
          return false;
        }
        setActiveTaskId(result.task.id);
        setCwd(result.task.cwd);
        setIsReady(true);
        model.selectTaskLocal(result.task.rootTaskId);
        model.upsertTask(result.task, false);
        commitSnapshot(result.timeline);
        applyHost(result.state);
        await restoreDraft(taskId);
        return true;
      } catch {
        return false;
      }
    }

    setActiveTaskId(null);
    setIsReady(false);
    return activateTask(taskId, { force: true });
  }

  /** Sidebar selection anchor for a Task id (Root list or workflow-bound Child). */
  function resolveSidebarRootId(taskId: string): string | null {
    const known = model.tasks().find((task) => task.id === taskId);
    if (known) return known.rootTaskId;
    for (const root of model.tasks()) {
      if (root.workflow?.steps.some((step) => step.taskId === taskId)) {
        return root.rootTaskId;
      }
    }
    return model.selectedTaskId();
  }

  async function activateTask(
    taskId: string,
    options?: { force?: boolean },
  ): Promise<boolean> {
    if (
      !options?.force &&
      activeTaskId() === taskId &&
      isReady() &&
      !isCreatingSession()
    ) {
      return true;
    }
    if (isBusy()) {
      await abort();
    }
    await rememberDraft();
    // Highlight Root immediately. Child Tasks are not in the sidebar list —
    // never set selectedTaskId to a Child id (CONTEXT: sidebar selection = Root ancestor).
    const rootId = resolveSidebarRootId(taskId);
    if (rootId) model.selectTaskLocal(rootId);

    const generation = ++openGeneration;
    setIsCreatingSession(true);
    setOpeningTaskId(taskId);
    setIsReady(false);
    setTurnActive(false);
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
        applyUnavailableTask(result.task);
        return false;
      }
      applyTaskBinding(result.task, result.state, result.timeline);
      model.upsertTask(result.task, false);
      await restoreDraft(taskId);
      return true;
    } catch (error) {
      if (generation !== openGeneration) return false;
      setIsReady(false);
      const message = errorMessage(error);
      // Stale selectedTaskId after store prune — drop highlight instead of looping on ghost tasks.
      if (message.startsWith("Unknown task:")) {
        model.selectTaskLocal(null);
        setActiveTaskId(null);
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

  function applyUnavailableTask(task: WorkspaceTask): void {
    setActiveTaskId(task.id);
    setCwd(task.cwd);
    setIsReady(false);
    setUnavailableTask(task);
    model.upsertTask(task, true, false);
    commitOverlay(
      applyTurnResult(snapshotOverlay(), {
        stopReason: "error",
        errorMessage: "The PI Session file for this Task is unavailable.",
      }),
    );
    void restoreDraft(task.id);
  }

  function applyTaskBinding(
    task: WorkspaceTask,
    state: PiHostState,
    snapshot: PiTimelineSnapshot,
  ): void {
    setActiveTaskId(task.id);
    setCwd(task.cwd);
    setIsReady(true);
    setUnavailableTask(null);
    model.selectTaskLocal(task.rootTaskId);
    commitSnapshot(snapshot);
    applyHost(state);
    // Renderer remount mid-turn (e.g. Vite HMR after agent edits CSS): keep the turn live.
    if (state.isStreaming) setTurnActive(true);
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

  function setLocalTaskStatus(status: WorkspaceTask["status"]): void {
    const id = activeTaskId();
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
    const taskId = activeTaskId();
    if (taskId) drafts.set(taskId, "");
    setTurnActive(true);
    setLocalTaskStatus("running");
    commitOverlay(beginTurnOverlay(snapshotOverlay(), text));
    try {
      const result = await window.piDesktop.session.prompt(text);
      commitSnapshot(result.timeline, result);
      if (result.task) model.upsertTask(result.task, true, true);
      await refreshState();
    } catch (error) {
      setIsReady(false);
      setTurnActive(false);
      setLocalTaskStatus("error");
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
    setLocalTaskStatus("idle");
    try {
      const timelineSnapshot = await window.piDesktop.session.getTimeline();
      commitSnapshot(timelineSnapshot, { stopReason: "aborted" });
    } catch {
      commitOverlay(applyTurnResult(snapshotOverlay(), { stopReason: "aborted" }));
      setTurnActive(false);
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
   * Retry the latest unanswered user turn via agent.continue() — no new user
   * entry, so it does not create an identical sibling branch.
   */
  async function continueTurn(): Promise<boolean> {
    if (!isReady() || isCreatingSession() || isBusy()) return false;
    if (!latestUnansweredUser()) return false;
    setTurnActive(true);
    setLocalTaskStatus("running");
    try {
      const result = await window.piDesktop.session.continueTurn();
      commitSnapshot(result.timeline, result);
      if (result.task) model.upsertTask(result.task, true, true);
      await refreshState();
      return true;
    } catch (error) {
      setTurnActive(false);
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
    const unanswered = latestUnansweredUser();
    if (
      resend &&
      unanswered &&
      unanswered.id === request.entryId &&
      unanswered.text.trim() === resend
    ) {
      return continueTurn();
    }
    try {
      const result = await window.piDesktop.session.navigate({
        entryId: request.entryId,
        ...(request.summarize ? { summarize: true } : {}),
      });
      if (result.cancelled) {
        setTurnActive(false);
        return false;
      }
      commitSnapshot(result.timeline);
      await refreshState();
      if (!resend) return true;

      setDraft("");
      const taskId = activeTaskId();
      if (taskId) drafts.set(taskId, "");
      setTurnActive(true);
      setLocalTaskStatus("running");
      commitOverlay(beginTurnOverlay(snapshotOverlay(), resend));
      const promptResult = await window.piDesktop.session.prompt(resend);
      commitSnapshot(promptResult.timeline, promptResult);
      if (promptResult.task) model.upsertTask(promptResult.task, true, true);
      await refreshState();
      return true;
    } catch (error) {
      setTurnActive(false);
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

  function latestUnansweredUser(): { id: string; text: string } | null {
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
    const hasModelOutput = list
      .slice(latestUserIndex + 1)
      .some((item) => item.kind === "assistant" || item.kind === "tool");
    if (hasModelOutput) return null;
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
      model.replaceTasks(result.rootTasks, result.activeRootTaskId, result.activeTaskId);

      if (!result.disposed && !wasSelected) return true;

      setApproval(null);
      setTurnActive(false);
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
      model.replaceTasks(result.rootTasks, result.activeRootTaskId, result.activeTaskId);
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
    if (!task) return false;
    const result = await window.piDesktop.tasks.relink(task.id);
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
    model.upsertTask(result.task, true, false);
    return activateTask(result.task.id, { force: true });
  }

  async function replaceUnavailableTask(): Promise<boolean> {
    const task = unavailableTask();
    if (!task) return false;
    return openTaskSession({ cwd: task.cwd });
  }

  return {
    activeTaskId,
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
    archiveTask,
    unarchiveTask,
    canRetryLatest: createMemo(
      () =>
        isReady() &&
        !isCreatingSession() &&
        !isBusy() &&
        latestUnansweredUser() !== null,
    ),
    continueTurn,
    createNewTask,
    openWorkflowStepSession,
    prefillDraft,
    rebindActiveTask,
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
