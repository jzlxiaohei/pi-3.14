import { createMemo, createSignal, onMount } from "solid-js";
import type { WorkspaceTask } from "../../../../shared/pi-ipc";

export type TaskStatus = WorkspaceTask["status"];
export type InspectorTab = "changes" | "terminal";
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
  status: "added" | "deleted" | "modified" | "renamed";
};

export function createWorkspaceModel() {
  const [tasks, setTasks] = createSignal<WorkspaceTask[]>([]);
  const [selectedTaskId, setSelectedTaskId] = createSignal<string | null>(null);
  const [query, setQuery] = createSignal("");
  const [tab, setTab] = createSignal<InspectorTab>("changes");
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
  const filteredTasks = createMemo(() => {
    const search = normalizedQuery();
    const summaries = tasks().map(toSummary);
    if (!search) return summaries;
    return summaries.filter((task) => {
      return (
        task.title.toLowerCase().includes(search) ||
        task.repo.toLowerCase().includes(search) ||
        task.cwd.toLowerCase().includes(search)
      );
    });
  });

  const selectedTask = createMemo(() => {
    const id = selectedTaskId();
    const task = tasks().find((item) => item.id === id);
    return task ? toSummary(task) : null;
  });

  return {
    bootstrapped,
    filteredTasks,
    query,
    selectedTask,
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
    upsertTask(task: WorkspaceTask, select = true) {
      setTasks((current) => {
        const without = current.filter((item) => item.id !== task.id);
        return [task, ...without].sort((a, b) => b.updatedAt - a.updatedAt);
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

function toSummary(task: WorkspaceTask): TaskSummary {
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

function formatRelative(at: number): string {
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
