import { Check, ChevronDown, ChevronRight, Copy, Folder, LoaderCircle, PanelLeft, Plus, Search, X } from "lucide-solid";
import { createSignal, For, Show } from "solid-js";
import { formatRelative, type WorkspaceModel } from "../model";
import { Button } from "@/shared/ui/button";
import { IconButton } from "@/shared/ui/icon-button";
import { Tooltip } from "@/shared/ui/tooltip";
import { TaskIdChip } from "./task-id-chip";

type TaskSidebarProps = {
  loadingTaskId?: string | null;
  model: WorkspaceModel;
  onCollapse: () => void;
  onNewTask: () => void;
  onSelectTask: (id: string) => void;
};

export function TaskSidebar(props: TaskSidebarProps) {
  const [collapsedByCwd, setCollapsedByCwd] = createSignal<Record<string, boolean>>({});

  function isGroupCollapsed(cwd: string) {
    return collapsedByCwd()[cwd] === true;
  }

  function toggleGroup(cwd: string) {
    setCollapsedByCwd((prev) => ({ ...prev, [cwd]: !prev[cwd] }));
  }

  return (
    <aside class="sidebar">
      <div class="sidebar-head">
        <div>
          <p class="eyebrow">Workspace</p>
          <button class="workspace-switcher">
            Local tasks <ChevronDown size={14} strokeWidth={2.4} />
          </button>
        </div>
        <IconButton label="Collapse sidebar" size="sm" onClick={props.onCollapse}>
          <PanelLeft size={17} />
        </IconButton>
      </div>

      <Button class="new-task" variant="secondary" onClick={props.onNewTask}>
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

      <div class="task-list">
        <Show
          when={props.model.taskGroups().length > 0}
          fallback={<p class="sidebar-empty">No tasks yet. Create one to start a PI session.</p>}
        >
          <For each={props.model.taskGroups()}>
            {(group) => {
              const collapsed = () => isGroupCollapsed(group.cwd);
              return (
                <section class="task-group" data-collapsed={collapsed() ? "true" : undefined}>
                  <div class="task-group-head-row">
                    <Tooltip label={group.cwd}>
                      <button
                        type="button"
                        class="task-group-head"
                        aria-expanded={!collapsed()}
                        onClick={() => toggleGroup(group.cwd)}
                      >
                        <Show when={collapsed()} fallback={<ChevronDown size={12} strokeWidth={2.4} />}>
                          <ChevronRight size={12} strokeWidth={2.4} />
                        </Show>
                        <Folder size={13} />
                        <span>{group.label}</span>
                        <small>{group.tasks.length}</small>
                      </button>
                    </Tooltip>
                    <GroupPathCopy path={group.cwd} />
                  </div>
                  <Show when={!collapsed()}>
                    <div class="task-group-list">
                      <For each={group.tasks}>
                        {(task) => {
                          const opening = () => props.loadingTaskId === task.id;
                          return (
                            <button
                              class="task-row"
                              data-task-id={task.id}
                              data-selected={props.model.selectedTaskId() === task.id ? "true" : undefined}
                              data-loading={opening() ? "true" : undefined}
                              onClick={() => props.onSelectTask(task.id)}
                            >
                              <Show
                                when={opening()}
                                fallback={<span class="status-dot" data-status={task.status} />}
                              >
                                <LoaderCircle class="at-spin task-row-spinner" size={12} />
                              </Show>
                              <span class="task-copy">
                                <strong>{task.title}</strong>
                                <span class="task-meta-line">
                                  <time>{opening() ? "…" : formatRelative(task.updatedAt)}</time>
                                  <TaskIdChip id={task.id} />
                                </span>
                              </span>
                            </button>
                          );
                        }}
                      </For>
                    </div>
                  </Show>
                </section>
              );
            }}
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

/** Hover-revealed copy of the full workspace path (tooltip stays for reading). */
function GroupPathCopy(props: { path: string }) {
  const [copied, setCopied] = createSignal(false);
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;

  async function copy(event: Event) {
    event.preventDefault();
    event.stopPropagation();
    await navigator.clipboard.writeText(props.path);
    setCopied(true);
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => setCopied(false), 1200);
  }

  return (
    <button
      type="button"
      class="task-group-copy"
      classList={{ "task-group-copy--copied": copied() }}
      aria-label={copied() ? "Copied" : "Copy folder path"}
      title={copied() ? "Copied" : "Copy path"}
      onClick={(event) => void copy(event)}
    >
      {copied() ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}
