---
status: accepted
---

# SQLite local persistence v1

Executable specification for implementing [Local persistence](../local-persistence.md) under [ADR-0001](../adr/0001-sqlite-for-pie-application-state.md).

## Outcome

Replace `TaskStore` and durable browser state with a SQLite-backed PIE store while preserving PI Session JSONL as the conversation source of truth.

The release is complete when:

- Existing task data migrates without loss.
- Task CRUD, activation, archive, ordering, and status use SQLite only.
- All agreed preferences survive restart at the correct scope.
- Missing Sessions remain visible and recoverable without silent replacement.
- Existing PI Session behavior remains unchanged.

## Scope

### Included

- SQLite schema and migration runner.
- One-time task JSON and legacy `localStorage` migration.
- Root/Child Task Tree storage, including recursive archive/restore behavior.
- `interrupted` status recovery.
- Session availability, relink, and “create new Task” handling.
- Root Task drag ordering within a workspace.
- Global, workspace, review, and Task-scoped preferences.
- Single-instance startup and explicit database failure handling.

### Deferred

- Desktop Subagent orchestration and Child Task navigation UI. The schema and store support Child Tasks now.
- Permanent-delete UI. The schema may use cascading metadata deletion, but no purge IPC is exposed in v1.
- Session transcript indexing and cross-Session search.
- Workspace relocation.
- Windows/Linux verification.
- SQLite backup/export/reset UI beyond the retained migration copy.

## Resolved implementation issues

### Legacy Tasks may lack Session identity

The current TypeScript contract and JSON normalizer allow `sessionId` and `sessionPath` to be `null`, while the domain rule says one Task corresponds to one Session. Making the columns immediately `NOT NULL` would violate lossless migration.

Resolution:

- Keep both columns nullable in schema v1.
- Preserve legacy nulls and report those Tasks as `missing`.
- Require non-null Session ID and path for every newly created Task.
- Enforce uniqueness with partial indexes when values are present.

### Legacy rows can be partial

The current product path can persist a Task without a title. Migration must retain that Task rather than reject the entire catalog or drop the row.

Resolution:

- Derive a missing/blank title as `New task · {workspace folder}`.
- Continue to reject rows missing identity, workspace, or timestamps because they cannot be recovered safely.

### The legacy store now has a rolling backup

Migration must follow the current store’s recovery order rather than reading only the primary JSON.

Resolution:

- Use a valid `pie-workspace-tasks.json` first.
- Otherwise use a valid `pie-workspace-tasks.json.bak`.
- If either file exists but neither is valid, stop startup with a migration error; do not import an empty catalog.

### SQLite and PI Session writes cannot share a transaction

A PI Session file and SQLite are separate stores.

Resolution:

- Create/bind the PI Session first, then insert the Task.
- If Task insertion fails, dispose the new host and report the persistence failure. Any PI-created orphan Session file is left untouched.
- If a PI turn succeeds but the Task metadata update fails, keep the Session result, report the persistence error, and never attempt to roll back or rewrite JSONL.

## Runtime architecture

```text
Renderer page model
  -> typed preload methods
  -> Electron main IPC
  -> PiRuntimeManager + PieStore
  -> node:sqlite DatabaseSync

PI utilityProcess
  -> @pi-3.14/runtime
  -> PI Session JSONL
```

Rules:

- `PieStore` is created and closed by Electron main.
- `PiRuntimeManager` receives `PieStore`; it no longer constructs `TaskStore` or resolves the storage path itself.
- Renderer and utility process never import `node:sqlite` or receive SQL-shaped IPC.
- Do not add SQLite access to `@pi-3.14/*`; persistence is desktop-app behavior.
- Do not dual-write JSON and SQLite after migration.

## Database lifecycle

### Startup order

1. Call `app.requestSingleInstanceLock()` before `app.whenReady()`.
2. If the lock is denied, quit without opening SQLite.
3. After Electron is ready, open `app.getPath("userData")/pie.sqlite3`.
4. Configure the connection:

   ```sql
   PRAGMA foreign_keys = ON;
   PRAGMA journal_mode = WAL;
   PRAGMA synchronous = NORMAL;
   PRAGMA busy_timeout = 5000;
   ```

5. Run schema migrations transactionally.
6. Run the legacy Task import if it has not completed.
7. In one transaction, change every `running` Task to `interrupted`.
8. Construct `PiRuntimeManager`, register IPC, then create the main window.
9. On a second-instance event, focus the existing main window.

If steps 3–7 fail, show one blocking startup error and quit. Do not create a replacement database, reset tables, or silently continue with an empty store.

### Shutdown

- Dispose the PI runtime as today.
- Close `PieStore` once on application quit, after runtime disposal has begun.
- Closing a window does not close SQLite while the macOS application remains alive.

## Schema v1

All timestamps are Unix epoch milliseconds. JSON columns are serialized with stable application codecs and parsed at the store seam.

```sql
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

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
```

Insert singleton defaults in migration 1:

```text
theme = light
tasksOpen = true
inspectorOpen = false
tasksWidth = 264
inspectorWidth = 480
inspectorTab = files
showArchived = false
activeTaskId = null
```

`SessionAvailability` is derived from filesystem access and is not stored in SQLite.

## PieStore module

Create a desktop-local deep module under:

```text
apps/desktop/src/main/persistence/
  database.ts
  migrations.ts
  legacy-task-import.ts
  pie-store.ts
  codecs.ts
```

`PieStore` owns prepared statements, transactions, row mapping, ordering, and preference defaults. Do not create TypeScript repository interfaces or one class per table until a second adapter actually exists.

Required operations:

```ts
openPieStore(options): PieStore

store.bootstrap(): Promise<StoreBootstrap>
store.getTask(id): Promise<WorkspaceTask | null>
store.createTask(input): Promise<WorkspaceTask>
store.updateTask(id, patch): Promise<WorkspaceTask | null>
store.setTaskStatus(id, status): Promise<WorkspaceTask | null>
store.setActiveTask(id | null): Promise<void>
store.moveRootTask(input): Promise<WorkspaceTask[]>
store.archiveTree(id): Promise<ArchiveResult>
store.restoreTree(id): Promise<ArchiveResult>
store.relinkSession(id, sessionPath): Promise<WorkspaceTask>
store.listChildren(parentTaskId): Promise<WorkspaceTask[]>

store.getAppPreferences(): Promise<AppPreferences>
store.updateAppPreferences(patch): Promise<AppPreferences>
store.getWorkspacePreferences(cwd): Promise<WorkspacePreferences>
store.updateWorkspacePreferences(cwd, patch): Promise<WorkspacePreferences>
store.getDraft(taskId): Promise<string>
store.saveDraft(taskId, draft): Promise<void>
store.getReviewedPaths(input): Promise<string[]>
store.setReviewedFile(input): Promise<void>
store.clearReviewedFile(input): Promise<void>
store.importLegacyBrowserPreferences(input): Promise<LegacyImportResult>

store.close(): void
```

The Promise surface preserves current caller structure even though `DatabaseSync` operations complete synchronously.

## Migration behavior

### Schema migrations

- Apply each pending version inside `BEGIN IMMEDIATE` / `COMMIT`.
- Record a version only in the same transaction as its schema changes.
- Roll back the whole version on failure.
- Refuse to open a database whose recorded schema version is newer than the application supports.

### Task JSON import

Use import name `workspace-tasks-json-v1`.

1. If the import marker exists, skip all legacy file reads.
2. Select the valid source using primary-then-`.bak` order.
3. If neither source file exists, insert an empty-import marker and continue.
4. If files exist but neither parses to the expected top-level shape, fail startup.
5. Normalize every Task using the current Task codec.
6. Derive a missing/blank title from the workspace folder. If any Task still fails required identity-field normalization, fail the complete import rather than dropping it.
7. Before writing SQLite, copy the selected source to an unused timestamped path:

   ```text
   pie-workspace-tasks.pre-sqlite-YYYYMMDD.json
   ```

   Add `-2`, `-3`, and so on if the path already exists. Never delete this copy automatically.
8. In one transaction:
   - Insert every legacy Task as a Root Task (`parent_task_id = NULL`).
   - Preserve relative JSON array order within each `cwd` by assigning positions `0..n-1`.
   - Preserve IDs, titles, Session references, timestamps, archive state, workflow, and ignored Skills.
   - Preserve the selected Task as `active_task_id` when it exists and is not archived; otherwise choose the first active legacy Task by original array order.
   - Insert the import marker with source filename, source Task count, imported count, and backup path.
9. Verify imported count equals source count before commit.
10. Leave primary and `.bak` files untouched. SQLite is authoritative after the marker commits.

### Browser preference import

Use import name `renderer-local-storage-v1`.

- Renderer reads only:
  - `pie.panel.tasksOpen`
  - `pie.panel.inspectorOpen`
- It sends parsed booleans in the initial bootstrap request.
- Main applies present values only when the import marker is absent, then commits the marker atomically.
- Bootstrap returns `legacyBrowserPreferencesImported: true` after the marker exists.
- Renderer then removes the two legacy keys. A crash between commit and removal is harmless: the next bootstrap sees the marker and removes them without applying again.
- No arbitrary key/value migration IPC is allowed.

## Task behavior

### DTO changes

Update shared contracts:

```ts
type WorkspaceTaskStatus =
  | "idle"
  | "running"
  | "done"
  | "error"
  | "interrupted";

type SessionAvailability = "available" | "missing";

type WorkspaceTask = {
  id: string;
  parentTaskId: string | null;
  rootTaskId: string;
  // Existing fields remain.
  position: number;
  sessionAvailability: SessionAvailability;
};
```

`sessionId` and `sessionPath` remain nullable for imported legacy rows. New Task creation rejects a host state without both values.

Replace the overloaded `selectedTaskId` bootstrap concept with:

```ts
type PiTasksBootstrap = {
  rootTasks: WorkspaceTask[];
  activeTask: WorkspaceTask | null;
  activeRootTaskId: string | null;
  appPreferences: AppPreferences;
  workspacePreferences: Record<string, WorkspacePreferences>;
  legacyBrowserPreferencesImported: boolean;
};
```

The store finds the Root ancestor of `activeTask` recursively. Child Tasks remain absent from `rootTasks`.

### Status transitions

| Event | New status |
|---|---|
| New Task | `idle` |
| Prompt/Continue starts | `running` |
| Turn completes normally | `done` |
| Turn returns explicit error | `error` |
| User aborts | `idle` |
| App starts with persisted `running` | `interrupted` |
| PI host exits during an active turn without a terminal result | `interrupted` |

Status changes never alter `position`.

### Session availability and activation

- Bootstrap and task list operations derive availability with filesystem access.
- Activation returns a typed union instead of throwing for a missing Session:

  ```ts
  type PiActivateTaskResult =
    | { ok: true; task: WorkspaceTask; state: PiHostState; timeline: PiTimelineSnapshot }
    | { ok: false; reason: "session_missing"; task: WorkspaceTask };
  ```

- A missing result does not bind a new host and does not update Session columns.
- Renderer keeps the Task selected and shows an unavailable state with two actions:
  - **Locate Session…**
  - **Create new Task**

### Relink

1. Open a main-process file picker restricted to `.jsonl`.
2. Read the selected file with `@pi-3.14/session/node`.
3. Compare the Session header ID with the Task’s stored `sessionId`.
4. On mismatch or invalid JSONL, show an error and leave the database unchanged.
5. On match, update only `session_path`, recompute availability, and activate normally.
6. A legacy Task with no `sessionId` cannot be safely relinked in v1; show that it must create a new Task.

“Create new Task” creates a separate Session and Task in the same `cwd`. If invoked for a Child Task in future, the new Task uses the same `parentTaskId`. It does not archive or mutate the unavailable Task.

### Ordering

- Query Root Tasks grouped by `cwd`, ordered by `position ASC`, then `created_at ASC` as a stable tie-breaker.
- Order workspace groups by the maximum creation time of their visible Root Tasks, descending.
- New Root Task insertion renumbers its workspace roots and assigns the new Task position `0`.
- Prompt completion and ordinary updates no longer use `moveToFront`.
- Dragging calls:

  ```ts
  type MoveRootTaskRequest = {
    taskId: string;
    beforeTaskId: string | null; // null means end of workspace group
  };
  ```

- Main validates that both Tasks are Root Tasks in the same `cwd`, moves the Task in the complete sibling sequence, and renumbers positions in one transaction.
- Archived roots retain their relative place in that complete sequence. Restoring a subtree therefore restores its previous ordering position.

### Drag dependency

Use `@atlaskit/pragmatic-drag-and-drop` behind a page-local Task-sidebar adapter. It is framework-agnostic, Apache-2.0, actively maintained, and has broad current adoption; it avoids imperative DOM reordering by SortableJS and the stale release history of `@thisbeyond/solid-dnd`.

Only a drag handle starts sorting. Keyboard focus, click-to-open, archive controls, and scrolling must continue to work. Persist once on drop, not during hover movement.

### Archive and restore

Use a recursive CTE inside one transaction to find the target Task and descendants.

Archive:

- Set one timestamp on every currently unarchived row in the subtree.
- If the Active Task is in that subtree, dispose its host and select the next visible Root Task by sidebar order, or `null` when none exists.

Restore:

- Clear `archived_at` for the complete subtree.
- Do not alter Session files, status, drafts, or position.
- Restoring a parent also restores descendants that had been archived separately before the parent; v1 does not retain nested archive provenance.

## Preference behavior

### State ownership

Move durable page preferences into `createWorkspaceModel()` or a composed page-local preference factory. `AppShell` and child UI receive reactive accessors and actions; they do not call `localStorage`, `sessionStorage`, or persistence IPC directly.

### Global preferences

Persist discrete changes immediately:

- Theme.
- Panel open/closed state.
- Inspector tab.
- Show archived.

Panel width changes update Solid state during pointer movement but write SQLite only on pointer release/cancel. Extend `PanelResizeHandle` with an `onCommit(width)` callback.

Clamp loaded and committed widths to the existing product bounds:

```text
Tasks: 240–372, default 264
Inspector: 360–720, default 480
```

### Workspace preferences

- Load collapse state for every workspace represented in bootstrap roots.
- Persist group collapse toggles by absolute `cwd`.
- Persist Diff Review’s resolved `baseRef` after Git loading succeeds.
- Remove all `sessionStorage` reads/writes from Diff Review.

### Reviewed files

Extend `WorkspaceGitFile` with a main-generated `reviewFingerprint` and, for renames, `oldPath`.

Fingerprint must change when the effective diff changes. Compute SHA-256 over:

```text
resolved base commit OID
status
old path, when present
current path
working-tree Git blob ID or a deleted sentinel
working-tree executable mode
```

This avoids relying on the UI patch, which is truncated for display and is insufficient for binary changes.

Review flow:

1. Load Git snapshot and resolved `baseRef`.
2. Ask the preference store for rows matching `cwd + baseRef`.
3. Treat a path as reviewed only when the stored fingerprint equals the current fingerprint.
4. If a stored row exists with a different current fingerprint, delete it so later restoring the old content does not silently restore reviewed state.
5. Checking a path upserts its current fingerprint.
6. Unchecking or discarding deletes that path’s row.
7. Rows for paths no longer changed may be cleaned opportunistically.

### Composer drafts

- Store one draft per Task.
- Restore it when activating that Task.
- Debounce writes by 250 ms while typing.
- Flush the pending write before switching, creating, archiving, or normally closing the active Task.
- Clearing and sending a draft persists the empty value.
- Crash durability is bounded by the debounce interval; normal restarts must restore the latest flushed value.

## IPC surface

Expose typed product operations only. Suggested groups:

```ts
piDesktop.app.bootstrap({ legacyPanelPreferences })

piDesktop.tasks.activate(taskId, options?)
piDesktop.tasks.update(request)
piDesktop.tasks.move(request)
piDesktop.tasks.archive(taskId)
piDesktop.tasks.unarchive(taskId)
piDesktop.tasks.locateSession(taskId)
piDesktop.tasks.createReplacement(taskId)
piDesktop.tasks.listChildren(parentTaskId) // schema-ready; UI deferred

piDesktop.preferences.updateApp(patch)
piDesktop.preferences.getWorkspace(cwd)
piDesktop.preferences.updateWorkspace(cwd, patch)
piDesktop.preferences.saveDraft(taskId, draft)
piDesktop.preferences.getReviewedPaths(request)
piDesktop.preferences.setReviewedFile(request)
piDesktop.preferences.clearReviewedFile(request)
```

Do not expose generic preference keys, table names, migration controls, database paths, or SQL.

## File change map

### New main modules

- `apps/desktop/src/main/persistence/database.ts`
- `apps/desktop/src/main/persistence/migrations.ts`
- `apps/desktop/src/main/persistence/legacy-task-import.ts`
- `apps/desktop/src/main/persistence/codecs.ts`
- `apps/desktop/src/main/persistence/pie-store.ts`

### Main changes

- `apps/desktop/src/main/index.ts`
  - Single-instance lock.
  - Store startup/shutdown.
  - Store/preference/relink IPC registration.
- `apps/desktop/src/main/pi/runtime-manager.ts`
  - Inject `PieStore`.
  - Remove `TaskStore` construction.
  - Handle missing Session activation and host-exit interruption.
- `apps/desktop/src/main/pi/workspace-git.ts`
  - Return review fingerprints and rename source paths.
- Delete `apps/desktop/src/main/pi/task-store.ts` after migration parity is complete; do not leave a second writer.

### Shared/preload changes

- `apps/desktop/src/shared/desktop-contracts.ts`
  - Status, availability, parent, position, bootstrap, preferences, move, relink, and review contracts.
- `apps/desktop/src/preload/index.ts`
  - Narrow wrappers for the new IPC operations.

### Renderer changes

- `apps/desktop/src/renderer/src/pages/agent-workspace/model.ts`
  - Own bootstrapped preferences and persisted Root ordering.
- `apps/desktop/src/renderer/src/pages/agent-workspace/session.ts`
  - Persist/restore drafts; typed missing-Session activation.
- `apps/desktop/src/renderer/src/pages/agent-workspace/ui/app-shell.tsx`
  - Remove localStorage helpers; consume model preferences.
- `apps/desktop/src/renderer/src/pages/agent-workspace/ui/task-sidebar.tsx`
  - Persist group collapse and add Root Task drag ordering.
- `apps/desktop/src/renderer/src/pages/agent-workspace/ui/panel-resize-handle.tsx`
  - Add commit callback.
- `apps/desktop/src/renderer/src/pages/diff-review/route.tsx`
  - Replace sessionStorage with typed preference operations and fingerprints.
- Add a small unavailable-Session prompt/dialog under the page’s `ui/` directory.

### Dependency change

Add `@atlaskit/pragmatic-drag-and-drop` to `apps/desktop/package.json`. SQLite requires no package dependency.

## Delivery sequence

### Slice 1: database and lossless migration

- Add schema, migration runner, legacy importer, and store tests.
- Acquire single-instance lock and open/close SQLite.
- Replace TaskStore reads/writes while preserving current UI behavior.
- Remove JSON dual writing.

Gate: existing tasks, selection, workflow, archives, and Session references survive migration and two restarts.

### Slice 2: lifecycle and ordering

- Add `interrupted`.
- Add derived availability and typed missing activation.
- Add relink/new-Task flow.
- Remove activity-based move-to-front.
- Add drag ordering and recursive archive/restore.

Gate: status recovery, missing Session, drag order, and subtree transactions pass verification.

### Slice 3: preferences

- Bootstrap app/workspace preferences.
- Migrate/remove legacy localStorage keys.
- Persist panels, theme, Inspector, archived filter, workspace collapse, review state, and drafts.
- Remove localStorage/sessionStorage persistence code.

Gate: every preference in the requirements matrix survives a normal restart at its intended scope.

## Verification

### Automated tests

Storage and migration logic are stable contracts that can silently lose data, so add focused Node tests despite the project’s default of avoiding broad UI tests.

Use temporary SQLite databases and fixture JSON to cover:

1. Fresh database creates schema/defaults and is idempotent.
2. Primary JSON migration preserves every field and per-workspace order.
3. Invalid primary falls back to valid `.bak`.
4. Existing but invalid primary and backup fail without an empty import marker.
5. A missing title is derived without dropping the Task; an unrecoverable identity field fails the whole import and no rows commit.
6. Re-running after the import marker does not duplicate rows or reread changed legacy files.
7. Duplicate non-null Session IDs/paths are rejected.
8. Startup converts `running` to `interrupted` and leaves other statuses unchanged.
9. Moving a Root Task renumbers only the intended workspace sequence.
10. Recursive archive/restore affects the complete subtree atomically.
11. Deleting a Task row cascades PIE metadata/drafts but does not touch fixture Session files.
12. App/workspace preference defaults, partial updates, and width normalization round-trip.
13. Reviewed-file lookup accepts only an exact fingerprint match.
14. Legacy browser preferences import once.

Add an `apps/desktop` test script for these focused tests and keep them independent of BrowserWindow and a running Electron renderer.

### Required commands

```sh
pnpm --filter pie typecheck
pnpm --filter pie test
pnpm --filter pie build
pnpm --filter pie package
```

### Manual macOS verification

1. Start from a copy of real `pie-workspace-tasks.json`; verify count, IDs, order, selection, archives, workflow, ignored Skills, and Session links after upgrade.
2. Verify the timestamped pre-SQLite copy exists and remains after subsequent launches.
3. Kill PIE during a turn; relaunch and verify `interrupted` plus the partial Session timeline.
4. Rename a Session file; verify unavailable UI, failed mismatch relink, and successful same-ID relink.
5. Create a replacement and verify the old unavailable Task remains unchanged.
6. Drag Root Tasks, perform another Prompt, and verify the order does not change and survives restart.
7. Restart after changing every required preference.
8. Mark a file reviewed, modify it, and verify it becomes unreviewed; restore the old content and verify it remains unreviewed until checked again.
9. Archive/restore a fixture parent with descendants directly through the store test harness until Child Task UI exists.
10. Launch a second PIE instance and verify it focuses the first without opening a second database owner.
11. Hold the database with an external write lock and verify PIE reports an error rather than resetting data.
12. Exercise create, prompt, Continue, abort, branch navigation/summary, inspect, export, and archive; verify PI Session files remain PI-managed.

## Definition of done

- All acceptance criteria in `docs/local-persistence.md` pass.
- No production code reads or writes `pie-workspace-tasks.json` after a successful import.
- No product preference remains in localStorage/sessionStorage after its migration completes.
- No renderer or utility-process module imports `node:sqlite`.
- No generic SQL or generic key/value persistence method crosses preload.
- SQLite and PI Session ownership are distinguishable in code and error messages.
- Typecheck, focused storage tests, build, package, and manual macOS verification pass.
