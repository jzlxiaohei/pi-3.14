import { ChevronDown, ChevronRight, GitBranch, PanelLeft, Plus, Search, X } from "lucide-solid";
import { For, Show } from "solid-js";
import type { WorkspaceModel } from "../model";
import { Button } from "@/shared/ui/button";
import { IconButton } from "@/shared/ui/icon-button";

type TaskSidebarProps = {
  model: WorkspaceModel;
  onNewTask: () => void;
  onSelectTask: (id: string) => void;
};

export function TaskSidebar(props: TaskSidebarProps) {
  return (
    <aside class="sidebar">
      <div class="sidebar-head">
        <div>
          <p class="eyebrow">Workspace</p>
          <button class="workspace-switcher">
            Local tasks <ChevronDown size={14} strokeWidth={2.4} />
          </button>
        </div>
        <IconButton label="Collapse sidebar">
          <PanelLeft size={19} />
        </IconButton>
      </div>

      <Button class="new-task" variant="primary" onClick={props.onNewTask}>
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
        <span>{props.model.filteredTasks().length}</span>
      </div>

      <div class="task-list">
        <Show
          when={props.model.filteredTasks().length > 0}
          fallback={<p class="sidebar-empty">No tasks yet. Create one to start a PI session.</p>}
        >
          <For each={props.model.filteredTasks()}>
            {(task) => (
              <button
                class="task-row"
                data-selected={props.model.selectedTaskId() === task.id ? "true" : undefined}
                onClick={() => props.onSelectTask(task.id)}
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
        </Show>
      </div>

      <div class="sidebar-footer">
        <span class="usage-ring">{Math.min(99, props.model.tasks().length)}</span>
        <span class="sidebar-footer-copy">
          <strong>Saved tasks</strong>
          <small>Persisted locally with session resume</small>
        </span>
        <ChevronRight size={15} />
      </div>
    </aside>
  );
}
