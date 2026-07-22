import { Command, GitBranch, Moon, Sun } from "lucide-solid";
import { createEffect, createSignal, Show } from "solid-js";
import type { WorkspaceGitSnapshot } from "../../../../../shared/desktop-contracts";
import type { InspectorTab, WorkspaceModel } from "../model";
import type { AgentWorkspaceSession } from "../session";
import { AgentTimeline, Composer } from "@/features/agent-timeline/solid";
import { Button } from "@/shared/ui/button";
import { Inspector } from "./inspector";
import { PanelResizeHandle } from "./panel-resize-handle";
import { Rail } from "./rail";
import { TaskHeader } from "./task-header";
import { TaskSidebar } from "./task-sidebar";
import { ToolApprovalBanner } from "./tool-approval-banner";

type AppShellProps = {
  model: WorkspaceModel;
  session: AgentWorkspaceSession;
};

const TASKS_MIN = 240;
const TASKS_MAX = 372;
const TASKS_DEFAULT = 264;
const INSPECTOR_MIN = 300;
const INSPECTOR_MAX = 520;
const INSPECTOR_DEFAULT = 340;

export function AppShell(props: AppShellProps) {
  const [git, setGit] = createSignal<WorkspaceGitSnapshot | null>(null);
  const [inspectorRefresh, setInspectorRefresh] = createSignal(0);
  const [tasksOpen, setTasksOpen] = createSignal(false);
  const [inspectorOpen, setInspectorOpen] = createSignal(false);
  const [tasksWidth, setTasksWidth] = createSignal(TASKS_DEFAULT);
  const [inspectorWidth, setInspectorWidth] = createSignal(INSPECTOR_DEFAULT);

  let wasBusy = false;
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
    void props.session.createNewTask();
  }

  function refreshInspector() {
    setInspectorRefresh((value) => value + 1);
    const cwd = props.session.cwd();
    if (cwd) void window.piDesktop.workspace.git(cwd).then(setGit).catch(() => setGit(null));
  }

  function openInspector(tab: InspectorTab) {
    setInspectorOpen(true);
    props.model.setTab(tab);
    if (tab === "changes") refreshInspector();
  }

  /** Rail: open to tab, or close if that tab is already showing. */
  function toggleInspector(tab: InspectorTab) {
    if (inspectorOpen() && props.model.tab() === tab) {
      setInspectorOpen(false);
      return;
    }
    openInspector(tab);
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
            <Button variant="secondary">
              <GitBranch size={15} />
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
                inspectorTab={props.model.tab()}
                loading={props.session.isCreatingSession()}
                task={props.model.selectedTask()}
                status={props.session.status().runStatus}
                onReviewChanges={() => openInspector("changes")}
                onToggleInspector={toggleInspector}
              />
              <ToolApprovalBanner
                request={props.session.approval()}
                onAllow={() => props.session.replyApproval(true)}
                onDeny={() => props.session.replyApproval(false)}
              />
              <AgentTimeline
                items={props.session.items()}
                loading={props.session.isCreatingSession()}
                loadingLabel="Opening session…"
                status={props.session.status()}
                pendingApprovalToolCallId={props.session.approval()?.toolCallId ?? null}
                onAllowApproval={() => props.session.replyApproval(true)}
                onDenyApproval={() => props.session.replyApproval(false)}
                onPromptSuggestion={props.session.setDraft}
              />
              <Composer
                disabled={props.session.isCreatingSession()}
                modelLabel={props.session.modelLabel()}
                onAbort={() => void props.session.abort()}
                onInput={props.session.setDraft}
                onSelectWorkspace={() => void props.session.createNewTask()}
                onSubmit={() => void props.session.send()}
                streaming={props.session.isBusy()}
                thinkingLevel={props.session.thinkingLabel()}
                value={props.session.draft()}
                workspaceLabel={props.session.workspaceLabel()}
                workspaceTitle={props.session.workspaceTitle()}
              />
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
                  onTabChange={props.model.setTab}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
