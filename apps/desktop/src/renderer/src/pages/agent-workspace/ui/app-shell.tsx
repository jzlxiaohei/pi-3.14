import { Command, GitBranch, LoaderCircle, Moon, Sparkles, Sun } from "lucide-solid";
import { createEffect, createMemo, createSignal, Show } from "solid-js";
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
import { Tooltip } from "@/shared/ui/tooltip";
import { ExtractSkillBanner } from "./extract-skill-banner";
import { ExtractSkillDialog } from "./extract-skill-dialog";
import { Inspector } from "./inspector";
import { NewTaskDialog } from "./new-task-dialog";
import { PanelResizeHandle } from "./panel-resize-handle";
import { Rail } from "./rail";
import { TaskHeader } from "./task-header";
import { TaskSidebar } from "./task-sidebar";
import { ToolApprovalBanner } from "./tool-approval-banner";
import { WorkflowSteps } from "./workflow-steps";

type AppShellProps = {
  model: WorkspaceModel;
  session: AgentWorkspaceSession;
};

const TASKS_MIN = 240;
const TASKS_MAX = 372;
const TASKS_DEFAULT = 264;
const INSPECTOR_MIN = 360;
const INSPECTOR_MAX = 720;
const INSPECTOR_DEFAULT = 480;

const TASKS_OPEN_KEY = "pie.panel.tasksOpen";
const INSPECTOR_OPEN_KEY = "pie.panel.inspectorOpen";

function readPanelOpen(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === "true") return true;
    if (raw === "false") return false;
  } catch {
    /* ignore */
  }
  return fallback;
}

function writePanelOpen(key: string, open: boolean): void {
  try {
    localStorage.setItem(key, open ? "true" : "false");
  } catch {
    /* ignore */
  }
}

export function AppShell(props: AppShellProps) {
  const [git, setGit] = createSignal<WorkspaceGitSnapshot | null>(null);
  const [inspectorRefresh, setInspectorRefresh] = createSignal(0);
  const [tasksOpen, setTasksOpen] = createSignal(readPanelOpen(TASKS_OPEN_KEY, true));
  const [inspectorOpen, setInspectorOpen] = createSignal(readPanelOpen(INSPECTOR_OPEN_KEY, false));
  const [tasksWidth, setTasksWidth] = createSignal(TASKS_DEFAULT);
  const [inspectorWidth, setInspectorWidth] = createSignal(INSPECTOR_DEFAULT);
  const [reviewOpen, setReviewOpen] = createSignal(false);
  const [reviewPath, setReviewPath] = createSignal<string | null>(null);
  const [extractOpen, setExtractOpen] = createSignal(false);
  const [extractSourceItems, setExtractSourceItems] = createSignal<TimelineItem[]>([]);
  const [newTaskOpen, setNewTaskOpen] = createSignal(false);

  const playbookTitle = createMemo(() => {
    const workflow = props.model.selectedWorkspaceTask()?.workflow;
    if (!workflow) return null;
    try {
      return getPlaybook(workflow.playbookId).title;
    } catch {
      return workflow.playbookId;
    }
  });

  let wasBusy = false;
  createEffect(() => {
    document.documentElement.dataset.theme = props.model.theme();
  });
  createEffect(() => {
    writePanelOpen(TASKS_OPEN_KEY, tasksOpen());
  });
  createEffect(() => {
    writePanelOpen(INSPECTOR_OPEN_KEY, inspectorOpen());
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
    }
    wasBusy = busy;
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
  }

  function toggleInspectorPanel() {
    if (inspectorOpen()) {
      setInspectorOpen(false);
      return;
    }
    setInspectorOpen(true);
    if (props.model.tab() === "files") {
      setInspectorWidth((width) => Math.max(width, INSPECTOR_DEFAULT));
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
            onToggleTasks={() => setTasksOpen((open) => !open)}
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
                  onCollapse={() => setTasksOpen(false)}
                  onNewTask={startNewTask}
                  onSelectTask={(id) => void props.session.activateTask(id)}
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
              />
            </Show>

            <main class="main-panel-shell main-panel">
              <TaskHeader
                branch={git()?.branch}
                changeCount={git()?.files.length ?? 0}
                inspectorOpen={inspectorOpen()}
                loading={props.session.isCreatingSession()}
                playbookTitle={playbookTitle()}
                canExportSession={Boolean(
                  props.model.selectedTask()?.sessionPath ||
                    props.session.hostState()?.sessionPath,
                )}
                task={props.model.selectedTask()}
                status={props.session.status().runStatus}
                onClearPlaybook={() => void persistWorkflow(null, null)}
                onExportSession={() => void exportSession()}
                onReviewChanges={() => openReview()}
                onToggleInspectorPanel={toggleInspectorPanel}
              />
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
              <div class="chat-stage">
                <AgentTimeline
                  items={props.session.items()}
                  loading={props.session.isCreatingSession()}
                  loadingLabel="Opening session…"
                  status={props.session.status()}
                  pendingApprovalToolCallId={props.session.approval()?.toolCallId ?? null}
                  onAllowApproval={() => props.session.replyApproval(true)}
                  onDenyApproval={() => props.session.replyApproval(false)}
                  onPromptSuggestion={props.session.prefillDraft}
                />
                <Show when={props.model.selectedWorkspaceTask()?.workflow}>
                  {(workflow) => (
                    <WorkflowSteps
                      disabled={props.session.isCreatingSession()}
                      workflow={workflow()}
                      onWorkflowChange={(next, starter) => {
                        void persistWorkflow(next, starter);
                      }}
                    />
                  )}
                </Show>
              </div>
              <div class="composer-stack">
                <Composer
                  attentionKey={props.session.draftAttention()}
                  disabled={props.session.isCreatingSession()}
                  modelLabel={props.session.modelLabel()}
                  modelOptions={props.session.modelOptions()}
                  modelValue={props.session.modelValue()}
                  onAbort={() => void props.session.abort()}
                  onInput={props.session.setDraft}
                  onModelChange={(value) => void props.session.setModel(value)}
                  onSelectWorkspace={startNewTask}
                  onSubmit={() => void props.session.send()}
                  onThinkingChange={(value) => void props.session.setThinkingLevel(value)}
                  streaming={props.session.isBusy()}
                  thinkingLevel={props.session.thinkingLabel()}
                  thinkingOptions={props.session.thinkingOptions()}
                  thinkingValue={props.session.thinkingValue()}
                  toolbarAction={
                    <Tooltip label="协助抽取 Skill">
                      <IconButton
                        label="协助抽取 Skill"
                        nativeTooltip={false}
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
                    </Tooltip>
                  }
                  value={props.session.draft()}
                  workspaceLabel={props.session.workspaceLabel()}
                  workspaceTitle={props.session.workspaceTitle()}
                />
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
              />
            </Show>
            <div class="panel-slot panel-slot--right" data-open={inspectorOpen() ? "true" : "false"}>
              <div class="inspector-panel" inert={!inspectorOpen() || undefined}>
                <Inspector
                  cwd={props.session.cwd()}
                  items={props.session.items()}
                  refreshToken={inspectorRefresh()}
                  tab={props.model.tab()}
                  onCollapse={() => setInspectorOpen(false)}
                  onOpenReview={(path) => openReview(path)}
                  onTabChange={props.model.setTab}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

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
    </div>
  );
}
