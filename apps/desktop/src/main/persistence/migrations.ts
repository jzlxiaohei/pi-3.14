import type { PieDatabase } from "./database";
import { transaction } from "./database";

const CURRENT_VERSION = 1;

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

  if (!applied.includes(1)) {
    transaction(database, () => {
      database.exec(SCHEMA_V1);
      database
        .prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)")
        .run(1, now());
    });
  }
}

const SCHEMA_V1 = `
  CREATE TABLE legacy_imports (
    name TEXT PRIMARY KEY,
    completed_at INTEGER NOT NULL,
    details_json TEXT NOT NULL CHECK (json_valid(details_json))
  );

  CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    parent_task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    cwd TEXT NOT NULL,
    session_id TEXT,
    session_path TEXT,
    status TEXT NOT NULL CHECK (
      status IN ('idle', 'running', 'done', 'error', 'interrupted')
    ),
    position INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    archived_at INTEGER,
    workflow_json TEXT CHECK (
      workflow_json IS NULL OR json_valid(workflow_json)
    ),
    ignored_skill_names_json TEXT NOT NULL DEFAULT '[]' CHECK (
      json_valid(ignored_skill_names_json)
    )
  );

  CREATE UNIQUE INDEX tasks_session_id_unique
    ON tasks(session_id) WHERE session_id IS NOT NULL;

  CREATE UNIQUE INDEX tasks_session_path_unique
    ON tasks(session_path) WHERE session_path IS NOT NULL;

  CREATE INDEX tasks_root_workspace_order
    ON tasks(cwd, position, created_at) WHERE parent_task_id IS NULL;

  CREATE INDEX tasks_parent_order
    ON tasks(parent_task_id, position, created_at)
    WHERE parent_task_id IS NOT NULL;

  CREATE TABLE app_state (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    active_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL
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

  CREATE TABLE task_drafts (
    task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
    draft TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  INSERT INTO app_state(singleton, active_task_id) VALUES (1, NULL);
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
