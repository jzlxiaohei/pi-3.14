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
import type { PiHostState } from "@pi-3.14/model";
import type {
  PiTimelineSnapshot,
  PiToolApprovalRequest,
  WorkspaceTask,
} from "../../../../shared/desktop-contracts";
import type { WorkspaceModel } from "./model";

const busyStatuses = new Set(["streaming", "compacting", "retrying"]);

export function createAgentWorkspaceSession(model: WorkspaceModel) {
  const [cwd, setCwd] = createSignal<string | null>(null);
  const [draft, setDraft] = createSignal("");
  const [isCreatingSession, setIsCreatingSession] = createSignal(false);
  const [isReady, setIsReady] = createSignal(false);
  const [turnActive, setTurnActive] = createSignal(false);
  const [activeTaskId, setActiveTaskId] = createSignal<string | null>(null);
  const [committedItems, setCommittedItems] = createSignal<TimelineItem[]>([]);
  const [approval, setApproval] = createSignal<PiToolApprovalRequest | null>(null);
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
    setDraft(drafts.get(taskId) ?? "");
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
    if (isCreatingSession() || isBusy()) return false;
    rememberDraft();

    let pickedCwd: string | null = null;
    try {
      const pick = await window.piDesktop.session.pickWorkspace();
      if (pick.cancelled) return false;
      pickedCwd = pick.cwd;
      setCwd(pick.cwd);
      setIsReady(false);
      setIsCreatingSession(true);
      setTurnActive(false);
      setCommittedItems([]);
      setApproval(null);

      const result = await window.piDesktop.session.create({ cwd: pick.cwd });
      if (result.cancelled) {
        setIsReady(false);
        return false;
      }

      applyTaskBinding(result.task, result.state, result.timeline);
      model.upsertTask(result.task);
      return true;
    } catch (error) {
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
      setIsCreatingSession(false);
    }
  }

  async function activateTask(taskId: string): Promise<boolean> {
    if (isCreatingSession()) return false;
    if (activeTaskId() === taskId && isReady()) return true;
    if (isBusy()) {
      await abort();
    }
    rememberDraft();

    setIsCreatingSession(true);
    setApproval(null);
    try {
      const result = await window.piDesktop.tasks.activate(taskId);
      applyTaskBinding(result.task, result.state, result.timeline);
      model.upsertTask(result.task);
      restoreDraft(taskId);
      return true;
    } catch (error) {
      setIsReady(false);
      commitOverlay(
        applyTurnResult(snapshotOverlay(), {
          stopReason: "error",
          errorMessage: errorMessage(error),
        }),
      );
      return false;
    } finally {
      setIsCreatingSession(false);
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
      if (result.task) model.upsertTask(result.task);
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
    modelLabel: createMemo(() => {
      const modelRef = hostState()?.model;
      return modelRef ? `${modelRef.provider}/${modelRef.id}` : "PI model";
    }),
    replyApproval,
    send,
    setDraft,
    thinkingLabel: createMemo(() => `thinking: ${hostState()?.thinkingLevel ?? "unknown"}`),
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
