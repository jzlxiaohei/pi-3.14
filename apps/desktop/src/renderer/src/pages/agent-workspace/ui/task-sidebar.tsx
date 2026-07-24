import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Folder,
  GripVertical,
  LoaderCircle,
  PanelLeft,
  Plus,
  Search,
  X,
} from "lucide-solid";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import {
  draggable,
  dropTargetForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { WorkspaceTask } from "../../../../../shared/desktop-contracts";
import { formatRelative, type WorkspaceModel } from "../model";
import { writeClipboardText } from "@/shared/clipboard";
import { Button } from "@/shared/ui/button";
import { IconButton } from "@/shared/ui/icon-button";
import { Tooltip } from "@/shared/ui/tooltip";
import { ArchiveTaskDialog } from "./delete-task-dialog";
import { TaskIdChip } from "./task-id-chip";

type TaskSidebarProps = {
  loadingTaskId?: string | null;
  model: WorkspaceModel;
  onCollapse: () => void;
  onNewTask: () => void;
  onSelectTask: (id: string) => void;
  onArchiveTask: (id: string) => void | Promise<void>;
  onUnarchiveTask: (id: string) => void | Promise<void>;
};

function isArchived(task: WorkspaceTask): boolean {
  return typeof task.archivedAt === "number";
}

export function TaskSidebar(props: TaskSidebarProps) {
  const [pendingArchive, setPendingArchive] = createSignal<WorkspaceTask | null>(null);
  const [archiving, setArchiving] = createSignal(false);

  function isGroupCollapsed(cwd: string) {
    return props.model.isGroupCollapsed(cwd);
  }

  function toggleGroup(cwd: string) {
    props.model.setGroupCollapsed(cwd, !isGroupCollapsed(cwd));
  }

  async function confirmArchive() {
    const task = pendingArchive();
    if (!task || archiving()) return;
    setArchiving(true);
    try {
      await props.onArchiveTask(task.id);
      setPendingArchive(null);
    } finally {
      setArchiving(false);
    }
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

      <label class="sidebar-archived-toggle">
        <input
          type="checkbox"
          checked={props.model.showArchived()}
          onChange={(event) => props.model.setShowArchived(event.currentTarget.checked)}
        />
        <span>
          显示已归档
          <Show when={props.model.archivedCount() > 0}>
            <small>{props.model.archivedCount()}</small>
          </Show>
        </span>
      </label>

      <div class="task-list">
        <Show
          when={props.model.taskGroups().length > 0}
          fallback={
            <p class="sidebar-empty">
              {props.model.archivedCount() > 0 && !props.model.showArchived()
                ? "没有进行中的任务。勾选上方可查看已归档。"
                : "No tasks yet. Create one to start a PI session."}
            </p>
          }
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
                        {(task, index) => (
                          <SortableTaskRow
                            task={task}
                            nextTaskId={() => group.tasks[index() + 1]?.id ?? null}
                            opening={props.loadingTaskId === task.id}
                            selected={props.model.selectedTaskId() === task.id}
                            busy={archiving()}
                            onSelect={() => props.onSelectTask(task.id)}
                            onArchive={() => setPendingArchive(task)}
                            onUnarchive={() => void props.onUnarchiveTask(task.id)}
                            onMove={(taskId, beforeTaskId) =>
                              void props.model.moveTask(taskId, beforeTaskId)
                            }
                          />
                        )}
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
        <span class="usage-ring">{Math.min(99, props.model.activeCount())}</span>
        <span class="sidebar-footer-copy">
          <strong>Saved tasks</strong>
          <small>
            {props.model.archivedCount() > 0
              ? `${props.model.activeCount()} active · ${props.model.archivedCount()} archived`
              : "Persisted locally with session resume"}
          </small>
        </span>
        <ChevronRight size={15} />
      </div>

      <ArchiveTaskDialog
        task={pendingArchive()}
        busy={archiving()}
        onOpenChange={(open) => {
          if (!open && !archiving()) setPendingArchive(null);
        }}
        onConfirm={() => void confirmArchive()}
      />
    </aside>
  );
}

function SortableTaskRow(props: {
  task: WorkspaceTask;
  nextTaskId: () => string | null;
  opening: boolean;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onMove: (taskId: string, beforeTaskId: string | null) => void;
}) {
  let row!: HTMLDivElement;
  let handle!: HTMLButtonElement;
  const archived = () => isArchived(props.task);

  onMount(() => {
    if (archived()) return;
    const cleanup = combine(
      draggable({
        element: handle,
        getInitialData: () => ({
          type: "pie-root-task",
          taskId: props.task.id,
          cwd: props.task.cwd,
        }),
      }),
      dropTargetForElements({
        element: row,
        canDrop: ({ source }) =>
          source.data.type === "pie-root-task" && source.data.cwd === props.task.cwd,
        onDrop: ({ source, location }) => {
          const sourceId = source.data.taskId;
          if (typeof sourceId !== "string" || sourceId === props.task.id) return;
          const belowMiddle =
            location.current.input.clientY >
            row.getBoundingClientRect().top + row.offsetHeight / 2;
          const beforeTaskId = belowMiddle ? props.nextTaskId() : props.task.id;
          if (beforeTaskId === sourceId) return;
          props.onMove(sourceId, beforeTaskId);
        },
      }),
    );
    onCleanup(cleanup);
  });

  return (
    <div
      ref={row}
      class="task-row-wrap"
      data-task-id={props.task.id}
      data-archived={archived() ? "true" : undefined}
      data-selected={props.selected ? "true" : undefined}
      data-loading={props.opening ? "true" : undefined}
    >
      <button
        ref={handle}
        type="button"
        class="task-row-drag"
        data-hidden={archived() ? "true" : undefined}
        aria-label={`Reorder ${props.task.title}`}
        disabled={archived() || props.busy || props.opening}
        onClick={(event) => event.stopPropagation()}
      >
        <GripVertical size={13} />
      </button>
      <button type="button" class="task-row" onClick={props.onSelect}>
        <Show
          when={props.opening}
          fallback={<span class="status-dot" data-status={props.task.status} />}
        >
          <LoaderCircle class="at-spin task-row-spinner" size={12} />
        </Show>
        <span class="task-copy">
          <strong>
            {props.task.title}
            <Show when={archived()}>
              <em class="task-archived-badge">已归档</em>
            </Show>
            <Show when={props.task.status === "interrupted"}>
              <em class="task-interrupted-badge">已中断</em>
            </Show>
          </strong>
          <span class="task-meta-line">
            <time>{props.opening ? "…" : formatRelative(props.task.updatedAt)}</time>
            <TaskIdChip id={props.task.id} />
          </span>
        </span>
      </button>
      <Show
        when={archived()}
        fallback={
          <IconButton
            label="归档任务"
            size="sm"
            variant="danger"
            disabled={props.busy || props.opening}
            onClick={(event) => {
              event.stopPropagation();
              props.onArchive();
            }}
          >
            <Archive size={13} />
          </IconButton>
        }
      >
        <IconButton
          label="恢复任务"
          size="sm"
          disabled={props.busy || props.opening}
          onClick={(event) => {
            event.stopPropagation();
            props.onUnarchive();
          }}
        >
          <ArchiveRestore size={13} />
        </IconButton>
      </Show>
    </div>
  );
}

/** Hover-revealed copy of the full workspace path (tooltip stays for reading). */
function GroupPathCopy(props: { path: string }) {
  const [copied, setCopied] = createSignal(false);
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;

  async function copy(event: Event) {
    event.preventDefault();
    event.stopPropagation();
    const ok = await writeClipboardText(props.path);
    if (!ok) return;
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
