import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { PieDatabase } from "./database";
import { transaction } from "./database";

const RECOVER_MARKER = "pre-agent-split-catalog-recover-v1";

type OldTaskRow = {
  id: string;
  parent_task_id: string | null;
  title: string;
  cwd: string;
  session_id: string | null;
  session_path: string | null;
  status: string;
  position: number;
  created_at: number;
  updated_at: number;
  archived_at: number | null;
  workflow_json: string | null;
  ignored_skill_names_json: string | null;
};

/**
 * One-shot: if the v2 catalog is empty, rehydrate Task + Agent rows from the
 * newest `pie.sqlite3.pre-agent-split-*` backup so prior Sessions reappear in
 * the sidebar. JSONL files are never moved or deleted.
 *
 * Mapping:
 * - root task (parent null) → Task + Agent (session on Agent; id preserved)
 * - child task → Agent under parent Task (id preserved; parentAgentId null)
 * - workflow.steps[].taskId / rolePrompt → agentId only (strip role text)
 */
export function recoverPreSplitCatalogIfEmpty(
  database: PieDatabase,
  userData: string,
): { importedTasks: number; importedAgents: number; source: string | null } {
  const already = database
    .prepare("SELECT 1 AS found FROM legacy_imports WHERE name = ?")
    .get(RECOVER_MARKER);
  if (already) {
    return { importedTasks: 0, importedAgents: 0, source: null };
  }

  const taskCount = Number(
    (database.prepare("SELECT COUNT(*) AS n FROM tasks").get() as { n: number }).n,
  );
  if (taskCount > 0) {
    markDone(database, {
      skipped: "catalog_not_empty",
      taskCount,
      importedTasks: 0,
      importedAgents: 0,
      source: null,
    });
    return { importedTasks: 0, importedAgents: 0, source: null };
  }

  const candidates = listPreSplitBackups(userData);
  let sourcePath: string | null = null;
  let old: ReturnType<typeof readOldCatalog> = null;
  for (const candidate of candidates) {
    const catalog = readOldCatalog(candidate);
    if (catalog && catalog.tasks.length > 0) {
      sourcePath = candidate;
      old = catalog;
      break;
    }
  }
  if (!sourcePath || !old) {
    markDone(database, {
      skipped: "no_usable_backup",
      candidates,
      importedTasks: 0,
      importedAgents: 0,
      source: null,
    });
    return { importedTasks: 0, importedAgents: 0, source: null };
  }

  const roots = old.tasks.filter((t) => !t.parent_task_id);
  const children = old.tasks.filter((t) => t.parent_task_id);
  const rootIds = new Set(roots.map((t) => t.id));

  // Map old session-bearing task id → agent id (same id for continuity).
  const agentByOldTaskId = new Map<string, string>();
  for (const row of old.tasks) {
    if (row.session_id || row.session_path) {
      agentByOldTaskId.set(row.id, row.id);
    }
  }

  let importedTasks = 0;
  let importedAgents = 0;

  transaction(database, () => {
    const insertTask = database.prepare(`
      INSERT INTO tasks(
        id, title, cwd, status, position, created_at, updated_at, archived_at, workflow_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertAgent = database.prepare(`
      INSERT INTO agents(
        id, task_id, parent_agent_id, template_id, name, system_prompt,
        skill_policy_json, input_context, output_context, session_id, session_path,
        status, position, created_at, updated_at
      ) VALUES (?, ?, NULL, NULL, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?)
    `);
    const insertDraft = database.prepare(`
      INSERT INTO agent_drafts(agent_id, draft, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(agent_id) DO UPDATE SET draft = excluded.draft, updated_at = excluded.updated_at
    `);

    for (const root of roots) {
      const workflow = rewriteWorkflow(root.workflow_json, agentByOldTaskId, root.id);
      insertTask.run(
        root.id,
        root.title,
        root.cwd,
        normalizeStatus(root.status),
        root.position,
        root.created_at,
        root.updated_at,
        root.archived_at,
        workflow,
      );
      importedTasks += 1;

      // Root session → Agent under this Task (even if file missing — list still shows it).
      if (root.session_id || root.session_path) {
        const skillPolicy = skillPolicyFromJson(root.ignored_skill_names_json);
        insertAgent.run(
          root.id,
          root.id,
          root.title.slice(0, 80) || "Chat",
          "",
          skillPolicy,
          root.session_id,
          root.session_path,
          normalizeStatus(root.status),
          0,
          root.created_at,
          root.updated_at,
        );
        importedAgents += 1;
      }
    }

    // Child Tasks → peer Agents under parent Task (playbook step lineage, not generation tree).
    let childPos = 1;
    for (const child of children) {
      const parentId = child.parent_task_id;
      if (!parentId || !rootIds.has(parentId)) continue;
      if (!child.session_id && !child.session_path) continue;
      const skillPolicy = skillPolicyFromJson(child.ignored_skill_names_json);
      insertAgent.run(
        child.id,
        parentId,
        child.title.slice(0, 80) || "Step",
        "",
        skillPolicy,
        child.session_id,
        child.session_path,
        normalizeStatus(child.status),
        childPos++,
        child.created_at,
        child.updated_at,
      );
      importedAgents += 1;
    }

    // Re-bind workflow agentIds after children exist (steps often pointed at child task ids).
    for (const root of roots) {
      const workflow = rewriteWorkflow(root.workflow_json, agentByOldTaskId, root.id);
      if (workflow) {
        database
          .prepare("UPDATE tasks SET workflow_json = ? WHERE id = ?")
          .run(workflow, root.id);
      }
    }

    for (const draft of old.drafts) {
      if (!agentByOldTaskId.has(draft.task_id) && !rootIds.has(draft.task_id)) continue;
      const agentId = agentByOldTaskId.get(draft.task_id) ?? draft.task_id;
      // Only attach drafts when that agent row exists.
      const hasAgent = database
        .prepare("SELECT 1 AS o FROM agents WHERE id = ?")
        .get(agentId);
      if (!hasAgent) continue;
      insertDraft.run(agentId, draft.draft, draft.updated_at);
    }

    if (old.activeTaskId && rootIds.has(old.activeTaskId)) {
      const agentId =
        agentByOldTaskId.get(old.activeTaskId) ??
        (
          database
            .prepare(
              "SELECT id FROM agents WHERE task_id = ? ORDER BY position, created_at LIMIT 1",
            )
            .get(old.activeTaskId) as { id: string } | undefined
        )?.id ??
        null;
      database
        .prepare(
          "UPDATE app_state SET active_task_id = ?, active_agent_id = ? WHERE singleton = 1",
        )
        .run(old.activeTaskId, agentId);
    }

    markDone(database, {
      importedTasks,
      importedAgents,
      source: sourcePath,
      rootCount: roots.length,
      childCount: children.length,
    });
  });

  console.warn(
    `[pie-store] recovered ${importedTasks} tasks / ${importedAgents} agents from ${sourcePath}`,
  );
  return { importedTasks, importedAgents, source: sourcePath };
}

/** Newest first — caller skips empty/unreadable files. */
function listPreSplitBackups(userData: string): string[] {
  if (!existsSync(userData)) return [];
  return readdirSync(userData)
    .filter((name) => name.startsWith("pie.sqlite3.pre-agent-split-"))
    .sort()
    .reverse()
    .map((name) => join(userData, name));
}

function readOldCatalog(path: string): {
  tasks: OldTaskRow[];
  drafts: Array<{ task_id: string; draft: string; updated_at: number }>;
  activeTaskId: string | null;
} | null {
  let db: InstanceType<typeof DatabaseSync> | null = null;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    const tasks = db
      .prepare(
        `SELECT id, parent_task_id, title, cwd, session_id, session_path, status,
                position, created_at, updated_at, archived_at, workflow_json,
                ignored_skill_names_json
         FROM tasks
         ORDER BY position, created_at`,
      )
      .all() as unknown as OldTaskRow[];

    let drafts: Array<{ task_id: string; draft: string; updated_at: number }> = [];
    try {
      drafts = db
        .prepare("SELECT task_id, draft, updated_at FROM task_drafts")
        .all() as unknown as Array<{ task_id: string; draft: string; updated_at: number }>;
    } catch {
      drafts = [];
    }

    let activeTaskId: string | null = null;
    try {
      const row = db
        .prepare("SELECT active_task_id FROM app_state WHERE singleton = 1")
        .get() as { active_task_id: string | null } | undefined;
      activeTaskId = row?.active_task_id ?? null;
    } catch {
      activeTaskId = null;
    }

    return { tasks, drafts, activeTaskId };
  } catch (error) {
    console.error("[pie-store] failed to read pre-agent-split backup", path, error);
    return null;
  } finally {
    try {
      db?.close();
    } catch {
      /* ignore */
    }
  }
}

function rewriteWorkflow(
  raw: string | null,
  agentByOldTaskId: Map<string, string>,
  rootTaskId: string,
): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      playbookId?: string;
      stepId?: string;
      steps?: Array<{
        id?: string;
        status?: string;
        taskId?: string;
        agentId?: string;
        rolePrompt?: string;
      }>;
    };
    if (typeof parsed.playbookId !== "string" || typeof parsed.stepId !== "string") {
      return null;
    }
    if (!Array.isArray(parsed.steps)) return null;

    const steps = parsed.steps
      .filter((step) => typeof step?.id === "string" && typeof step?.status === "string")
      .map((step) => {
        const status = step.status as "pending" | "active" | "done" | "skipped";
        const ok =
          status === "pending" ||
          status === "active" ||
          status === "done" ||
          status === "skipped";
        const oldRef = step.agentId ?? step.taskId;
        let agentId: string | undefined;
        if (typeof oldRef === "string" && agentByOldTaskId.has(oldRef)) {
          agentId = agentByOldTaskId.get(oldRef);
        } else if (step.id === "grilling" || step.id === parsed.steps?.[0]?.id) {
          // Step 1 historically shared the root Task session.
          if (agentByOldTaskId.has(rootTaskId)) agentId = rootTaskId;
        }
        return {
          id: step.id!,
          status: ok ? status : "pending",
          ...(agentId ? { agentId } : {}),
        };
      });

    return JSON.stringify({
      playbookId: parsed.playbookId,
      stepId: parsed.stepId,
      steps,
    });
  } catch {
    return null;
  }
}

function skillPolicyFromJson(raw: string | null): string {
  if (!raw) return JSON.stringify({ ignoredSkillNames: [] });
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return JSON.stringify({
        ignoredSkillNames: parsed.filter((x): x is string => typeof x === "string"),
      });
    }
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as { ignoredSkillNames?: unknown }).ignoredSkillNames)) {
      return JSON.stringify(parsed);
    }
  } catch {
    /* fall through */
  }
  return JSON.stringify({ ignoredSkillNames: [] });
}

function normalizeStatus(value: string): string {
  if (
    value === "idle" ||
    value === "running" ||
    value === "done" ||
    value === "error" ||
    value === "interrupted"
  ) {
    return value;
  }
  return "idle";
}

function markDone(database: PieDatabase, details: unknown): void {
  database
    .prepare(
      "INSERT INTO legacy_imports(name, completed_at, details_json) VALUES (?, ?, ?)",
    )
    .run(RECOVER_MARKER, Date.now(), JSON.stringify(details));
}
