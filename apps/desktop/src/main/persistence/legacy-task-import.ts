import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { PieDatabase } from "./database";
import { transaction } from "./database";
import { parseLegacyTaskStore, type LegacyTaskStore } from "./codecs";

const IMPORT_NAME = "workspace-tasks-json-v1";

export function importLegacyTasks(
  database: PieDatabase,
  primaryPath: string,
  now = Date.now,
): void {
  const imported = database
    .prepare("SELECT 1 AS found FROM legacy_imports WHERE name = ?")
    .get(IMPORT_NAME);
  if (imported) return;

  const backupPath = `${primaryPath}.bak`;
  const source = readValid(primaryPath) ?? readValid(backupPath);
  if (!source) {
    if (existsSync(primaryPath) || existsSync(backupPath)) {
      throw new Error("Existing PIE task JSON and rolling backup are both invalid");
    }
    transaction(database, () => {
      insertMarker(database, now(), {
        source: null,
        sourceTaskCount: 0,
        importedCount: 0,
        backup: null,
      });
    });
    return;
  }

  const retainedPath = nextRetainedPath(primaryPath, new Date(now()));
  copyFileSync(source.path, retainedPath);

  transaction(database, () => {
    const insert = database.prepare(`
      INSERT INTO tasks(
        id, parent_task_id, title, cwd, session_id, session_path, status,
        position, created_at, updated_at, archived_at, workflow_json,
        ignored_skill_names_json
      ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const nextPosition = new Map<string, number>();
    for (const task of source.store.tasks) {
      const position = nextPosition.get(task.cwd) ?? 0;
      nextPosition.set(task.cwd, position + 1);
      insert.run(
        task.id,
        task.title,
        task.cwd,
        task.sessionId,
        task.sessionPath,
        task.status,
        position,
        task.createdAt,
        task.updatedAt,
        task.archivedAt ?? null,
        task.workflow ? JSON.stringify(task.workflow) : null,
        JSON.stringify(task.ignoredSkillNames ?? []),
      );
    }

    const selected = source.store.tasks.find(
      (task) => task.id === source.store.selectedTaskId && task.archivedAt === undefined,
    );
    const activeTaskId = selected?.id ?? source.store.tasks.find((task) => task.archivedAt === undefined)?.id ?? null;
    database
      .prepare("UPDATE app_state SET active_task_id = ? WHERE singleton = 1")
      .run(activeTaskId);

    const count = Number(
      (database.prepare("SELECT COUNT(*) AS count FROM tasks").get() as { count: number }).count,
    );
    if (count !== source.store.tasks.length) {
      throw new Error(
        `PIE task migration count mismatch: expected ${source.store.tasks.length}, imported ${count}`,
      );
    }
    insertMarker(database, now(), {
      source: basename(source.path),
      sourceTaskCount: source.store.tasks.length,
      importedCount: count,
      backup: retainedPath,
    });
  });
}

function readValid(path: string): { path: string; store: LegacyTaskStore } | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    const store = parseLegacyTaskStore(parsed);
    return store ? { path, store } : null;
  } catch {
    return null;
  }
}

function insertMarker(database: PieDatabase, at: number, details: unknown): void {
  database
    .prepare("INSERT INTO legacy_imports(name, completed_at, details_json) VALUES (?, ?, ?)")
    .run(IMPORT_NAME, at, JSON.stringify(details));
}

function nextRetainedPath(primaryPath: string, date: Date): string {
  const stamp = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("");
  const base = join(dirname(primaryPath), `pie-workspace-tasks.pre-sqlite-${stamp}.json`);
  if (!existsSync(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = base.replace(/\.json$/, `-${suffix}.json`);
    if (!existsSync(candidate)) return candidate;
  }
}
