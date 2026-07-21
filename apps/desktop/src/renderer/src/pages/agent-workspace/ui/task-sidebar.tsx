import { ChevronDown, ChevronRight, GitBranch, PanelLeft, Plus, Search, X } from "lucide-solid";
import { For, Show } from "solid-js";
import type { WorkspaceModel } from "../model";
import { Button } from "@/shared/ui/button";
import { IconButton } from "@/shared/ui/icon-button";

type TaskSidebarProps = {
  model: WorkspaceModel;
};

export function TaskSidebar(props: TaskSidebarProps) {
  return (
    <aside class="sidebar">
      <div class="sidebar-head">
        <div>
          <p class="eyebrow">Workspace</p>
          <button class="workspace-switcher">
            Northstar <ChevronDown size={14} strokeWidth={2.4} />
          </button>
        </div>
        <IconButton label="Collapse sidebar">
          <PanelLeft size={19} />
        </IconButton>
      </div>

      <Button class="new-task" variant="primary" onClick={props.model.newTask}>
        <Plus size={17} strokeWidth={2.4} />
        New task
        <span>⌘ N</span>
      </Button>

      <label class="search-box">
        <Search size={16} />
        <input
          value={props.model.query()}
          onInput={(event) => props.model.setQuery(event.currentTarget.value)}
          placeholder="Search tasks"
        />
        <Show when={props.model.query()}>
          <button aria-label="Clear search" onClick={props.model.clearSearch}>
            <X size={13} />
          </button>
        </Show>
      </label>

      <div class="section-label">
        <span>Recent</span>
        <button>View all</button>
      </div>

      <div class="task-list">
        <For each={props.model.filteredTasks()}>
          {(task) => (
            <button
              class="task-row"
              data-selected={props.model.selectedTaskId() === task.id ? "true" : undefined}
              onClick={() => props.model.selectTask(task.id)}
            >
              <span class="status-dot" data-status={task.status} />
              <span class="task-copy">
                <strong>{task.title}</strong>
                <small><GitBranch size={12} /> {task.repo}</small>
              </span>
              <time>{task.time}</time>
            </button>
          )}
        </For>
      </div>

      <div class="sidebar-footer">
        <span class="usage-ring">68</span>
        <span class="sidebar-footer-copy">
          <strong>Weekly usage</strong>
          <small>32% remaining</small>
        </span>
        <ChevronRight size={15} />
      </div>
    </aside>
  );
}
