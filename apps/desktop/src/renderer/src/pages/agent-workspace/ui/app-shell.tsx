import {
  Command,
  GitBranch,
  LoaderCircle,
  Moon,
  SlidersHorizontal,
  Sparkles,
  Sun,
} from "lucide-solid";
import type { ProviderQuotaOk, ProviderQuotaSnapshot, QuotaWindow } from "@pi-3.14/usage";
import { resolveUsageProviderId, selectQuotasForModel } from "@pi-3.14/usage";
import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js";
import type {
  TaskPlaybookId,
  TaskWorkflow,
  WorkspaceGitSnapshot,
} from "../../../../../shared/desktop-contracts";
import type { TimelineItem } from "@/features/agent-timeline";
import { DiffReviewPanel } from "../../diff-review/route";
import {
  EXTRACT_TASK_TITLE_PREFIX,
  buildExtractPrompt,
  formatTranscript,
  isExtractTaskTitle,
  type ChatTurn,
} from "../extract-skill";
import type { WorkspaceModel } from "../model";
import type { AgentWorkspaceSession } from "../session";
import { createWorkflow, getPlaybook } from "../workflow/playbooks";
import { AgentTimeline, Composer } from "@/features/agent-timeline/solid";
import { Button } from "@/shared/ui/button";
import { Dialog } from "@/shared/ui/dialog";
import { IconButton } from "@/shared/ui/icon-button";
import { notifyError, notifySuccess } from "@/shared/ui/toast";
import { BranchesFlowPanel } from "./branches-flow-panel";
import { ChatSidePanel } from "./chat-side-panel";
import { scrollToTimelineEntry } from "./scroll-to-timeline-entry";
import { ExtractSkillBanner } from "./extract-skill-banner";
import { ExtractSkillDialog } from "./extract-skill-dialog";
import { ForkPointBanner } from "./fork-point-banner";
import { Inspector } from "./inspector";
import { NewTaskDialog } from "./new-task-dialog";
import { PanelResizeHandle } from "./panel-resize-handle";
import { Rail } from "./rail";
import { TaskHeader } from "./task-header";
import { TaskSkillsDialog } from "./task-skills-dialog";
import { TaskSidebar } from "./task-sidebar";
import { ToolApprovalBanner } from "./tool-approval-banner";
import { WorkflowSteps } from "./workflow-steps";

/** amend = latest unanswered (rewrite, not a real branch); resend = latest with reply; branch = historical */
type PendingEditMode = "amend" | "resend" | "branch";

type PendingEdit = {
  entryId: string;
  text: string;
  mode: PendingEditMode;
  /** Leave-time: summarize abandon segment below edit point into the new path. */
  summarizeAbandoned?: boolean;
};

type AppShellProps = {
  model: WorkspaceModel;
  session: AgentWorkspaceSession;
};

type ComposerHudWindow = Pick<QuotaWindow, "label" | "resetAtMs" | "usedPercent" | "windowSeconds">;

const TASKS_MIN = 240;
const TASKS_MAX = 372;
const TASKS_DEFAULT = 264;
const INSPECTOR_MIN = 360;
const INSPECTOR_MAX = 720;
const INSPECTOR_DEFAULT = 480;
/** Match `--content-max` + `--chat-gutter-width` + gap; below this, hide gutter. */
const CHAT_GUTTER_THRESHOLD = 780 + 280 + 32;

export function AppShell(props: AppShellProps) {
  const [git, setGit] = createSignal<WorkspaceGitSnapshot | null>(null);
  const [inspectorRefresh, setInspectorRefresh] = createSignal(0);
  const tasksOpen = props.model.tasksOpen;
  const inspectorOpen = props.model.inspectorOpen;
  const [tasksWidth, setTasksWidth] = createSignal(TASKS_DEFAULT);
  const [inspectorWidth, setInspectorWidth] = createSignal(INSPECTOR_DEFAULT);
  const [reviewOpen, setReviewOpen] = createSignal(false);
  const [reviewPath, setReviewPath] = createSignal<string | null>(null);
  const [extractOpen, setExtractOpen] = createSignal(false);
  const [extractSourceItems, setExtractSourceItems] = createSignal<TimelineItem[]>([]);
  const [skillsOpen, setSkillsOpen] = createSignal(false);
  const [newTaskOpen, setNewTaskOpen] = createSignal(false);
  const [branchesOpen, setBranchesOpen] = createSignal(false);
  const [branchesRefresh, setBranchesRefresh] = createSignal(0);
  /** Suppress timeline auto-follow while Switch & view pins a message. */
  const [pinScrollEntryId, setPinScrollEntryId] = createSignal<string | null>(null);
  const [pendingEdit, setPendingEdit] = createSignal<PendingEdit | null>(null);
  const [skillFilterBusy, setSkillFilterBusy] = createSignal(false);
  const [hudContextPercent, setHudContextPercent] = createSignal<number | null>(null);
  const [hudQuotaWindows, setHudQuotaWindows] = createSignal<ComposerHudWindow[]>([]);
  const [hudQuotaMessage, setHudQuotaMessage] = createSignal<string | null>(null);
  const [chatLayoutEl, setChatLayoutEl] = createSignal<HTMLDivElement | null>(null);
  /** Wide enough for the surplus rail — boolean only (avoid per-pixel reactive churn). */
  const [layoutWide, setLayoutWide] = createSignal(false);

  const playbookTitle = createMemo(() => {
    const workflow = props.model.selectedWorkspaceTask()?.workflow;
    if (!workflow) return null;
    try {
      return getPlaybook(workflow.playbookId).title;
    } catch {
      return workflow.playbookId;
    }
  });

  const activeWorkflow = createMemo(
    () => props.model.selectedWorkspaceTask()?.workflow ?? null,
  );

  /** Surplus rail for workflow / light meta — hidden when inspector is open or space is tight. */
  const gutterVisible = createMemo(() => !inspectorOpen() && layoutWide());

  createEffect(() => {
    const el = chatLayoutEl();
    if (!el) return;

    // Hysteresis avoids open/close thrash near the threshold (scrollbar / subpixel noise).
    const OPEN_AT = CHAT_GUTTER_THRESHOLD;
    const CLOSE_AT = CHAT_GUTTER_THRESHOLD - 24;
    let frame = 0;

    const measure = () => {
      frame = 0;
      const width = el.clientWidth;
      setLayoutWide((wide) => {
        if (wide) return width >= CLOSE_AT;
        return width >= OPEN_AT;
      });
    };

    const ro = new ResizeObserver(() => {
      if (frame) return;
      frame = requestAnimationFrame(measure);
    });
    ro.observe(el);
    measure();
    onCleanup(() => {
      ro.disconnect();
      if (frame) cancelAnimationFrame(frame);
    });
  });

  let wasBusy = false;
  createEffect(() => {
    document.documentElement.dataset.theme = props.model.theme();
  });
  createEffect(() => {
    if (!props.model.bootstrapped()) return;
    setTasksWidth(props.model.tasksWidth());
    setInspectorWidth(props.model.inspectorWidth());
  });
  createEffect(() => {
    const cwd = props.session.cwd();
    if (!cwd) {
      setGit(null);
      return;
    }
    void window.piDesktop.workspace.git(cwd).then(setGit).catch(() => setGit(null));
  });
  createEffect(() => {
    const busy = props.session.isBusy();
    const cwd = props.session.cwd();
    if (wasBusy && !busy && cwd) {
      void window.piDesktop.workspace.git(cwd).then(setGit).catch(() => setGit(null));
      setInspectorRefresh((value) => value + 1);
      void refreshComposerHud();
    }
    wasBusy = busy;
  });
  createEffect(() => {
    const ready = props.session.isReady();
    const busy = props.session.isBusy();
    const cwd = props.session.cwd();
    // Re-filter subscription meters when the active model provider changes.
    props.session.modelValue();
    if (!ready || !cwd) {
      setHudContextPercent(null);
      setHudQuotaWindows([]);
      setHudQuotaMessage(null);
      return;
    }
    if (busy) return;
    void refreshComposerHud();
  });

  const composerHud = createMemo(() => {
    const contextPercent = hudContextPercent();
    const quotaWindows = hudQuotaWindows();
    const quotaMessage = hudQuotaMessage();
    const showUsage = quotaWindows.length > 0 || quotaMessage != null;
    if (contextPercent == null && !showUsage) return null;
    return (
      <div class="at-composer-hud" aria-label="Composer status">
        <Show when={contextPercent != null}>
          <ComposerHudItem label="Context" percent={contextPercent} />
        </Show>
        <Show when={contextPercent != null && showUsage}>
          <span class="at-composer-hud__sep">|</span>
        </Show>
        <Show
          when={quotaWindows.length > 0}
          fallback={<ComposerHudUsageUnavailable message={quotaMessage ?? "No quota window available"} />}
        >
          <span class="at-composer-hud__item">
            <span class="at-composer-hud__label">Usage</span>
            {quotaWindows.map((windowRow, index) => (
              <>
                <ComposerHudItem
                  label={windowRow.label}
                  percent={windowRow.usedPercent}
                  resetAtMs={windowRow.resetAtMs}
                  windowSeconds={windowRow.windowSeconds}
                  compact
                />
                <Show when={index < quotaWindows.length - 1}>
                  <span class="at-composer-hud__sep">/</span>
                </Show>
              </>
            ))}
          </span>
        </Show>
      </div>
    );
  });

  function startNewTask() {
    setNewTaskOpen(true);
  }

  async function confirmNewTask(playbookId: TaskPlaybookId | null): Promise<void> {
    setNewTaskOpen(false);
    const ok = await props.session.createNewTask();
    if (!ok) return;
    if (!playbookId) return;
    const workflow = createWorkflow(playbookId);
    const starter = getPlaybook(playbookId).steps[0]?.starterPrompt ?? null;
    await persistWorkflow(workflow, starter);
  }

  function refreshInspector() {
    setInspectorRefresh((value) => value + 1);
    const cwd = props.session.cwd();
    if (cwd) void window.piDesktop.workspace.git(cwd).then(setGit).catch(() => setGit(null));
    void refreshComposerHud();
  }

  async function refreshComposerHud(): Promise<void> {
    if (!props.session.isReady()) return;
    try {
      const [inspect, quotas] = await Promise.all([
        window.piDesktop.session.inspect(),
        window.piDesktop.usage.providerQuotas().catch(() => [] as ProviderQuotaSnapshot[]),
      ]);
      const modelProvider =
        modelProviderFromValue(props.session.modelValue()) ??
        inspect.analysis?.model?.provider ??
        null;
      const relevant = selectQuotasForModel(quotas, modelProvider);
      const windows = selectComposerQuotaWindows(relevant);
      setHudContextPercent(inspect.live?.contextUsage?.percent ?? null);
      setHudQuotaWindows(windows);
      setHudQuotaMessage(
        windows.length > 0 ? null : describeQuotaSnapshots(relevant, modelProvider),
      );
    } catch {
      setHudContextPercent(null);
      setHudQuotaWindows([]);
      setHudQuotaMessage("Usage unavailable");
    }
  }

  function requestEditUser(
    entryId: string,
    text: string,
    isLatest: boolean,
    options?: { summarizeAbandoned?: boolean },
  ): void {
    const mode: PendingEditMode = !isLatest
      ? "branch"
      : props.session.canRetryLatest()
        ? "amend"
        : "resend";
    setPendingEdit({
      entryId,
      text,
      mode,
      summarizeAbandoned:
        (mode === "branch" || mode === "resend") && Boolean(options?.summarizeAbandoned),
    });
  }

  async function confirmEditUser(): Promise<void> {
    const edit = pendingEdit();
    if (!edit) return;
    setPendingEdit(null);
    const summarize =
      (edit.mode === "branch" || edit.mode === "resend") && Boolean(edit.summarizeAbandoned);
    if (summarize) {
      notifySuccess("正在总结下方内容…", "完成后会分叉并重发，摘要写入新路径");
    }
    const ok = await props.session.navigateTree({
      entryId: edit.entryId,
      promptText: edit.text,
      ...(summarize ? { summarize: true } : {}),
    });
    if (ok) {
      setBranchesRefresh((value) => value + 1);
      refreshInspector();
    } else {
      notifyError("未能编辑 / 分叉该消息");
    }
  }

  async function switchBranch(
    entryId: string,
    options?: { summarize?: boolean; viewEntryId?: string },
  ): Promise<boolean> {
    if (options?.summarize) {
      notifySuccess("正在处理路径摘要…", "完成后会切到目标旁支");
    }
    const ok = await props.session.navigateTree({
      entryId,
      ...(options?.summarize ? { summarize: true } : {}),
    });
    if (ok) {
      setBranchesRefresh((value) => value + 1);
      refreshInspector();
      notifySuccess(options?.summarize ? "已总结并切换分支" : "已切换到该分支");
      const scrollId = options?.summarize
        ? latestBranchSummaryId(props.session.items()) ?? options.viewEntryId ?? entryId
        : options?.viewEntryId ?? entryId;
      setPinScrollEntryId(scrollId);
      scrollToTimelineEntry(scrollId);
      window.setTimeout(() => setPinScrollEntryId(null), 400);
    } else {
      notifyError("切换分支失败");
    }
    return ok;
  }

  function latestBranchSummaryId(items: TimelineItem[]): string | null {
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const item = items[i];
      if (item?.kind === "branch_summary") return item.id;
    }
    return null;
  }

  function toggleInspectorPanel() {
    if (inspectorOpen()) {
      props.model.setInspectorOpen(false);
      return;
    }
    props.model.setInspectorOpen(true);
    if (props.model.tab() === "files") {
      const width = Math.max(inspectorWidth(), INSPECTOR_DEFAULT);
      setInspectorWidth(width);
      props.model.commitInspectorWidth(width);
      refreshInspector();
    }
  }

  async function exportSession(): Promise<void> {
    try {
      const result = await window.piDesktop.session.exportSession();
      if (!result.ok) {
        if ("cancelled" in result && result.cancelled) return;
        notifyError("导出失败", "error" in result ? result.error : "无法导出 session");
        return;
      }
      notifySuccess("已导出 session", result.path);
    } catch (error) {
      notifyError("导出失败", error instanceof Error ? error.message : String(error));
    }
  }

  function openReview(path?: string | null) {
    if (!props.session.cwd()) return;
    setReviewPath(path ?? null);
    setReviewOpen(true);
  }

  function closeReview() {
    setReviewOpen(false);
    setReviewPath(null);
    refreshInspector();
  }

  async function persistWorkflow(
    workflow: TaskWorkflow | null,
    starterPrompt: string | null,
  ): Promise<void> {
    const task = props.model.selectedWorkspaceTask();
    if (!task) return;
    const updated = await window.piDesktop.tasks.update({ id: task.id, workflow });
    if (updated) props.model.upsertTask(updated, true, false);
    if (starterPrompt) props.session.prefillDraft(starterPrompt);
  }

  async function setIgnoredSkillNames(names: string[]): Promise<void> {
    const task = props.model.selectedWorkspaceTask();
    if (!task || skillFilterBusy()) return;
    const previous = [...(task.ignoredSkillNames ?? [])];

    const withIgnored = (base: typeof task, ignored: string[]) => {
      const next = { ...base };
      if (ignored.length > 0) next.ignoredSkillNames = ignored;
      else delete next.ignoredSkillNames;
      return next;
    };

    // Optimistic: list moves immediately; quiet rebind keeps chat/context mounted.
    props.model.upsertTask(withIgnored(task, names), true, false);
    setSkillFilterBusy(true);
    try {
      const updated = await window.piDesktop.tasks.update({
        id: task.id,
        ignoredSkillNames: names,
      });
      if (!updated) {
        props.model.upsertTask(withIgnored(task, previous), true, false);
        notifyError("未能更新忽略的 Skills");
        return;
      }
      props.model.upsertTask(updated, true, false);
      const ok = await props.session.rebindActiveTask({ quiet: true });
      if (!ok) {
        notifyError("已保存忽略列表，但重新加载 Skills 失败");
        return;
      }
      setInspectorRefresh((value) => value + 1);
    } finally {
      setSkillFilterBusy(false);
    }
  }

  function openExtract() {
    if (!props.session.cwd()) {
      notifyError("无法抽取", "先打开一个带工作区的 Task");
      return;
    }
    setExtractSourceItems(props.session.items());
    setExtractOpen(true);
  }

  async function startExtract(turns: ChatTurn[]): Promise<void> {
    const cwd = props.session.cwd();
    if (!cwd) throw new Error("No workspace cwd");
    const stamp = new Date().toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
    const ok = await props.session.startExtractTask({
      cwd,
      title: `${EXTRACT_TASK_TITLE_PREFIX}${stamp}`,
      prompt: buildExtractPrompt(formatTranscript(turns)),
    });
    if (!ok) throw new Error("未能开启抽取 session");
    notifySuccess("已开启抽取 session", "独立 Task 中起草 SKILL.md；完成后确认写入个人库。");
  }

  return (
    <div class="desktop-stage" data-theme={props.model.theme()}>
      <div class="app-shell">
        <div class="titlebar">
          <div class="titlebar-spacer" aria-hidden="true" />
          <div class="app-title">
            <Command size={17} strokeWidth={2.4} />
            PIE <span>— personal code agent workspace</span>
          </div>
          <div class="window-actions">
            <Button variant="secondary" onClick={props.model.toggleTheme}>
              {props.model.theme() === "light" ? <Moon size={15} /> : <Sun size={15} />}
              Theme
            </Button>
            <Button variant="secondary" disabled={props.session.isCreatingSession()}>
              <Show
                when={props.session.isCreatingSession()}
                fallback={<GitBranch size={15} />}
              >
                <LoaderCircle class="at-spin" size={15} />
              </Show>
              {git()?.branch ?? props.session.workspaceLabel()}
            </Button>
          </div>
        </div>

        <div class="workspace-grid">
          <Rail
            tasksOpen={tasksOpen()}
            onNewTask={startNewTask}
            onToggleTasks={() => props.model.setTasksOpen(!tasksOpen())}
          />
          <div
            class="workspace-body"
            style={{
              "--sidebar-width": `${tasksWidth()}px`,
              "--inspector-width": `${inspectorWidth()}px`,
            }}
          >
            <div class="panel-slot panel-slot--left" data-open={tasksOpen() ? "true" : "false"}>
              <div class="sidebar-panel" inert={!tasksOpen() || undefined}>
                <TaskSidebar
                  loadingTaskId={
                    props.session.isCreatingSession() ? props.model.selectedTaskId() : null
                  }
                  model={props.model}
                  onCollapse={() => props.model.setTasksOpen(false)}
                  onNewTask={startNewTask}
                  onSelectTask={(id) => void props.session.activateTask(id)}
                  onArchiveTask={(id) => void props.session.archiveTask(id)}
                  onUnarchiveTask={(id) => void props.session.unarchiveTask(id)}
                />
              </div>
            </div>
            <Show when={tasksOpen()}>
              <PanelResizeHandle
                label="Resize task sidebar"
                side="left"
                min={TASKS_MIN}
                max={TASKS_MAX}
                value={tasksWidth()}
                onChange={setTasksWidth}
                onCommit={props.model.commitTasksWidth}
              />
            </Show>

            <main class="main-panel-shell main-panel">
              <div class="task-header-wrap">
                <TaskHeader
                  branch={git()?.branch}
                  changeCount={git()?.files.length ?? 0}
                  inspectorOpen={inspectorOpen()}
                  loading={props.session.isCreatingSession()}
                  playbookTitle={playbookTitle()}
                  branchesOpen={branchesOpen()}
                  canExportSession={Boolean(
                    props.model.selectedTask()?.sessionPath ||
                      props.session.hostState()?.sessionPath,
                  )}
                  canOpenBranches={props.session.isReady()}
                  task={props.model.selectedTask()}
                  taskStatus={props.model.selectedWorkspaceTask()?.status}
                  status={props.session.status().runStatus}
                  onClearPlaybook={() => void persistWorkflow(null, null)}
                  onExportSession={() => void exportSession()}
                  onReviewChanges={() => openReview()}
                  onToggleBranches={() => {
                    setBranchesOpen((open) => {
                      if (!open) setBranchesRefresh((value) => value + 1);
                      return !open;
                    });
                  }}
                  onToggleInspectorPanel={toggleInspectorPanel}
                />
              </div>
              <Show when={isExtractTaskTitle(props.model.selectedTask()?.title)}>
                <ExtractSkillBanner
                  items={props.session.items()}
                  busy={props.session.isBusy() || props.session.isCreatingSession()}
                />
              </Show>
              <ToolApprovalBanner
                request={props.session.approval()}
                onAllow={() => props.session.replyApproval(true)}
                onDeny={() => props.session.replyApproval(false)}
              />
              <ForkPointBanner
                enabled={props.session.isReady() && !props.session.isBusy()}
                busy={props.session.isBusy() || props.session.isCreatingSession()}
                refreshToken={branchesRefresh()}
                onSwitch={(entryId) => {
                  void switchBranch(entryId, { viewEntryId: entryId });
                }}
              />
              <Show when={props.session.unavailableTask()}>
                {(task) => (
                  <div class="session-unavailable" role="status">
                    <span>
                      <strong>Session unavailable</strong>
                      <small>{task().sessionPath ?? "This legacy Task has no Session path."}</small>
                    </span>
                    <div>
                      <Button
                        variant="secondary"
                        disabled={!task().sessionId}
                        onClick={() => void props.session.relinkUnavailableTask()}
                      >
                        Locate Session…
                      </Button>
                      <Button
                        variant="primary"
                        onClick={() => void props.session.replaceUnavailableTask()}
                      >
                        Create new Task
                      </Button>
                    </div>
                  </div>
                )}
              </Show>
              <div
                class="chat-layout"
                data-gutter={gutterVisible() ? "true" : "false"}
                data-workflow={activeWorkflow() ? "true" : "false"}
                ref={setChatLayoutEl}
              >
                <div class="chat-column">
                  <div class="chat-stage">
                    <AgentTimeline
                      items={props.session.items()}
                      loading={props.session.isCreatingSession()}
                      loadingLabel="Opening session…"
                      status={props.session.status()}
                      pendingApprovalToolCallId={props.session.approval()?.toolCallId ?? null}
                      conversationKey={props.session.activeTaskId()}
                      suppressAutoFollow={pinScrollEntryId() !== null}
                      canEditUser={
                        props.session.isReady() &&
                        !props.session.isCreatingSession() &&
                        !props.session.isBusy()
                      }
                      canRetryLatest={props.session.canRetryLatest()}
                      onAllowApproval={() => props.session.replyApproval(true)}
                      onDenyApproval={() => props.session.replyApproval(false)}
                      onPromptSuggestion={props.session.prefillDraft}
                      onEditUser={requestEditUser}
                      onRetryLatest={() => {
                        void props.session.continueTurn().then((ok) => {
                          if (ok) {
                            setBranchesRefresh((value) => value + 1);
                            refreshInspector();
                          } else {
                            notifyError("重新执行失败");
                          }
                        });
                      }}
                    />
                    {/* Narrow / inspector-open: float on the chat column (centered-safe). */}
                    <Show when={!gutterVisible() ? activeWorkflow() : null}>
                      {(workflow) => (
                        <div class="workflow-dock" data-mode="overlay">
                          <WorkflowSteps
                            disabled={props.session.isCreatingSession()}
                            placement="overlay"
                            workflow={workflow()}
                            onWorkflowChange={(next, starter) => {
                              void persistWorkflow(next, starter);
                            }}
                          />
                        </div>
                      )}
                    </Show>
                  </div>
                  <div class="composer-stack">
                    <Composer
                      attentionKey={props.session.draftAttention()}
                      autoApproveUnlocked={props.session.autoApproveUnlocked()}
                      disabled={props.session.isCreatingSession()}
                      modelLabel={props.session.modelLabel()}
                      modelOptions={props.session.modelOptions()}
                      modelValue={props.session.modelValue()}
                      onStop={() => {
                        void props.session.abort().then(() => {
                          setBranchesRefresh((value) => value + 1);
                          refreshInspector();
                        });
                      }}
                      onRevert={() => {
                        void props.session.revert().then((ok) => {
                          if (ok) {
                            setBranchesRefresh((value) => value + 1);
                            refreshInspector();
                          } else {
                            notifyError("Revert 失败");
                          }
                        });
                      }}
                      onAutoApproveChange={(unlocked) => {
                        void props.session.setAutoApprove(unlocked);
                      }}
                      onInput={props.session.setDraft}
                      onModelChange={(value) => void props.session.setModel(value)}
                      onSelectWorkspace={startNewTask}
                      onSubmit={() => void props.session.send()}
                      onThinkingChange={(value) => void props.session.setThinkingLevel(value)}
                      streaming={props.session.isBusy()}
                      thinkingLevel={props.session.thinkingLabel()}
                      thinkingOptions={props.session.thinkingOptions()}
                      thinkingValue={props.session.thinkingValue()}
                      toolbarHud={gutterVisible() ? undefined : composerHud()}
                      toolbarAction={
                        <>
                          <IconButton
                            label="Task Skills"
                            size="sm"
                            disabled={
                              props.session.isCreatingSession() ||
                              props.session.isBusy() ||
                              !props.session.isReady()
                            }
                            onClick={() => setSkillsOpen(true)}
                          >
                            <SlidersHorizontal size={14} />
                          </IconButton>
                          <IconButton
                            label="协助抽取 Skill"
                            size="sm"
                            disabled={
                              props.session.isCreatingSession() ||
                              props.session.isBusy() ||
                              !props.session.cwd()
                            }
                            onClick={openExtract}
                          >
                            <Sparkles size={14} />
                          </IconButton>
                        </>
                      }
                      value={props.session.draft()}
                      workspaceLabel={props.session.workspaceLabel()}
                      workspaceTitle={props.session.workspaceTitle()}
                    />
                  </div>
                </div>

                <aside
                  class="chat-gutter"
                  data-open={gutterVisible() ? "true" : "false"}
                  aria-hidden={!gutterVisible() || undefined}
                  inert={!gutterVisible() || undefined}
                >
                  <ChatSidePanel
                    lead={
                      activeWorkflow() ? (
                        <WorkflowSteps
                          disabled={props.session.isCreatingSession()}
                          placement="gutter"
                          workflow={activeWorkflow()!}
                          onWorkflowChange={(next, starter) => {
                            void persistWorkflow(next, starter);
                          }}
                        />
                      ) : undefined
                    }
                    status={props.session.status().runStatus}
                    taskStatus={props.model.selectedWorkspaceTask()?.status}
                    modelLabel={props.session.modelLabel()}
                    thinkingLabel={props.session.thinkingLabel()}
                    branch={git()?.branch}
                    workspaceLabel={props.session.workspaceLabel()}
                    changeCount={git()?.files.length ?? 0}
                    contextPercent={hudContextPercent()}
                    quotaWindows={hudQuotaWindows()}
                    quotaMessage={hudQuotaMessage()}
                    ready={props.session.isReady()}
                    onReviewChanges={() => openReview()}
                    onOpenInspector={() => {
                      if (!inspectorOpen()) toggleInspectorPanel();
                    }}
                  />
                </aside>
              </div>
            </main>

            <Show when={inspectorOpen()}>
              <PanelResizeHandle
                label="Resize inspector"
                side="right"
                min={INSPECTOR_MIN}
                max={INSPECTOR_MAX}
                value={inspectorWidth()}
                onChange={setInspectorWidth}
                onCommit={props.model.commitInspectorWidth}
              />
            </Show>
            <div class="panel-slot panel-slot--right" data-open={inspectorOpen() ? "true" : "false"}>
              <div class="inspector-panel" inert={!inspectorOpen() || undefined}>
                <Inspector
                  cwd={props.session.cwd()}
                  items={props.session.items()}
                  ready={props.session.isReady()}
                  refreshToken={inspectorRefresh()}
                  tab={props.model.tab()}
                  ignoredSkillNames={
                    props.model.selectedWorkspaceTask()?.ignoredSkillNames ?? []
                  }
                  onCollapse={() => props.model.setInspectorOpen(false)}
                  onOpenReview={(path) => openReview(path)}
                  onTabChange={props.model.setTab}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <Dialog
        class="orbit-dialog__content--compact"
        open={pendingEdit() !== null}
        title="Confirm edit"
        onOpenChange={(open) => {
          if (!open) setPendingEdit(null);
        }}
      >
        <div class="confirm-dialog">
          <header class="confirm-dialog__header">
            <h2>
              {pendingEdit()?.mode === "amend"
                ? "改写并重发？"
                : pendingEdit()?.mode === "resend"
                  ? "编辑并重发？"
                  : "从此处分叉并重发？"}
            </h2>
          </header>
          <div class="confirm-dialog__body">
            <p>
              {pendingEdit()?.mode === "amend"
                ? "最后一条尚未收到回复。将用当前内容重新发送，不会保留为旁支。"
                : pendingEdit()?.mode === "resend"
                  ? "上方对话仍在新路径中；这条之后的回复会变成旁支（Branches 可切回继续聊），并用编辑后的内容重新发送。"
                  : "上方对话仍在新路径中；这条之后的内容会变成旁支（Branches 可切回继续聊），并用编辑后的内容重新发送。"}
            </p>
            <Show when={pendingEdit()?.mode === "branch" || pendingEdit()?.mode === "resend"}>
              <div class="confirm-dialog__option">
                <label class="confirm-dialog__check">
                  <input
                    type="checkbox"
                    checked={Boolean(pendingEdit()?.summarizeAbandoned)}
                    onInput={(event) => {
                      const checked = event.currentTarget.checked;
                      setPendingEdit((prev) =>
                        prev ? { ...prev, summarizeAbandoned: checked } : prev,
                      );
                    }}
                  />
                  <span>
                    <strong>生成下方内容摘要并带入新路径</strong>
                    <span class="confirm-dialog__option-hint">
                      用 LLM 总结 edit 点之后将被旁支化的内容，写入新路径上下文。默认关闭。
                    </span>
                  </span>
                </label>
              </div>
            </Show>
          </div>
          <footer class="confirm-dialog__footer">
            <Button variant="secondary" onClick={() => setPendingEdit(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void confirmEditUser()}>
              {pendingEdit()?.mode === "amend"
                ? "Rewrite & send"
                : pendingEdit()?.mode === "resend"
                  ? "Edit & resend"
                  : "Branch & resend"}
            </Button>
          </footer>
        </div>
      </Dialog>

      <Show when={props.session.cwd()}>
        {(cwd) => (
          <Dialog
            class="orbit-dialog__content--review"
            open={reviewOpen()}
            title="Review changes"
            onOpenChange={(open) => {
              if (!open) closeReview();
              else setReviewOpen(true);
            }}
          >
            <DiffReviewPanel
              cwd={cwd()}
              initialPath={reviewPath()}
              onClose={closeReview}
            />
          </Dialog>
        )}
      </Show>

      <BranchesFlowPanel
        open={branchesOpen()}
        busy={props.session.isBusy() || props.session.isCreatingSession()}
        refreshToken={branchesRefresh()}
        onClose={() => setBranchesOpen(false)}
        onSwitch={(navigateId, viewEntryId) => {
          setBranchesOpen(false);
          void switchBranch(navigateId, { viewEntryId });
        }}
        onGoto={(entryId) => {
          setBranchesOpen(false);
          scrollToTimelineEntry(entryId);
        }}
      />

      <NewTaskDialog
        open={newTaskOpen()}
        disabled={props.session.isCreatingSession()}
        onOpenChange={setNewTaskOpen}
        onConfirm={(playbookId) => confirmNewTask(playbookId)}
      />

      <ExtractSkillDialog
        open={extractOpen()}
        items={extractSourceItems()}
        disabled={props.session.isCreatingSession() || props.session.isBusy()}
        onOpenChange={setExtractOpen}
        onStart={(turns) => startExtract(turns)}
      />

      <TaskSkillsDialog
        open={skillsOpen()}
        ignoredSkillNames={props.model.selectedWorkspaceTask()?.ignoredSkillNames ?? []}
        disabled={props.session.isCreatingSession() || props.session.isBusy()}
        onOpenChange={setSkillsOpen}
        onSetIgnoredSkillNames={(names) => setIgnoredSkillNames(names)}
      />
    </div>
  );
}

function ComposerHudItem(props: {
  compact?: boolean;
  label: string;
  percent: number | null;
  resetAtMs?: number | null;
  windowSeconds?: number | null;
}) {
  const percent = () => (props.percent != null ? Math.round(props.percent) : null);
  const detail = () =>
    props.resetAtMs
      ? `${formatHudReset(props.resetAtMs)}${props.windowSeconds ? `/${formatHudDuration(props.windowSeconds)}` : ""}`
      : null;
  const title = () => {
    const value = percent() != null ? `${percent()}%` : "unknown";
    const suffix = detail() ? ` (${detail()})` : "";
    return `${props.label}: ${value}${suffix}`;
  };
  return (
    <span class="at-composer-hud__item" title={title()} data-alert={isHudAlert(props.percent)}>
      <Show when={!props.compact}>
        <span class="at-composer-hud__label">{props.label}</span>
      </Show>
      <span class="at-composer-hud__bar" aria-hidden="true">
        <span class="at-composer-hud__fill" style={{ width: `${clampPercent(props.percent)}%` }} />
      </span>
      <span class="at-composer-hud__value">
        {percent() != null ? `${percent()}%` : "—"}
        <Show when={props.compact && detail()}> ({detail()})</Show>
      </span>
    </span>
  );
}

function ComposerHudUsageUnavailable(props: { message: string }) {
  return (
    <span
      class="at-composer-hud__item at-composer-hud__item--muted"
      title={`Usage: ${props.message}`}
    >
      <span class="at-composer-hud__label">Usage</span>
      <span class="at-composer-hud__bar" aria-hidden="true">
        <span class="at-composer-hud__fill" style={{ width: "0%" }} />
      </span>
      <span class="at-composer-hud__value">—</span>
    </span>
  );
}

function selectComposerQuotaWindows(quotas: ProviderQuotaSnapshot[]): ComposerHudWindow[] {
  const quota = quotas.find(hasQuotaWindows);
  return (quota?.windows ?? []).slice(0, 2).map((windowRow) => ({
    label: windowRow.label,
    resetAtMs: windowRow.resetAtMs,
    usedPercent: windowRow.usedPercent,
    windowSeconds: windowRow.windowSeconds,
  }));
}

function describeQuotaSnapshots(
  quotas: ProviderQuotaSnapshot[],
  modelProvider?: string | null,
): string {
  if (quotas.length === 0) {
    if (modelProvider && resolveUsageProviderId(modelProvider) == null) {
      return `${modelProvider}: no usage meter`;
    }
    return modelProvider
      ? `${modelProvider}: no quota credentials found`
      : "No quota credentials found";
  }
  const okWithoutWindows = quotas.find((snapshot) => snapshot.status === "ok");
  if (okWithoutWindows) return `${okWithoutWindows.provider}: no quota window available`;
  const unauthenticated = quotas.find((snapshot) => snapshot.status === "unauthenticated");
  if (unauthenticated) return `${unauthenticated.provider}: unauthenticated`;
  const unavailable = quotas.find((snapshot) => snapshot.status === "unavailable");
  if (unavailable) return `${unavailable.provider}: unavailable`;
  const error = quotas.find((snapshot) => snapshot.status === "error");
  if (error?.status === "error") return `${error.provider}: ${error.error ?? "error"}`;
  return "No quota window available";
}

function modelProviderFromValue(value: string | null | undefined): string | null {
  if (!value) return null;
  const sep = value.indexOf(":::");
  if (sep <= 0) return null;
  return value.slice(0, sep);
}

function hasQuotaWindows(snapshot: ProviderQuotaSnapshot): snapshot is ProviderQuotaOk {
  return snapshot.status === "ok" && snapshot.windows.length > 0;
}

function clampPercent(value: number | null | undefined): number {
  if (value == null || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function isHudAlert(value: number | null | undefined): "true" | undefined {
  return value != null && value >= 80 ? "true" : undefined;
}

function formatHudReset(resetAtMs: number): string {
  const delta = resetAtMs - Date.now();
  if (delta <= 0) return "now";
  const minutes = Math.max(1, Math.round(delta / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 48) return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}

function formatHudDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}
