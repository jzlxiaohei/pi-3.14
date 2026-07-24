import { randomUUID } from "node:crypto";
import { accessSync } from "node:fs";
import { join } from "node:path";
import type {
  AppPreferences,
  AppPreferencesUpdate,
  LegacyPanelPreferences,
  ReviewedFileUpdate,
  ReviewedFilesRequest,
  TaskWorkflow,
  WorkspacePreferences,
  WorkspacePreferencesUpdate,
  WorkspaceTask,
  WorkspaceTaskMoveRequest,
  WorkspaceTaskStatus,
} from "../../shared/desktop-contracts";
import { parseStringArray, parseWorkflow, uniqueStrings } from "./codecs";
import { openDatabase, transaction, type PieDatabase } from "./database";
import { importLegacyTasks } from "./legacy-task-import";
import { runMigrations } from "./migrations";

const BROWSER_IMPORT = "renderer-local-storage-v1";
const TASKS_MIN = 240;
const TASKS_MAX = 372;
const INSPECTOR_MIN = 360;
const INSPECTOR_MAX = 720;

type TaskRow = {
  id: string;
  parent_task_id: string | null;
  title: string;
  cwd: string;
  session_id: string | null;
  session_path: string | null;
  status: WorkspaceTaskStatus;
  position: number;
  created_at: number;
  updated_at: number;
  archived_at: number | null;
  workflow_json: string | null;
  ignored_skill_names_json: string;
};

type AppPreferencesRow = {
  theme: AppPreferences["theme"];
  tasks_open: number;
  inspector_open: number;
  tasks_width: number;
  inspector_width: number;
  inspector_tab: AppPreferences["inspectorTab"];
  show_archived: number;
};

export type StoreBootstrap = {
  rootTasks: WorkspaceTask[];
  activeTask: WorkspaceTask | null;
  activeRootTaskId: string | null;
  appPreferences: AppPreferences;
  workspacePreferences: Record<string, WorkspacePreferences>;
};

export type TreeMutationResult = {
  rootTasks: WorkspaceTask[];
  activeTaskId: string | null;
  activeRootTaskId: string | null;
};

export function openPieStore(userData: string): PieStore {
  const database = openDatabase(join(userData, "pie.sqlite3"));
  try {
    runMigrations(database);
    importLegacyTasks(database, join(userData, "pie-workspace-tasks.json"));
    const store = new PieStore(database);
    store.recoverInterrupted();
    return store;
  } catch (error) {
    database.close();
    throw error;
  }
}

export class PieStore {
  constructor(private readonly database: PieDatabase) {}

  recoverInterrupted(): void {
    transaction(this.database, () => {
      this.database.prepare("UPDATE tasks SET status = 'interrupted' WHERE status = 'running'").run();
    });
  }

  interruptIfRunning(taskId: string): void {
    this.database
      .prepare("UPDATE tasks SET status = 'interrupted' WHERE id = ? AND status = 'running'")
      .run(taskId);
  }

  idleIfRunning(taskId: string): void {
    this.database
      .prepare("UPDATE tasks SET status = 'idle' WHERE id = ? AND status = 'running'")
      .run(taskId);
  }

  async bootstrap(): Promise<StoreBootstrap> {
    const rootTasks = await this.listRootTasks();
    const activeTaskId = await this.getActiveId();
    const activeTask = activeTaskId ? await this.get(activeTaskId) : null;
    const activeRootTaskId = activeTask ? this.rootId(activeTask.id) : null;
    const workspacePreferences: Record<string, WorkspacePreferences> = {};
    for (const cwd of new Set(rootTasks.map((task) => task.cwd))) {
      workspacePreferences[cwd] = await this.getWorkspacePreferences(cwd);
    }
    return {
      rootTasks,
      activeTask,
      activeRootTaskId,
      appPreferences: await this.getAppPreferences(),
      workspacePreferences,
    };
  }

  async listRootTasks(): Promise<WorkspaceTask[]> {
    const rows = this.database
      .prepare("SELECT * FROM tasks WHERE parent_task_id IS NULL ORDER BY position, created_at")
      .all() as unknown as TaskRow[];
    const grouped = new Map<string, TaskRow[]>();
    for (const row of rows) {
      const list = grouped.get(row.cwd) ?? [];
      list.push(row);
      grouped.set(row.cwd, list);
    }
    return [...grouped.entries()]
      .sort(([, left], [, right]) => maxCreated(right) - maxCreated(left))
      .flatMap(([, group]) => group.map((row) => this.toTask(row)));
  }

  async listChildren(parentTaskId: string): Promise<WorkspaceTask[]> {
    return (
      this.database
        .prepare("SELECT * FROM tasks WHERE parent_task_id = ? ORDER BY position, created_at")
        .all(parentTaskId) as unknown as TaskRow[]
    ).map((row) => this.toTask(row));
  }

  async get(id: string): Promise<WorkspaceTask | null> {
    const row = this.database.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as
      | TaskRow
      | undefined;
    return row ? this.toTask(row) : null;
  }

  async getActiveId(): Promise<string | null> {
    const row = this.database
      .prepare("SELECT active_task_id FROM app_state WHERE singleton = 1")
      .get() as { active_task_id: string | null };
    return row.active_task_id;
  }

  async create(input: {
    cwd: string;
    title?: string;
    sessionPath: string;
    sessionId: string;
    parentTaskId?: string | null;
  }): Promise<WorkspaceTask> {
    if (!input.sessionId || !input.sessionPath) {
      throw new Error("New PIE Tasks require a persisted PI Session ID and path");
    }
    const now = Date.now();
    const id = randomUUID();
    const parentTaskId = input.parentTaskId ?? null;
    const folder = input.cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? input.cwd;
    transaction(this.database, () => {
      if (parentTaskId) {
        this.database
          .prepare("UPDATE tasks SET position = position + 1 WHERE parent_task_id = ?")
          .run(parentTaskId);
      } else {
        this.database
          .prepare(
            "UPDATE tasks SET position = position + 1 WHERE parent_task_id IS NULL AND cwd = ?",
          )
          .run(input.cwd);
      }
      this.database
        .prepare(`
          INSERT INTO tasks(
            id, parent_task_id, title, cwd, session_id, session_path, status,
            position, created_at, updated_at, archived_at, workflow_json,
            ignored_skill_names_json
          ) VALUES (?, ?, ?, ?, ?, ?, 'idle', 0, ?, ?, NULL, NULL, '[]')
        `)
        .run(
          id,
          parentTaskId,
          input.title?.trim() || `New task · ${folder}`,
          input.cwd,
          input.sessionId,
          input.sessionPath,
          now,
          now,
        );
      this.database
        .prepare("UPDATE app_state SET active_task_id = ? WHERE singleton = 1")
        .run(id);
    });
    return (await this.get(id))!;
  }

  async update(
    id: string,
    patch: Partial<
      Pick<
        WorkspaceTask,
        "title" | "cwd" | "sessionPath" | "sessionId" | "status" | "ignoredSkillNames"
      >
    > & { workflow?: TaskWorkflow | null },
    options: { touchUpdatedAt?: boolean } = {},
  ): Promise<WorkspaceTask | null> {
    const previous = await this.get(id);
    if (!previous) return null;
    const next = {
      ...previous,
      title: patch.title === undefined ? previous.title : patch.title,
      cwd: patch.cwd === undefined ? previous.cwd : patch.cwd,
      sessionPath:
        patch.sessionPath === undefined ? previous.sessionPath : patch.sessionPath,
      sessionId: patch.sessionId === undefined ? previous.sessionId : patch.sessionId,
      status: patch.status === undefined ? previous.status : patch.status,
      workflow:
        patch.workflow === null
          ? undefined
          : patch.workflow === undefined
            ? previous.workflow
            : patch.workflow,
      ignoredSkillNames:
        patch.ignoredSkillNames === undefined
          ? previous.ignoredSkillNames
          : uniqueStrings(patch.ignoredSkillNames),
      updatedAt: options.touchUpdatedAt === false ? previous.updatedAt : Date.now(),
    };
    this.database
      .prepare(`
        UPDATE tasks SET
          title = ?, cwd = ?, session_id = ?, session_path = ?, status = ?,
          updated_at = ?, workflow_json = ?, ignored_skill_names_json = ?
        WHERE id = ?
      `)
      .run(
        next.title,
        next.cwd,
        next.sessionId,
        next.sessionPath,
        next.status,
        next.updatedAt,
        next.workflow ? JSON.stringify(next.workflow) : null,
        JSON.stringify(next.ignoredSkillNames ?? []),
        id,
      );
    return this.get(id);
  }

  async setStatus(id: string, status: WorkspaceTaskStatus): Promise<WorkspaceTask | null> {
    return this.update(id, { status }, { touchUpdatedAt: false });
  }

  async setActiveTask(id: string | null): Promise<void> {
    this.database
      .prepare("UPDATE app_state SET active_task_id = ? WHERE singleton = 1")
      .run(id);
  }

  async moveRootTask(request: WorkspaceTaskMoveRequest): Promise<WorkspaceTask[]> {
    const task = this.taskRow(request.taskId);
    if (!task || task.parent_task_id !== null) throw new Error("Only Root Tasks can be reordered");
    if (request.beforeTaskId === task.id) return this.listRootTasks();
    const before = request.beforeTaskId ? this.taskRow(request.beforeTaskId) : null;
    if (before && (before.parent_task_id !== null || before.cwd !== task.cwd)) {
      throw new Error("Tasks can only be reordered within one workspace");
    }
    transaction(this.database, () => {
      const siblings = this.database
        .prepare(
          "SELECT id FROM tasks WHERE parent_task_id IS NULL AND cwd = ? ORDER BY position, created_at",
        )
        .all(task.cwd)
        .map((row) => (row as { id: string }).id)
        .filter((id) => id !== task.id);
      const index = before ? siblings.indexOf(before.id) : siblings.length;
      siblings.splice(index < 0 ? siblings.length : index, 0, task.id);
      const update = this.database.prepare("UPDATE tasks SET position = ? WHERE id = ?");
      siblings.forEach((id, position) => update.run(position, id));
    });
    return this.listRootTasks();
  }

  async archiveTree(id: string): Promise<TreeMutationResult> {
    const ids = this.subtreeIds(id);
    if (ids.length === 0) return this.treeResult();
    transaction(this.database, () => {
      const placeholders = ids.map(() => "?").join(", ");
      this.database
        .prepare(`UPDATE tasks SET archived_at = COALESCE(archived_at, ?) WHERE id IN (${placeholders})`)
        .run(Date.now(), ...ids);
      const active = this.activeIdSync();
      if (active && ids.includes(active)) {
        const fallback = this.firstActiveRootId();
        this.database
          .prepare("UPDATE app_state SET active_task_id = ? WHERE singleton = 1")
          .run(fallback);
      }
    });
    return this.treeResult();
  }

  async restoreTree(id: string): Promise<TreeMutationResult> {
    const ids = this.subtreeIds(id);
    if (ids.length === 0) return this.treeResult();
    const placeholders = ids.map(() => "?").join(", ");
    transaction(this.database, () => {
      this.database.prepare(`UPDATE tasks SET archived_at = NULL WHERE id IN (${placeholders})`).run(...ids);
    });
    return this.treeResult();
  }

  async relinkSession(id: string, sessionPath: string): Promise<WorkspaceTask> {
    this.database.prepare("UPDATE tasks SET session_path = ? WHERE id = ?").run(sessionPath, id);
    const task = await this.get(id);
    if (!task) throw new Error(`Unknown task: ${id}`);
    return task;
  }

  async getAppPreferences(): Promise<AppPreferences> {
    const row = this.database.prepare("SELECT * FROM app_preferences WHERE singleton = 1").get() as AppPreferencesRow;
    return toAppPreferences(row);
  }

  async updateAppPreferences(patch: AppPreferencesUpdate): Promise<AppPreferences> {
    const current = await this.getAppPreferences();
    const next: AppPreferences = {
      ...current,
      ...patch,
      tasksWidth: clamp(patch.tasksWidth ?? current.tasksWidth, TASKS_MIN, TASKS_MAX),
      inspectorWidth: clamp(
        patch.inspectorWidth ?? current.inspectorWidth,
        INSPECTOR_MIN,
        INSPECTOR_MAX,
      ),
    };
    this.database
      .prepare(`
        UPDATE app_preferences SET
          theme = ?, tasks_open = ?, inspector_open = ?, tasks_width = ?,
          inspector_width = ?, inspector_tab = ?, show_archived = ?
        WHERE singleton = 1
      `)
      .run(
        next.theme,
        bool(next.tasksOpen),
        bool(next.inspectorOpen),
        next.tasksWidth,
        next.inspectorWidth,
        next.inspectorTab,
        bool(next.showArchived),
      );
    return next;
  }

  async getWorkspacePreferences(cwd: string): Promise<WorkspacePreferences> {
    const row = this.database
      .prepare("SELECT * FROM workspace_preferences WHERE cwd = ?")
      .get(cwd) as
      | { cwd: string; task_group_collapsed: number; review_base_ref: string | null }
      | undefined;
    return row
      ? {
          cwd: row.cwd,
          taskGroupCollapsed: Boolean(row.task_group_collapsed),
          reviewBaseRef: row.review_base_ref,
        }
      : { cwd, taskGroupCollapsed: false, reviewBaseRef: null };
  }

  async updateWorkspacePreferences(
    cwd: string,
    patch: WorkspacePreferencesUpdate,
  ): Promise<WorkspacePreferences> {
    const current = await this.getWorkspacePreferences(cwd);
    const next = { ...current, ...patch, cwd };
    this.database
      .prepare(`
        INSERT INTO workspace_preferences(cwd, task_group_collapsed, review_base_ref)
        VALUES (?, ?, ?)
        ON CONFLICT(cwd) DO UPDATE SET
          task_group_collapsed = excluded.task_group_collapsed,
          review_base_ref = excluded.review_base_ref
      `)
      .run(cwd, bool(next.taskGroupCollapsed), next.reviewBaseRef);
    return next;
  }

  async getDraft(taskId: string): Promise<string> {
    const row = this.database
      .prepare("SELECT draft FROM task_drafts WHERE task_id = ?")
      .get(taskId) as { draft: string } | undefined;
    return row?.draft ?? "";
  }

  async saveDraft(taskId: string, draft: string): Promise<void> {
    this.database
      .prepare(`
        INSERT INTO task_drafts(task_id, draft, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(task_id) DO UPDATE SET draft = excluded.draft, updated_at = excluded.updated_at
      `)
      .run(taskId, draft, Date.now());
  }

  async getReviewedPaths(request: ReviewedFilesRequest): Promise<string[]> {
    const rows = this.database
      .prepare("SELECT path, fingerprint FROM reviewed_files WHERE cwd = ? AND base_ref = ?")
      .all(request.cwd, request.baseRef) as unknown as Array<{ path: string; fingerprint: string }>;
    const current = new Map(request.files.map((file) => [file.path, file.fingerprint]));
    const reviewed: string[] = [];
    const remove = this.database.prepare(
      "DELETE FROM reviewed_files WHERE cwd = ? AND base_ref = ? AND path = ?",
    );
    transaction(this.database, () => {
      for (const row of rows) {
        const fingerprint = current.get(row.path);
        if (fingerprint === row.fingerprint) reviewed.push(row.path);
        else if (fingerprint !== undefined) remove.run(request.cwd, request.baseRef, row.path);
      }
    });
    return reviewed;
  }

  async setReviewedFile(input: ReviewedFileUpdate): Promise<void> {
    this.database
      .prepare(`
        INSERT INTO reviewed_files(cwd, base_ref, path, fingerprint, reviewed_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(cwd, base_ref, path) DO UPDATE SET
          fingerprint = excluded.fingerprint,
          reviewed_at = excluded.reviewed_at
      `)
      .run(input.cwd, input.baseRef, input.path, input.fingerprint, Date.now());
  }

  async clearReviewedFile(input: Omit<ReviewedFileUpdate, "fingerprint">): Promise<void> {
    this.database
      .prepare("DELETE FROM reviewed_files WHERE cwd = ? AND base_ref = ? AND path = ?")
      .run(input.cwd, input.baseRef, input.path);
  }

  async importLegacyBrowserPreferences(
    input: LegacyPanelPreferences | undefined,
  ): Promise<boolean> {
    const found = this.database
      .prepare("SELECT 1 AS found FROM legacy_imports WHERE name = ?")
      .get(BROWSER_IMPORT);
    if (found) return true;
    transaction(this.database, () => {
      const current = toAppPreferences(
        this.database.prepare("SELECT * FROM app_preferences WHERE singleton = 1").get() as AppPreferencesRow,
      );
      const next = {
        ...current,
        ...(typeof input?.tasksOpen === "boolean" ? { tasksOpen: input.tasksOpen } : {}),
        ...(typeof input?.inspectorOpen === "boolean"
          ? { inspectorOpen: input.inspectorOpen }
          : {}),
      };
      this.database
        .prepare(
          "UPDATE app_preferences SET tasks_open = ?, inspector_open = ? WHERE singleton = 1",
        )
        .run(bool(next.tasksOpen), bool(next.inspectorOpen));
      this.database
        .prepare("INSERT INTO legacy_imports(name, completed_at, details_json) VALUES (?, ?, ?)")
        .run(BROWSER_IMPORT, Date.now(), JSON.stringify({ imported: Object.keys(input ?? {}) }));
    });
    return true;
  }

  close(): void {
    this.database.close();
  }

  private taskRow(id: string): TaskRow | null {
    return (this.database.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | undefined) ?? null;
  }

  private toTask(row: TaskRow): WorkspaceTask {
    const task: WorkspaceTask = {
      id: row.id,
      parentTaskId: row.parent_task_id,
      rootTaskId: this.rootId(row.id) ?? row.id,
      title: row.title,
      cwd: row.cwd,
      sessionId: row.session_id,
      sessionPath: row.session_path,
      sessionAvailability: fileAvailable(row.session_path) ? "available" : "missing",
      status: row.status,
      position: row.position,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
    if (row.archived_at !== null) task.archivedAt = row.archived_at;
    const workflow = parseWorkflow(row.workflow_json);
    if (workflow) task.workflow = workflow;
    const ignored = parseStringArray(row.ignored_skill_names_json);
    if (ignored.length > 0) task.ignoredSkillNames = ignored;
    return task;
  }

  private activeIdSync(): string | null {
    return (
      this.database.prepare("SELECT active_task_id FROM app_state WHERE singleton = 1").get() as {
        active_task_id: string | null;
      }
    ).active_task_id;
  }

  private rootId(id: string): string | null {
    const row = this.database
      .prepare(`
        WITH RECURSIVE ancestors(id, parent_task_id) AS (
          SELECT id, parent_task_id FROM tasks WHERE id = ?
          UNION ALL
          SELECT tasks.id, tasks.parent_task_id
          FROM tasks JOIN ancestors ON tasks.id = ancestors.parent_task_id
        )
        SELECT id FROM ancestors WHERE parent_task_id IS NULL LIMIT 1
      `)
      .get(id) as { id: string } | undefined;
    return row?.id ?? null;
  }

  private subtreeIds(id: string): string[] {
    return this.database
      .prepare(`
        WITH RECURSIVE subtree(id) AS (
          SELECT id FROM tasks WHERE id = ?
          UNION ALL
          SELECT tasks.id FROM tasks JOIN subtree ON tasks.parent_task_id = subtree.id
        )
        SELECT id FROM subtree
      `)
      .all(id)
      .map((row) => (row as { id: string }).id);
  }

  private firstActiveRootId(): string | null {
    const rows = this.database
      .prepare(`
        SELECT id, cwd, created_at, position
        FROM tasks
        WHERE parent_task_id IS NULL AND archived_at IS NULL
        ORDER BY position, created_at
      `)
      .all() as unknown as Array<{ id: string; cwd: string; created_at: number; position: number }>;
    if (rows.length === 0) return null;
    const newestByCwd = new Map<string, number>();
    for (const row of rows) {
      newestByCwd.set(row.cwd, Math.max(newestByCwd.get(row.cwd) ?? 0, row.created_at));
    }
    rows.sort((left, right) => {
      const group = (newestByCwd.get(right.cwd) ?? 0) - (newestByCwd.get(left.cwd) ?? 0);
      return group || left.position - right.position || left.created_at - right.created_at;
    });
    return rows[0]?.id ?? null;
  }

  private async treeResult(): Promise<TreeMutationResult> {
    const activeTaskId = this.activeIdSync();
    return {
      rootTasks: await this.listRootTasks(),
      activeTaskId,
      activeRootTaskId: activeTaskId ? this.rootId(activeTaskId) : null,
    };
  }
}

function maxCreated(rows: TaskRow[]): number {
  const visible = rows.filter((row) => row.archived_at === null);
  const source = visible.length > 0 ? visible : rows;
  return source.reduce((max, row) => Math.max(max, row.created_at), 0);
}

function fileAvailable(path: string | null): boolean {
  if (!path) return false;
  try {
    accessSync(path);
    return true;
  } catch {
    return false;
  }
}

function toAppPreferences(row: AppPreferencesRow): AppPreferences {
  return {
    theme: row.theme,
    tasksOpen: Boolean(row.tasks_open),
    inspectorOpen: Boolean(row.inspector_open),
    tasksWidth: clamp(row.tasks_width, TASKS_MIN, TASKS_MAX),
    inspectorWidth: clamp(row.inspector_width, INSPECTOR_MIN, INSPECTOR_MAX),
    inspectorTab: row.inspector_tab,
    showArchived: Boolean(row.show_archived),
  };
}

function bool(value: boolean): number {
  return value ? 1 : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.round(Math.min(max, Math.max(min, value)));
}
