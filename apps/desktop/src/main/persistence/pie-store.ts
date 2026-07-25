import { randomUUID } from "node:crypto";
import { accessSync, renameSync } from "node:fs";
import { join } from "node:path";
import type {
  Agent,
  AgentStatus,
  AgentTemplate,
  AgentTemplateCreateRequest,
  AgentTemplateDeleteResult,
  AgentTemplateResetResult,
  AgentTemplateSource,
  AgentTemplateUpdateRequest,
  AppPreferences,
  AppPreferencesUpdate,
  LegacyPanelPreferences,
  ReviewedFileUpdate,
  ReviewedFilesRequest,
  SkillPolicy,
  Task,
  TaskStatus,
  TaskWorkflow,
  WorkspacePreferences,
  WorkspacePreferencesUpdate,
  WorkspaceTaskMoveRequest,
} from "../../shared/desktop-contracts";
import { SYSTEM_TEMPLATE_SEEDS } from "../../shared/playbook-templates";
import { rollupTaskStatus } from "../../shared/task-status";
import { parseSkillPolicy, parseWorkflow, uniqueStrings } from "./codecs";
import { openDatabase, transaction, type PieDatabase } from "./database";
import { CURRENT_VERSION, readSchemaVersion, runMigrations } from "./migrations";
import { recoverPreSplitCatalogIfEmpty } from "./recover-pre-split-catalog";

const BROWSER_IMPORT = "renderer-local-storage-v1";
const TASKS_MIN = 240;
const TASKS_MAX = 372;
const INSPECTOR_MIN = 360;
const INSPECTOR_MAX = 720;

type TaskRow = {
  id: string;
  title: string;
  cwd: string;
  status: TaskStatus;
  position: number;
  created_at: number;
  updated_at: number;
  archived_at: number | null;
  workflow_json: string | null;
};

type AgentRow = {
  id: string;
  task_id: string;
  parent_agent_id: string | null;
  template_id: string | null;
  name: string;
  system_prompt: string;
  skill_policy_json: string;
  input_context: string | null;
  output_context: string | null;
  session_id: string | null;
  session_path: string | null;
  role_prompt_confirmed_at: number | null;
  status: AgentStatus;
  position: number;
  created_at: number;
  updated_at: number;
};

type TemplateRow = {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  skill_policy_json: string;
  source: AgentTemplateSource;
  created_at: number;
  updated_at: number;
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
  tasks: Task[];
  activeTask: Task | null;
  activeTaskId: string | null;
  activeAgent: Agent | null;
  activeAgentId: string | null;
  agentsByTaskId: Record<string, Agent[]>;
  appPreferences: AppPreferences;
  workspacePreferences: Record<string, WorkspacePreferences>;
};

export type TreeMutationResult = {
  tasks: Task[];
  activeTaskId: string | null;
  activeAgentId: string | null;
};

/**
 * Open PIE catalog DB.
 * - version 0: fresh migrate
 * - version >= 2 and <= CURRENT: in-place migrations (additive)
 * - version 1 / other pre-split: rename old file (JSONL never deleted) and create fresh
 * - version > CURRENT: rejected inside runMigrations
 */
export function openPieStore(userData: string): PieStore {
  const dbPath = join(userData, "pie.sqlite3");
  let database = openDatabase(dbPath);
  try {
    const version = readSchemaVersion(database);
    // Hard-reset only catalogs that predate the Task/Agent split (v2).
    if (version > 0 && version < 2) {
      database.close();
      const backup = join(userData, `pie.sqlite3.pre-agent-split-${Date.now()}`);
      try {
        renameSync(dbPath, backup);
        console.warn(
          `[pie-store] catalog schema ${version} predates agent split; moved to ${backup}`,
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      database = openDatabase(dbPath);
    }
    runMigrations(database);
    // Greenfield wipe keeps JSONL; rehydrate Task list from pre-split backup once.
    recoverPreSplitCatalogIfEmpty(database, userData);
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
      this.database
        .prepare("UPDATE agents SET status = 'interrupted' WHERE status = 'running'")
        .run();
    });
    // Recompute task rollups for interrupted agents.
    const taskIds = this.database
      .prepare("SELECT DISTINCT task_id FROM agents WHERE status = 'interrupted'")
      .all()
      .map((row) => (row as { task_id: string }).task_id);
    for (const taskId of taskIds) this.recomputeTaskStatus(taskId);
  }

  interruptIfRunning(agentId: string): void {
    this.database
      .prepare("UPDATE agents SET status = 'interrupted' WHERE id = ? AND status = 'running'")
      .run(agentId);
    const agent = this.agentRow(agentId);
    if (agent) this.recomputeTaskStatus(agent.task_id);
  }

  idleIfRunning(agentId: string): void {
    this.database
      .prepare("UPDATE agents SET status = 'idle' WHERE id = ? AND status = 'running'")
      .run(agentId);
    const agent = this.agentRow(agentId);
    if (agent) this.recomputeTaskStatus(agent.task_id);
  }

  async bootstrap(): Promise<StoreBootstrap> {
    const tasks = await this.listTasks();
    const activeTaskId = this.getActiveTaskIdSync();
    const activeAgentId = this.getActiveAgentIdSync();
    const activeTask = activeTaskId ? await this.getTask(activeTaskId) : null;
    const activeAgent = activeAgentId ? await this.getAgent(activeAgentId) : null;
    const agentsByTaskId: Record<string, Agent[]> = {};
    if (activeTaskId) {
      agentsByTaskId[activeTaskId] = await this.listAgents(activeTaskId);
    }
    const workspacePreferences: Record<string, WorkspacePreferences> = {};
    for (const cwd of new Set(tasks.map((task) => task.cwd))) {
      workspacePreferences[cwd] = await this.getWorkspacePreferences(cwd);
    }
    return {
      tasks,
      activeTask,
      activeTaskId,
      activeAgent,
      activeAgentId,
      agentsByTaskId,
      appPreferences: await this.getAppPreferences(),
      workspacePreferences,
    };
  }

  async listTasks(): Promise<Task[]> {
    const rows = this.database
      .prepare("SELECT * FROM tasks ORDER BY position, created_at")
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

  async listAgents(taskId: string): Promise<Agent[]> {
    return (
      this.database
        .prepare("SELECT * FROM agents WHERE task_id = ? ORDER BY position, created_at")
        .all(taskId) as unknown as AgentRow[]
    ).map((row) => this.toAgent(row));
  }

  async listTemplates(): Promise<AgentTemplate[]> {
    const rows = this.database
      .prepare("SELECT * FROM agent_templates")
      .all() as unknown as TemplateRow[];
    return rows
      .map((row) => this.toTemplate(row))
      .sort((left, right) => {
        if (left.source !== right.source) {
          return left.source === "system" ? -1 : 1;
        }
        const byName = left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
        return byName || left.id.localeCompare(right.id);
      });
  }

  async getTask(id: string): Promise<Task | null> {
    const row = this.database.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as
      | TaskRow
      | undefined;
    return row ? this.toTask(row) : null;
  }

  async getAgent(id: string): Promise<Agent | null> {
    const row = this.agentRow(id);
    return row ? this.toAgent(row) : null;
  }

  async getTemplate(id: string): Promise<AgentTemplate | null> {
    const row = this.database.prepare("SELECT * FROM agent_templates WHERE id = ?").get(id) as
      | TemplateRow
      | undefined;
    return row ? this.toTemplate(row) : null;
  }

  async createTemplate(input: AgentTemplateCreateRequest): Promise<AgentTemplate> {
    const name = input.name.trim();
    if (!name) throw new Error("模板名称不能为空");
    const now = Date.now();
    const id = randomUUID();
    const description = (input.description ?? "").trim();
    const systemPrompt = input.systemPrompt ?? "";
    const skillPolicy = normalizeSkillPolicy(input.skillPolicy);
    this.database
      .prepare(
        `INSERT INTO agent_templates(
          id, name, description, system_prompt, skill_policy_json, source, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'user', ?, ?)`,
      )
      .run(id, name, description, systemPrompt, JSON.stringify(skillPolicy), now, now);
    const created = await this.getTemplate(id);
    if (!created) throw new Error("创建模板失败");
    return created;
  }

  async updateTemplate(input: AgentTemplateUpdateRequest): Promise<AgentTemplate | null> {
    const existing = await this.getTemplate(input.id);
    if (!existing) return null;

    const name =
      input.name !== undefined ? input.name.trim() : existing.name;
    if (!name) throw new Error("模板名称不能为空");
    const description =
      input.description !== undefined ? input.description.trim() : existing.description;
    const systemPrompt =
      input.systemPrompt !== undefined ? input.systemPrompt : existing.systemPrompt;
    const skillPolicy =
      input.skillPolicy !== undefined
        ? normalizeSkillPolicy(input.skillPolicy)
        : existing.skillPolicy;
    const now = Date.now();
    this.database
      .prepare(
        `UPDATE agent_templates
         SET name = ?, description = ?, system_prompt = ?, skill_policy_json = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(name, description, systemPrompt, JSON.stringify(skillPolicy), now, input.id);
    return this.getTemplate(input.id);
  }

  async deleteTemplate(id: string): Promise<AgentTemplateDeleteResult> {
    const existing = await this.getTemplate(id);
    if (!existing) return { ok: false, error: "模板不存在" };
    if (existing.source === "system") {
      return { ok: false, error: "系统模板不可删除" };
    }
    this.database.prepare("DELETE FROM agent_templates WHERE id = ?").run(id);
    return { ok: true, id };
  }

  async duplicateTemplate(id: string): Promise<AgentTemplate | null> {
    const existing = await this.getTemplate(id);
    if (!existing) return null;
    return this.createTemplate({
      name: `${existing.name} 的副本`,
      description: existing.description,
      systemPrompt: existing.systemPrompt,
      skillPolicy: existing.skillPolicy,
    });
  }

  async resetTemplateFactory(id: string): Promise<AgentTemplateResetResult> {
    const existing = await this.getTemplate(id);
    if (!existing) return { ok: false, error: "模板不存在" };
    if (existing.source !== "system") {
      return { ok: false, error: "仅系统模板可恢复出厂" };
    }
    const seed = SYSTEM_TEMPLATE_SEEDS.find((item) => item.id === id);
    if (!seed) return { ok: false, error: "找不到出厂种子" };
    const now = Date.now();
    this.database
      .prepare(
        `UPDATE agent_templates
         SET name = ?, description = '', system_prompt = ?, skill_policy_json = ?, updated_at = ?
         WHERE id = ? AND source = 'system'`,
      )
      .run(seed.name, seed.systemPrompt, JSON.stringify(seed.skillPolicy), now, id);
    const template = await this.getTemplate(id);
    if (!template) return { ok: false, error: "恢复出厂失败" };
    return { ok: true, template };
  }

  getActiveTaskIdSync(): string | null {
    const row = this.database
      .prepare("SELECT active_task_id FROM app_state WHERE singleton = 1")
      .get() as { active_task_id: string | null };
    return row.active_task_id;
  }

  getActiveAgentIdSync(): string | null {
    const row = this.database
      .prepare("SELECT active_agent_id FROM app_state WHERE singleton = 1")
      .get() as { active_agent_id: string | null };
    return row.active_agent_id;
  }

  async getActiveTaskId(): Promise<string | null> {
    return this.getActiveTaskIdSync();
  }

  async getActiveAgentId(): Promise<string | null> {
    return this.getActiveAgentIdSync();
  }

  async createTask(input: {
    cwd: string;
    title?: string;
    workflow?: TaskWorkflow | null;
  }): Promise<Task> {
    const now = Date.now();
    const id = randomUUID();
    const folder = input.cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? input.cwd;
    transaction(this.database, () => {
      this.database
        .prepare("UPDATE tasks SET position = position + 1 WHERE cwd = ?")
        .run(input.cwd);
      this.database
        .prepare(`
          INSERT INTO tasks(
            id, title, cwd, status, position, created_at, updated_at, archived_at, workflow_json
          ) VALUES (?, ?, ?, 'idle', 0, ?, ?, NULL, ?)
        `)
        .run(
          id,
          input.title?.trim() || `New task · ${folder}`,
          input.cwd,
          now,
          now,
          input.workflow ? JSON.stringify(input.workflow) : null,
        );
      this.database
        .prepare("UPDATE app_state SET active_task_id = ?, active_agent_id = NULL WHERE singleton = 1")
        .run(id);
    });
    return (await this.getTask(id))!;
  }

  async updateTask(
    id: string,
    patch: Partial<Pick<Task, "title" | "cwd" | "status">> & {
      workflow?: TaskWorkflow | null;
    },
    options: { touchUpdatedAt?: boolean } = {},
  ): Promise<Task | null> {
    const previous = await this.getTask(id);
    if (!previous) return null;
    const next: Task = {
      ...previous,
      title: patch.title === undefined ? previous.title : patch.title,
      cwd: patch.cwd === undefined ? previous.cwd : patch.cwd,
      status: patch.status === undefined ? previous.status : patch.status,
      workflow:
        patch.workflow === null
          ? undefined
          : patch.workflow === undefined
            ? previous.workflow
            : patch.workflow,
      updatedAt: options.touchUpdatedAt === false ? previous.updatedAt : Date.now(),
    };
    this.database
      .prepare(`
        UPDATE tasks SET
          title = ?, cwd = ?, status = ?, updated_at = ?, workflow_json = ?
        WHERE id = ?
      `)
      .run(
        next.title,
        next.cwd,
        next.status,
        next.updatedAt,
        next.workflow ? JSON.stringify(next.workflow) : null,
        id,
      );
    return this.getTask(id);
  }

  async createAgent(input: {
    /** Optional fixed id — used so multi-host can bind hostId before the row exists. */
    id?: string;
    taskId: string;
    parentAgentId?: string | null;
    templateId?: string | null;
    name: string;
    systemPrompt: string;
    skillPolicy?: SkillPolicy;
    inputContext?: string | null;
    sessionId: string;
    sessionPath: string;
  }): Promise<Agent> {
    if (!input.sessionId || !input.sessionPath) {
      throw new Error("New Agents require a persisted PI Session ID and path");
    }
    const task = await this.getTask(input.taskId);
    if (!task) throw new Error(`Unknown task: ${input.taskId}`);
    const now = Date.now();
    const id = input.id?.trim() || randomUUID();
    const skillPolicy = input.skillPolicy ?? { ignoredSkillNames: [] };
    transaction(this.database, () => {
      this.database
        .prepare("UPDATE agents SET position = position + 1 WHERE task_id = ?")
        .run(input.taskId);
      this.database
        .prepare(`
          INSERT INTO agents(
            id, task_id, parent_agent_id, template_id, name, system_prompt,
            skill_policy_json, input_context, output_context, session_id, session_path,
            role_prompt_confirmed_at, status, position, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, 'idle', 0, ?, ?)
        `)
        .run(
          id,
          input.taskId,
          input.parentAgentId ?? null,
          input.templateId ?? null,
          input.name,
          input.systemPrompt,
          JSON.stringify(skillPolicy),
          input.inputContext ?? null,
          input.sessionId,
          input.sessionPath,
          now,
          now,
        );
    });
    this.recomputeTaskStatus(input.taskId);
    return (await this.getAgent(id))!;
  }

  async updateAgent(
    id: string,
    patch: Partial<{
      name: string;
      systemPrompt: string;
      skillPolicy: SkillPolicy;
      inputContext: string | null;
      outputContext: string | null;
      sessionId: string | null;
      sessionPath: string | null;
      status: AgentStatus;
      parentAgentId: string | null;
      templateId: string | null;
      rolePromptConfirmedAt: number | null;
      confirmRolePrompt: boolean;
    }>,
    options: { touchUpdatedAt?: boolean } = {},
  ): Promise<Agent | null> {
    const previous = await this.getAgent(id);
    if (!previous) return null;
    const confirmedAt =
      patch.confirmRolePrompt === true
        ? Date.now()
        : patch.rolePromptConfirmedAt !== undefined
          ? patch.rolePromptConfirmedAt
          : previous.rolePromptConfirmedAt;
    const next = {
      name: patch.name === undefined ? previous.name : patch.name,
      systemPrompt:
        patch.systemPrompt === undefined ? previous.systemPrompt : patch.systemPrompt,
      skillPolicy:
        patch.skillPolicy === undefined ? previous.skillPolicy : patch.skillPolicy,
      inputContext:
        patch.inputContext === undefined ? previous.inputContext : patch.inputContext,
      outputContext:
        patch.outputContext === undefined ? previous.outputContext : patch.outputContext,
      sessionId: patch.sessionId === undefined ? previous.sessionId : patch.sessionId,
      sessionPath:
        patch.sessionPath === undefined ? previous.sessionPath : patch.sessionPath,
      status: patch.status === undefined ? previous.status : patch.status,
      parentAgentId:
        patch.parentAgentId === undefined ? previous.parentAgentId : patch.parentAgentId,
      templateId: patch.templateId === undefined ? previous.templateId : patch.templateId,
      rolePromptConfirmedAt: confirmedAt,
      updatedAt: options.touchUpdatedAt === false ? previous.updatedAt : Date.now(),
    };
    this.database
      .prepare(`
        UPDATE agents SET
          name = ?, system_prompt = ?, skill_policy_json = ?,
          input_context = ?, output_context = ?, session_id = ?, session_path = ?,
          status = ?, parent_agent_id = ?, template_id = ?,
          role_prompt_confirmed_at = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(
        next.name,
        next.systemPrompt,
        JSON.stringify(next.skillPolicy),
        next.inputContext,
        next.outputContext,
        next.sessionId,
        next.sessionPath,
        next.status,
        next.parentAgentId,
        next.templateId,
        next.rolePromptConfirmedAt,
        next.updatedAt,
        id,
      );
    this.recomputeTaskStatus(previous.taskId);
    return this.getAgent(id);
  }

  async setAgentStatus(id: string, status: AgentStatus): Promise<Agent | null> {
    return this.updateAgent(id, { status }, { touchUpdatedAt: false });
  }

  async setActive(taskId: string | null, agentId: string | null): Promise<void> {
    this.database
      .prepare(
        "UPDATE app_state SET active_task_id = ?, active_agent_id = ? WHERE singleton = 1",
      )
      .run(taskId, agentId);
  }

  async setActiveTask(id: string | null): Promise<void> {
    await this.setActive(id, this.getActiveAgentIdSync());
  }

  async bindStepAgent(taskId: string, stepId: string, agentId: string): Promise<Task | null> {
    const task = await this.getTask(taskId);
    if (!task?.workflow) return null;
    const steps = task.workflow.steps.map((step) =>
      step.id === stepId ? { ...step, agentId } : step,
    );
    return this.updateTask(taskId, {
      workflow: { ...task.workflow, steps },
    });
  }

  recomputeTaskStatus(taskId: string): void {
    const task = this.database.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as
      | TaskRow
      | undefined;
    if (!task) return;
    const agents = this.database
      .prepare("SELECT status FROM agents WHERE task_id = ?")
      .all(taskId) as unknown as Array<{ status: AgentStatus }>;
    const mapped = this.toTask(task);
    const next = rollupTaskStatus(mapped, agents);
    if (next !== task.status) {
      this.database
        .prepare("UPDATE tasks SET status = ? WHERE id = ?")
        .run(next, taskId);
    }
  }

  async moveTask(request: WorkspaceTaskMoveRequest): Promise<Task[]> {
    const task = this.taskRow(request.taskId);
    if (!task) throw new Error("Unknown task");
    if (request.beforeTaskId === task.id) return this.listTasks();
    const before = request.beforeTaskId ? this.taskRow(request.beforeTaskId) : null;
    if (before && before.cwd !== task.cwd) {
      throw new Error("Tasks can only be reordered within one workspace");
    }
    transaction(this.database, () => {
      const siblings = this.database
        .prepare("SELECT id FROM tasks WHERE cwd = ? ORDER BY position, created_at")
        .all(task.cwd)
        .map((row) => (row as { id: string }).id)
        .filter((id) => id !== task.id);
      const index = before ? siblings.indexOf(before.id) : siblings.length;
      siblings.splice(index < 0 ? siblings.length : index, 0, task.id);
      const update = this.database.prepare("UPDATE tasks SET position = ? WHERE id = ?");
      siblings.forEach((id, position) => update.run(position, id));
    });
    return this.listTasks();
  }

  async archiveTask(id: string): Promise<TreeMutationResult> {
    const task = await this.getTask(id);
    if (!task) return this.treeResult();
    const now = Date.now();
    transaction(this.database, () => {
      this.database
        .prepare("UPDATE tasks SET archived_at = COALESCE(archived_at, ?) WHERE id = ?")
        .run(now, id);
      // Agents inherit archive via parent task hide; no separate agent archived_at in v1 schema.
      const activeTask = this.getActiveTaskIdSync();
      const activeAgent = this.getActiveAgentIdSync();
      let clearTask = activeTask === id;
      let clearAgent = false;
      if (activeAgent) {
        const agent = this.agentRow(activeAgent);
        if (agent?.task_id === id) clearAgent = true;
      }
      if (clearTask || clearAgent) {
        const fallback = this.firstActiveTaskId();
        this.database
          .prepare(
            "UPDATE app_state SET active_task_id = ?, active_agent_id = NULL WHERE singleton = 1",
          )
          .run(fallback);
      }
    });
    return this.treeResult();
  }

  async restoreTask(id: string): Promise<TreeMutationResult> {
    this.database.prepare("UPDATE tasks SET archived_at = NULL WHERE id = ?").run(id);
    return this.treeResult();
  }

  async relinkAgentSession(id: string, sessionPath: string): Promise<Agent> {
    this.database.prepare("UPDATE agents SET session_path = ? WHERE id = ?").run(sessionPath, id);
    const agent = await this.getAgent(id);
    if (!agent) throw new Error(`Unknown agent: ${id}`);
    return agent;
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

  async getDraft(agentId: string): Promise<string> {
    const row = this.database
      .prepare("SELECT draft FROM agent_drafts WHERE agent_id = ?")
      .get(agentId) as { draft: string } | undefined;
    return row?.draft ?? "";
  }

  async saveDraft(agentId: string, draft: string): Promise<void> {
    this.database
      .prepare(`
        INSERT INTO agent_drafts(agent_id, draft, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(agent_id) DO UPDATE SET draft = excluded.draft, updated_at = excluded.updated_at
      `)
      .run(agentId, draft, Date.now());
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
    return (
      (this.database.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | undefined) ??
      null
    );
  }

  private agentRow(id: string): AgentRow | null {
    return (
      (this.database.prepare("SELECT * FROM agents WHERE id = ?").get(id) as AgentRow | undefined) ??
      null
    );
  }

  private toTask(row: TaskRow): Task {
    const task: Task = {
      id: row.id,
      title: row.title,
      cwd: row.cwd,
      status: row.status,
      position: row.position,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
    if (row.archived_at !== null) task.archivedAt = row.archived_at;
    const workflow = parseWorkflow(row.workflow_json);
    if (workflow) task.workflow = workflow;
    return task;
  }

  private toAgent(row: AgentRow): Agent {
    return {
      id: row.id,
      taskId: row.task_id,
      parentAgentId: row.parent_agent_id,
      templateId: row.template_id,
      name: row.name,
      systemPrompt: row.system_prompt,
      skillPolicy: parseSkillPolicy(row.skill_policy_json),
      inputContext: row.input_context,
      outputContext: row.output_context,
      sessionId: row.session_id,
      sessionPath: row.session_path,
      sessionAvailability: fileAvailable(row.session_path) ? "available" : "missing",
      rolePromptConfirmedAt:
        row.role_prompt_confirmed_at === undefined || row.role_prompt_confirmed_at === null
          ? null
          : Number(row.role_prompt_confirmed_at),
      status: row.status,
      position: row.position,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private toTemplate(row: TemplateRow): AgentTemplate {
    const source: AgentTemplateSource = row.source === "user" ? "user" : "system";
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? "",
      systemPrompt: row.system_prompt,
      skillPolicy: parseSkillPolicy(row.skill_policy_json),
      source,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private firstActiveTaskId(): string | null {
    const rows = this.database
      .prepare(`
        SELECT id, cwd, created_at, position
        FROM tasks
        WHERE archived_at IS NULL
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
    return {
      tasks: await this.listTasks(),
      activeTaskId: this.getActiveTaskIdSync(),
      activeAgentId: this.getActiveAgentIdSync(),
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

function normalizeSkillPolicy(policy?: SkillPolicy | null): SkillPolicy {
  return {
    ignoredSkillNames: uniqueStrings(policy?.ignoredSkillNames ?? []),
  };
}

