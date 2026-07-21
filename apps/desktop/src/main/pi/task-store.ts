import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { WorkspaceTask, WorkspaceTaskStatus } from "../../shared/desktop-contracts";

type TaskStoreFile = {
  selectedTaskId: string | null;
  tasks: WorkspaceTask[];
};

const EMPTY: TaskStoreFile = { selectedTaskId: null, tasks: [] };

export class TaskStore {
  private data: TaskStoreFile = EMPTY;
  private loaded = false;

  constructor(private readonly filePath: string) {}

  async load(): Promise<TaskStoreFile> {
    if (this.loaded) return this.data;
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as TaskStoreFile;
      this.data = {
        selectedTaskId: typeof parsed.selectedTaskId === "string" ? parsed.selectedTaskId : null,
        tasks: Array.isArray(parsed.tasks) ? parsed.tasks.filter(isTask) : [],
      };
    } catch {
      this.data = { ...EMPTY, tasks: [] };
    }
    this.loaded = true;
    return this.data;
  }

  async list(): Promise<WorkspaceTask[]> {
    await this.load();
    return [...this.data.tasks].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async getSelectedId(): Promise<string | null> {
    await this.load();
    return this.data.selectedTaskId;
  }

  async get(id: string): Promise<WorkspaceTask | null> {
    await this.load();
    return this.data.tasks.find((task) => task.id === id) ?? null;
  }

  async create(input: {
    cwd: string;
    title?: string;
    sessionPath?: string | null;
    sessionId?: string | null;
  }): Promise<WorkspaceTask> {
    await this.load();
    const now = Date.now();
    const folder = input.cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? input.cwd;
    const task: WorkspaceTask = {
      id: randomUUID(),
      title: input.title?.trim() || `New task · ${folder}`,
      cwd: input.cwd,
      sessionPath: input.sessionPath ?? null,
      sessionId: input.sessionId ?? null,
      status: "idle",
      createdAt: now,
      updatedAt: now,
    };
    this.data.tasks.unshift(task);
    this.data.selectedTaskId = task.id;
    await this.persist();
    return task;
  }

  async update(
    id: string,
    patch: Partial<Pick<WorkspaceTask, "title" | "cwd" | "sessionPath" | "sessionId" | "status">>,
    options: { touchUpdatedAt?: boolean } = {},
  ): Promise<WorkspaceTask | null> {
    await this.load();
    const index = this.data.tasks.findIndex((task) => task.id === id);
    if (index < 0) return null;
    const prev = this.data.tasks[index]!;
    // Selecting/activating a task must not reshuffle the sidebar (sorted by updatedAt).
    const touchUpdatedAt = options.touchUpdatedAt !== false;
    const next = {
      ...prev,
      ...patch,
      updatedAt: touchUpdatedAt ? Date.now() : prev.updatedAt,
    };
    this.data.tasks[index] = next;
    await this.persist();
    return next;
  }

  async select(id: string | null): Promise<void> {
    await this.load();
    this.data.selectedTaskId = id;
    await this.persist();
  }

  async setStatus(id: string, status: WorkspaceTaskStatus): Promise<WorkspaceTask | null> {
    return this.update(id, { status });
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(this.data, null, 2)}\n`, "utf8");
  }
}

export function taskStorePath(userData: string): string {
  return join(userData, "pie-workspace-tasks.json");
}

function isTask(value: unknown): value is WorkspaceTask {
  if (typeof value !== "object" || value === null) return false;
  const task = value as WorkspaceTask;
  return (
    typeof task.id === "string" &&
    typeof task.title === "string" &&
    typeof task.cwd === "string" &&
    (task.sessionPath === null || typeof task.sessionPath === "string") &&
    (task.sessionId === null || typeof task.sessionId === "string") &&
    typeof task.createdAt === "number" &&
    typeof task.updatedAt === "number"
  );
}
