import type { PieDatabase } from "./database";
import { transaction } from "./database";
import { SYSTEM_TEMPLATE_SEEDS } from "../../shared/playbook-templates";

/** Schema version: v2 Task/Agent/Template split; v3 Role Prompt confirmation; v4 template admin. */
export const CURRENT_VERSION = 4;

export function readSchemaVersion(database: PieDatabase): number {
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
    `);
    const applied = database
      .prepare("SELECT version FROM schema_migrations ORDER BY version")
      .all()
      .map((row) => Number((row as { version: number }).version));
    return applied.at(-1) ?? 0;
  } catch {
    return 0;
  }
}

export function runMigrations(database: PieDatabase, now = Date.now): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  const applied = database
    .prepare("SELECT version FROM schema_migrations ORDER BY version")
    .all()
    .map((row) => Number((row as { version: number }).version));
  const newest = applied.at(-1) ?? 0;
  if (newest > CURRENT_VERSION) {
    throw new Error(
      `PIE database schema ${newest} is newer than supported schema ${CURRENT_VERSION}`,
    );
  }

  // Greenfield path: only v2 is applied on a fresh DB (v1 never coexists after reset).
  if (!applied.includes(2)) {
    transaction(database, () => {
      database.exec(SCHEMA_V2);
      database
        .prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)")
        .run(2, now());
    });
  }

  // Additive v3: Role Prompt confirmation timestamp on Agent rows.
  let versions = database
    .prepare("SELECT version FROM schema_migrations ORDER BY version")
    .all()
    .map((row) => Number((row as { version: number }).version));
  if (!versions.includes(3)) {
    transaction(database, () => {
      database.exec(`ALTER TABLE agents ADD COLUMN role_prompt_confirmed_at INTEGER NULL;`);
      database
        .prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)")
        .run(3, now());
    });
  }

  // Additive v4: template description + user source + insert-only seed era.
  versions = database
    .prepare("SELECT version FROM schema_migrations ORDER BY version")
    .all()
    .map((row) => Number((row as { version: number }).version));
  if (!versions.includes(4)) {
    transaction(database, () => {
      migrateAgentTemplatesV4(database);
      database
        .prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)")
        .run(4, now());
    });
  }

  seedSystemTemplates(database, now);
}

/**
 * Rebuild agent_templates: add description, widen source CHECK to system|user.
 * Preserves rows; existing descriptions become ''.
 */
function migrateAgentTemplatesV4(database: PieDatabase): void {
  database.exec(`PRAGMA foreign_keys = OFF;`);
  database.exec(`
    CREATE TABLE agent_templates_v4 (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      system_prompt TEXT NOT NULL,
      skill_policy_json TEXT NOT NULL CHECK (json_valid(skill_policy_json)),
      source TEXT NOT NULL CHECK (source IN ('system', 'user')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  database.exec(`
    INSERT INTO agent_templates_v4 (
      id, name, description, system_prompt, skill_policy_json, source, created_at, updated_at
    )
    SELECT
      id,
      name,
      '',
      system_prompt,
      skill_policy_json,
      CASE WHEN source = 'user' THEN 'user' ELSE 'system' END,
      created_at,
      updated_at
    FROM agent_templates;
  `);
  database.exec(`DROP TABLE agent_templates;`);
  database.exec(`ALTER TABLE agent_templates_v4 RENAME TO agent_templates;`);
  database.exec(`PRAGMA foreign_keys = ON;`);
}

/** Idempotent insert of missing system playbook templates. Never overwrites existing rows. */
export function seedSystemTemplates(database: PieDatabase, now = Date.now): void {
  const ts = now();
  const insert = database.prepare(`
    INSERT INTO agent_templates(
      id, name, description, system_prompt, skill_policy_json, source, created_at, updated_at
    ) VALUES (?, ?, '', ?, ?, 'system', ?, ?)
    ON CONFLICT(id) DO NOTHING
  `);
  transaction(database, () => {
    for (const seed of SYSTEM_TEMPLATE_SEEDS) {
      insert.run(
        seed.id,
        seed.name,
        seed.systemPrompt,
        JSON.stringify(seed.skillPolicy),
        ts,
        ts,
      );
    }
  });
}

const SCHEMA_V2 = `
  CREATE TABLE legacy_imports (
    name TEXT PRIMARY KEY,
    completed_at INTEGER NOT NULL,
    details_json TEXT NOT NULL CHECK (json_valid(details_json))
  );

  CREATE TABLE agent_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    system_prompt TEXT NOT NULL,
    skill_policy_json TEXT NOT NULL CHECK (json_valid(skill_policy_json)),
    source TEXT NOT NULL CHECK (source IN ('system')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    cwd TEXT NOT NULL,
    status TEXT NOT NULL CHECK (
      status IN ('idle', 'running', 'done', 'error', 'interrupted')
    ),
    position INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    archived_at INTEGER,
    workflow_json TEXT CHECK (
      workflow_json IS NULL OR json_valid(workflow_json)
    )
  );

  CREATE INDEX tasks_workspace_order
    ON tasks(cwd, position, created_at);

  CREATE TABLE agents (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    parent_agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE,
    template_id TEXT REFERENCES agent_templates(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    system_prompt TEXT NOT NULL,
    skill_policy_json TEXT NOT NULL CHECK (json_valid(skill_policy_json)),
    input_context TEXT,
    output_context TEXT,
    session_id TEXT,
    session_path TEXT,
    status TEXT NOT NULL CHECK (
      status IN ('idle', 'running', 'done', 'error', 'interrupted')
    ),
    position INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE UNIQUE INDEX agents_session_id_unique
    ON agents(session_id) WHERE session_id IS NOT NULL;

  CREATE UNIQUE INDEX agents_session_path_unique
    ON agents(session_path) WHERE session_path IS NOT NULL;

  CREATE INDEX agents_task_order
    ON agents(task_id, position, created_at);

  CREATE INDEX agents_parent_order
    ON agents(parent_agent_id, position, created_at)
    WHERE parent_agent_id IS NOT NULL;

  CREATE INDEX agents_template
    ON agents(template_id) WHERE template_id IS NOT NULL;

  CREATE TABLE app_state (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    active_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    active_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL
  );

  CREATE TABLE app_preferences (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    theme TEXT NOT NULL CHECK (theme IN ('light', 'dark')),
    tasks_open INTEGER NOT NULL CHECK (tasks_open IN (0, 1)),
    inspector_open INTEGER NOT NULL CHECK (inspector_open IN (0, 1)),
    tasks_width INTEGER NOT NULL,
    inspector_width INTEGER NOT NULL,
    inspector_tab TEXT NOT NULL CHECK (
      inspector_tab IN ('files', 'terminal', 'context')
    ),
    show_archived INTEGER NOT NULL CHECK (show_archived IN (0, 1))
  );

  CREATE TABLE workspace_preferences (
    cwd TEXT PRIMARY KEY,
    task_group_collapsed INTEGER NOT NULL DEFAULT 0 CHECK (
      task_group_collapsed IN (0, 1)
    ),
    review_base_ref TEXT
  );

  CREATE TABLE reviewed_files (
    cwd TEXT NOT NULL,
    base_ref TEXT NOT NULL,
    path TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    reviewed_at INTEGER NOT NULL,
    PRIMARY KEY (cwd, base_ref, path)
  );

  CREATE TABLE agent_drafts (
    agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
    draft TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  INSERT INTO app_state(singleton, active_task_id, active_agent_id) VALUES (1, NULL, NULL);
  INSERT INTO app_preferences(
    singleton,
    theme,
    tasks_open,
    inspector_open,
    tasks_width,
    inspector_width,
    inspector_tab,
    show_archived
  ) VALUES (1, 'light', 1, 0, 264, 480, 'files', 0);
`;
