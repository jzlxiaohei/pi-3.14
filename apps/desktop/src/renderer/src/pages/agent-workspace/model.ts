import { createMemo, createSignal, onMount } from "solid-js";
import type { WorkspaceTask } from "../../../../shared/desktop-contracts";

export type TaskStatus = WorkspaceTask["status"];
/** Right inspector: file tree + terminal; Diff Review is a Dialog. */
export type InspectorTab = "files" | "terminal";
export type Theme = "dark" | "light";

export type TaskSummary = {
  id: string;
  repo: string;
  status: TaskStatus;
  time: string;
  title: string;
  cwd: string;
  sessionPath: string | null;
};

export type TaskGroup = {
  cwd: string;
  label: string;
  tasks: WorkspaceTask[];
};

export type DiffLineKind = "added" | "context" | "removed";

export type DiffLine = {
  content: string;
  id: string;
  kind: DiffLineKind;
  newLine?: number;
  oldLine?: number;
};

export type DiffHunk = {
  header: string;
  id: string;
  lines: DiffLine[];
  newLines: number;
  newStart: number;
  oldLines: number;
  oldStart: number;
};

export type DiffFile = {
  additions: number;
  binary?: boolean;
  deletions: number;
  hunks: DiffHunk[];
  id: string;
  language?: string;
  oldPath?: string;
  path: string;
  status: "added" | "deleted" | "modified" | "renamed" | "untracked";
};

export function createWorkspaceModel() {
  const [tasks, setTasks] = createSignal<WorkspaceTask[]>([]);
  const [selectedTaskId, setSelectedTaskId] = createSignal<string | null>(null);
  const [query, setQuery] = createSignal("");
  const [tab, setTabRaw] = createSignal<InspectorTab>("files");
  const setTab = (next: InspectorTab) => {
    setTabRaw(next === "terminal" ? "terminal" : "files");
  };
  const [theme, setTheme] = createSignal<Theme>("light");
  const [bootstrapped, setBootstrapped] = createSignal(false);

  onMount(() => {
    void window.piDesktop.tasks.bootstrap().then((boot) => {
      setTasks(boot.tasks);
      setSelectedTaskId(boot.selectedTaskId);
      setBootstrapped(true);
    });
  });

  const normalizedQuery = createMemo(() => query().trim().toLowerCase());
  /** Preserve task object identity / array order — sidebar must not reshuffle on select. */
  const filteredTasks = createMemo(() => {
    const search = normalizedQuery();
    const list = tasks();
    if (!search) return list;
    return list.filter((task) => {
      const repo = task.cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? task.cwd;
      return (
        task.title.toLowerCase().includes(search) ||
        repo.toLowerCase().includes(search) ||
        task.cwd.toLowerCase().includes(search)
      );
    });
  });

  const selectedWorkspaceTask = createMemo(() => {
    const id = selectedTaskId();
    return tasks().find((item) => item.id === id) ?? null;
  });

  const selectedTask = createMemo(() => {
    const task = selectedWorkspaceTask();
    return task ? toSummary(task) : null;
  });

  /** Group filtered tasks by cwd; first-seen order follows task list (recent-first). */
  const taskGroups = createMemo((): TaskGroup[] => {
    const groups: TaskGroup[] = [];
    const indexByCwd = new Map<string, number>();
    for (const task of filteredTasks()) {
      let index = indexByCwd.get(task.cwd);
      if (index === undefined) {
        index = groups.length;
        indexByCwd.set(task.cwd, index);
        groups.push({
          cwd: task.cwd,
          label: task.cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? task.cwd,
          tasks: [],
        });
      }
      groups[index]!.tasks.push(task);
    }
    return groups;
  });

  return {
    bootstrapped,
    filteredTasks,
    taskGroups,
    query,
    selectedTask,
    selectedWorkspaceTask,
    selectedTaskId,
    tab,
    tasks,
    theme,
    clearSearch() {
      setQuery("");
    },
    replaceTasks(next: WorkspaceTask[], selectedId?: string | null) {
      setTasks(next);
      if (selectedId !== undefined) setSelectedTaskId(selectedId);
    },
    upsertTask(task: WorkspaceTask, select = true, moveToFront = false) {
      setTasks((current) => {
        const index = current.findIndex((item) => item.id === task.id);
        if (index < 0) return [task, ...current];
        if (moveToFront) {
          return [task, ...current.filter((item) => item.id !== task.id)];
        }
        const next = current.slice();
        next[index] = task;
        return next;
      });
      if (select) setSelectedTaskId(task.id);
    },
    selectTaskLocal(id: string) {
      setSelectedTaskId(id);
    },
    setQuery,
    setTab,
    toggleTheme() {
      setTheme((current) => (current === "light" ? "dark" : "light"));
    },
  };
}

export type WorkspaceModel = ReturnType<typeof createWorkspaceModel>;

export function toSummary(task: WorkspaceTask): TaskSummary {
  return {
    id: task.id,
    title: task.title,
    repo: task.cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? task.cwd,
    cwd: task.cwd,
    sessionPath: task.sessionPath,
    status: task.status,
    time: formatRelative(task.updatedAt),
  };
}

export function formatRelative(at: number): string {
  const delta = Date.now() - at;
  const minutes = Math.round(delta / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(at).toLocaleDateString();
}
