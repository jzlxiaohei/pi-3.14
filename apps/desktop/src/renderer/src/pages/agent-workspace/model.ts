import { createMemo, createSignal, onMount } from "solid-js";
import type {
  Agent,
  AppPreferences,
  WorkspacePreferences,
  WorkspaceTask,
} from "../../../../shared/desktop-contracts";

export type TaskStatus = WorkspaceTask["status"];
export type InspectorTab = AppPreferences["inspectorTab"];
export type Theme = AppPreferences["theme"];

export type TaskSummary = {
  id: string;
  repo: string;
  status: TaskStatus;
  time: string;
  title: string;
  cwd: string;
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

const DEFAULT_PREFERENCES: AppPreferences = {
  theme: "light",
  tasksOpen: true,
  inspectorOpen: false,
  tasksWidth: 264,
  inspectorWidth: 480,
  inspectorTab: "files",
  showArchived: false,
};
const TASKS_OPEN_KEY = "pie.panel.tasksOpen";
const INSPECTOR_OPEN_KEY = "pie.panel.inspectorOpen";

export function createWorkspaceModel() {
  const [tasks, setTasks] = createSignal<WorkspaceTask[]>([]);
  const [selectedTaskId, setSelectedTaskId] = createSignal<string | null>(null);
  const [activeTaskId, setActiveTaskId] = createSignal<string | null>(null);
  /** Agents keyed by task id — used for nested sidebar when workflow is cleared. */
  const [agentsByTaskId, setAgentsByTaskId] = createSignal<Record<string, Agent[]>>({});
  const [query, setQuery] = createSignal("");
  const [preferences, setPreferences] = createSignal<AppPreferences>(DEFAULT_PREFERENCES);
  const [workspacePreferences, setWorkspacePreferences] = createSignal<
    Record<string, WorkspacePreferences>
  >({});
  const [bootstrapped, setBootstrapped] = createSignal(false);

  onMount(() => {
    const legacyPanelPreferences = readLegacyPanelPreferences();
    void window.piDesktop.tasks
      .bootstrap({ legacyPanelPreferences })
      .then((boot) => {
        setTasks(boot.tasks ?? boot.rootTasks);
        setActiveTaskId(boot.activeTaskId ?? boot.activeTask?.id ?? null);
        setSelectedTaskId(boot.activeTaskId ?? boot.activeRootTaskId ?? null);
        setPreferences(boot.appPreferences);
        setWorkspacePreferences(boot.workspacePreferences);
        if (boot.agentsByTaskId) setAgentsByTaskId(boot.agentsByTaskId);
        if (boot.legacyBrowserPreferencesImported) clearLegacyPanelPreferences();
        // Ensure nested rows for the restored selection (bootstrap may only ship active slice).
        const selected = boot.activeTaskId ?? boot.activeRootTaskId;
        if (selected) void refreshAgents(selected);
      })
      .finally(() => setBootstrapped(true));
  });

  const normalizedQuery = createMemo(() => query().trim().toLowerCase());
  const archivedCount = createMemo(
    () => tasks().filter((task) => typeof task.archivedAt === "number").length,
  );
  const filteredTasks = createMemo(() => {
    const search = normalizedQuery();
    let list = tasks();
    if (!preferences().showArchived) {
      list = list.filter((task) => typeof task.archivedAt !== "number");
    }
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

  function updateAppPreference(patch: Partial<AppPreferences>): void {
    setPreferences((current) => ({ ...current, ...patch }));
    void window.piDesktop.preferences.updateApp(patch);
  }

  async function refreshAgents(taskId: string): Promise<Agent[]> {
    try {
      const agents = await window.piDesktop.agents.list(taskId);
      setAgentsByTaskId((current) => ({ ...current, [taskId]: agents }));
      return agents;
    } catch {
      return agentsByTaskId()[taskId] ?? [];
    }
  }

  return {
    activeTaskId,
    agentsByTaskId,
    agentsForTask(taskId: string): Agent[] {
      return agentsByTaskId()[taskId] ?? [];
    },
    refreshAgents,
    setAgentsForTask(taskId: string, agents: Agent[]) {
      setAgentsByTaskId((current) => ({ ...current, [taskId]: agents }));
    },
    archivedCount,
    bootstrapped,
    filteredTasks,
    taskGroups,
    query,
    selectedTask,
    selectedWorkspaceTask,
    selectedTaskId,
    showArchived: () => preferences().showArchived,
    tab: () => preferences().inspectorTab,
    tasks,
    theme: () => preferences().theme,
    tasksOpen: () => preferences().tasksOpen,
    inspectorOpen: () => preferences().inspectorOpen,
    tasksWidth: () => preferences().tasksWidth,
    inspectorWidth: () => preferences().inspectorWidth,
    clearSearch() {
      setQuery("");
    },
    replaceTasks(
      next: WorkspaceTask[],
      selectedId?: string | null,
      nextActiveTaskId?: string | null,
    ) {
      setTasks(next);
      if (selectedId !== undefined) setSelectedTaskId(selectedId);
      if (nextActiveTaskId !== undefined) setActiveTaskId(nextActiveTaskId);
    },
    upsertTask(task: WorkspaceTask, select = true, _moveToFront = false) {
      setTasks((current) => {
        const index = current.findIndex((item) => item.id === task.id);
        if (index < 0) return [task, ...current];
        const next = current.slice();
        next[index] = task;
        return next;
      });
      setActiveTaskId(task.id);
      if (select) setSelectedTaskId(task.id);
    },
    selectTaskLocal(id: string | null) {
      setSelectedTaskId(id);
    },
    setQuery,
    setShowArchived(value: boolean) {
      updateAppPreference({ showArchived: value });
    },
    setTab(value: InspectorTab) {
      updateAppPreference({ inspectorTab: value });
    },
    setTasksOpen(value: boolean) {
      updateAppPreference({ tasksOpen: value });
    },
    setInspectorOpen(value: boolean) {
      updateAppPreference({ inspectorOpen: value });
    },
    commitTasksWidth(value: number) {
      updateAppPreference({ tasksWidth: value });
    },
    commitInspectorWidth(value: number) {
      updateAppPreference({ inspectorWidth: value });
    },
    isGroupCollapsed(cwd: string): boolean {
      return workspacePreferences()[cwd]?.taskGroupCollapsed ?? false;
    },
    setGroupCollapsed(cwd: string, collapsed: boolean) {
      setWorkspacePreferences((current) => ({
        ...current,
        [cwd]: {
          cwd,
          reviewBaseRef: current[cwd]?.reviewBaseRef ?? null,
          taskGroupCollapsed: collapsed,
        },
      }));
      void window.piDesktop.preferences
        .updateWorkspace(cwd, { taskGroupCollapsed: collapsed })
        .then((next) => setWorkspacePreferences((current) => ({ ...current, [cwd]: next })));
    },
    async moveTask(taskId: string, beforeTaskId: string | null) {
      const next = await window.piDesktop.tasks.move({ taskId, beforeTaskId });
      setTasks(next);
    },
    toggleTheme() {
      updateAppPreference({ theme: preferences().theme === "light" ? "dark" : "light" });
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

function readLegacyPanelPreferences(): { tasksOpen?: boolean; inspectorOpen?: boolean } {
  const result: { tasksOpen?: boolean; inspectorOpen?: boolean } = {};
  try {
    const tasks = localStorage.getItem(TASKS_OPEN_KEY);
    const inspector = localStorage.getItem(INSPECTOR_OPEN_KEY);
    if (tasks === "true" || tasks === "false") result.tasksOpen = tasks === "true";
    if (inspector === "true" || inspector === "false") result.inspectorOpen = inspector === "true";
  } catch {
    // SQLite defaults remain authoritative when browser storage is unavailable.
  }
  return result;
}

function clearLegacyPanelPreferences(): void {
  try {
    localStorage.removeItem(TASKS_OPEN_KEY);
    localStorage.removeItem(INSPECTOR_OPEN_KEY);
  } catch {
    // The import marker prevents applying them again if browser storage cannot be cleared.
  }
}
