import { Command, GitBranch, Moon, Sun } from "lucide-solid";
import { createEffect, createSignal } from "solid-js";
import type { WorkspaceGitSnapshot } from "../../../../../shared/desktop-contracts";
import type { WorkspaceModel } from "../model";
import type { AgentWorkspaceSession } from "../session";
import { AgentTimeline, Composer } from "@/features/agent-timeline/solid";
import { Button } from "@/shared/ui/button";
import { SplitterHandle, SplitterPanel, SplitterRoot } from "@/shared/ui/splitter";
import { Inspector } from "./inspector";
import { Rail } from "./rail";
import { TaskHeader } from "./task-header";
import { TaskSidebar } from "./task-sidebar";
import { ToolApprovalBanner } from "./tool-approval-banner";

type AppShellProps = {
  model: WorkspaceModel;
  session: AgentWorkspaceSession;
};

export function AppShell(props: AppShellProps) {
  const [git, setGit] = createSignal<WorkspaceGitSnapshot | null>(null);
  const [inspectorRefresh, setInspectorRefresh] = createSignal(0);

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

  function reviewChanges() {
    props.model.setTab("changes");
    setInspectorRefresh((value) => value + 1);
    const cwd = props.session.cwd();
    if (cwd) void window.piDesktop.workspace.git(cwd).then(setGit).catch(() => setGit(null));
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
          <Rail onNewTask={startNewTask} />
          <SplitterRoot
            class="workspace-splitter"
            defaultSize={["264px", "1fr", "390px"]}
            panels={[
              { id: "tasks", minSize: "220px", maxSize: "360px", resizeBehavior: "preserve-pixel-size" },
              { id: "main", minSize: "430px" },
              { id: "inspector", minSize: "320px", maxSize: "520px", resizeBehavior: "preserve-pixel-size" }
            ]}
          >
            <SplitterPanel id="tasks" class="sidebar-panel">
              <TaskSidebar
                model={props.model}
                onNewTask={startNewTask}
                onSelectTask={(id) => void props.session.activateTask(id)}
              />
            </SplitterPanel>
            <SplitterHandle id="tasks:main" label="Resize task sidebar" />
            <SplitterPanel id="main" class="main-panel-shell">
              <main class="main-panel">
                <TaskHeader
                  branch={git()?.branch}
                  task={props.model.selectedTask()}
                  status={props.session.status().runStatus}
                  onReviewChanges={reviewChanges}
                />
                <ToolApprovalBanner
                  request={props.session.approval()}
                  onAllow={() => props.session.replyApproval(true)}
                  onDeny={() => props.session.replyApproval(false)}
                />
                <AgentTimeline
                  items={props.session.items()}
                  status={props.session.status()}
                  pendingApprovalToolCallId={props.session.approval()?.toolCallId ?? null}
                  onAllowApproval={() => props.session.replyApproval(true)}
                  onDenyApproval={() => props.session.replyApproval(false)}
                />
                <Composer
                  disabled={props.session.isCreatingSession()}
                  errorMessage={props.session.status().errorMessage}
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
            </SplitterPanel>
            <SplitterHandle id="main:inspector" label="Resize inspector" />
            <SplitterPanel id="inspector" class="inspector-panel">
              <Inspector
                cwd={props.session.cwd()}
                items={props.session.items()}
                refreshToken={inspectorRefresh()}
                tab={props.model.tab()}
                onTabChange={props.model.setTab}
              />
            </SplitterPanel>
          </SplitterRoot>
        </div>
      </div>
    </div>
  );
}
