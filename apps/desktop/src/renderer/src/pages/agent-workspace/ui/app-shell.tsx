import { Command, GitBranch, Moon, Sun } from "lucide-solid";
import type { WorkspaceModel } from "../model";
import { Button } from "@/shared/ui/button";
import { SplitterHandle, SplitterPanel, SplitterRoot } from "@/shared/ui/splitter";
import { Inspector } from "./inspector";
import { Rail } from "./rail";
import { TaskHeader } from "./task-header";
import { TaskSidebar } from "./task-sidebar";
import { AgentTimeline } from "./agent-timeline";
import { Composer } from "./composer";

type AppShellProps = {
  model: WorkspaceModel;
};

export function AppShell(props: AppShellProps) {
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
              orbit-labs
            </Button>
          </div>
        </div>

        <div class="workspace-grid">
          <Rail onNewTask={props.model.newTask} />
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
              <TaskSidebar model={props.model} />
            </SplitterPanel>
            <SplitterHandle id="tasks:main" label="Resize task sidebar" />
            <SplitterPanel id="main" class="main-panel-shell">
              <main class="main-panel">
                <TaskHeader task={props.model.selectedTask()} isComplete={props.model.isComplete()} />
                <AgentTimeline isComplete={props.model.isComplete()} onComplete={props.model.markComplete} />
                <Composer onSend={props.model.sendFollowUp} />
              </main>
            </SplitterPanel>
            <SplitterHandle id="main:inspector" label="Resize inspector" />
            <SplitterPanel id="inspector" class="inspector-panel">
              <Inspector tab={props.model.tab()} onTabChange={props.model.setTab} />
            </SplitterPanel>
          </SplitterRoot>
        </div>
      </div>
    </div>
  );
}
