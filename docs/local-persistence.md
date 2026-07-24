# Local persistence

Executable implementation plan: [`docs/specs/sqlite-local-persistence-v1.md`](specs/sqlite-local-persistence-v1.md).

## Purpose

Move PIE-owned durable state from a whole-file JSON store and browser storage into SQLite while preserving PI Session files as PI-owned records.

## Current state

### Task catalog

`apps/desktop/src/main/pi/task-store.ts` stores the complete task catalog in:

```text
app.getPath("userData")/pie-workspace-tasks.json
```

The file contains the selected Task, array order, workspace path, Session reference, status, timestamps, archive state, workflow progress, and ignored Skill names. It is loaded into memory and rewritten in full after mutations. Writes are now serialized and use a temporary file plus rolling `.bak`; reads fall back from an invalid/missing primary file to that backup, then to an empty catalog. This reduces write races and partial-write loss but still lacks transactional multi-record changes, schema migrations, querying, and a unified home for preferences.

### Renderer state

Durable state is currently fragmented:

- `localStorage`: left and right panel open state.
- `sessionStorage`: Diff Review compare base and reviewed paths.
- Memory only: theme, panel widths, Inspector tab, archived filter, workspace group collapse state, and per-Task composer drafts.

### PI Sessions

Tasks store `sessionPath` and `sessionId`. Timelines and branch projections are read from PI JSONL through `@pi-3.14/session`; normal conversation and branch operations are performed by the PI Runtime. Archiving already leaves Session files on disk, and exporting creates a copy.

## Ownership boundary

### SQLite owns

- Task identity and metadata.
- Root/Child generation relationships.
- Active Task identity; the sidebar selection is derived from its Root Task ancestor.
- Task and sibling ordering.
- Task status and archive state.
- Workflow and ignored Skill metadata.
- Durable global, workspace, review, and Task preferences.
- Migration state.

### PI Session JSONL owns

- Messages and reasoning.
- Tool calls and results.
- Session branches and active leaf semantics.
- Compactions and branch summaries.
- PI Runtime Session metadata.

PIE must not rewrite a Session file, add PIE fields to it, or use SQLite as the authoritative transcript. Normal writes made through the PI Runtime remain allowed.

### Other files remain outside SQLite

- Personal Skills under `~/.pi/agent/skills`.
- PI trust and project Skill installation files.
- Workspace files and Git operations.
- User-exported Session copies.

## Functional requirements

### Task and Session identity

1. One Task corresponds to exactly one PI Session.
2. A PI Session must not be attached to multiple Tasks.
3. A Task stores both the stable Session ID and its current file path.
4. Session availability is independent of Task status.
5. If the Session file is missing, PIE keeps the Task and marks its Session unavailable.
6. PIE must not silently create a replacement Session for an unavailable Task.
7. Relinking must verify that the selected file has the Task's original Session ID.
8. Creating a new Session creates a new Task rather than replacing the unavailable Task's identity.

### Task Tree and Subagents

1. A user-created Task is a Root Task.
2. Every persisted Subagent Session becomes a Child Task.
3. Each Child Task has exactly one parent; generation lineage is a tree.
4. Task generation does not represent execution dependencies. A dependency graph, if needed later, is a separate concept.
5. Child Tasks do not appear in the main task sidebar.
6. A future parent-Task detail surface may open, inspect, resume, and navigate Child Tasks. While a Child Task is active, its Root Task remains highlighted in the sidebar.
7. The Active Task survives restart; if it is a Child Task, PIE restores that Child Task while continuing to highlight its Root Task.
8. A Child Task may generate further Child Tasks.
9. Each Task has an independent execution status; status is not aggregated through the tree.
10. Archiving a Task archives its entire descendant subtree in one transaction.
11. Permanently deleting PIE records for a Task deletes its entire descendant subtree of PIE metadata, after confirmation, but never deletes any PI Session file.

### Task status

Supported statuses are:

- `idle`: not executing and without a more specific latest outcome.
- `running`: currently executing.
- `done`: latest execution completed normally.
- `error`: latest execution ended with an explicit error.
- `interrupted`: execution had been running but ended without a recorded normal completion or explicit error.

On startup, every persisted `running` Task must transition to `interrupted`. PIE does not automatically resume it. Opening it shows the Session content already written; sending, continuing, or retrying transitions it back to `running`. The first release only needs to display the interrupted state and can reuse normal Continue/Retry controls rather than adding a dedicated recovery action.

### Ordering

1. Only Root Tasks participate in main sidebar ordering.
2. Root Tasks are grouped by workspace.
3. A new Root Task is inserted at the top of its workspace group.
4. Completing a Prompt, changing status, renaming, or editing workflow metadata does not reorder a Task.
5. Users may drag Root Tasks within the same workspace group.
6. Workspace groups are ordered by the newest Root Task creation time in each group.
7. Users do not drag Tasks between workspace groups or drag workspace groups directly.
8. Child siblings default to creation order and may support their own persisted manual ordering when the Child Task surface is implemented.

### Archive and deletion

1. Archive is reversible.
2. Archiving any Task archives the entire Task subtree.
3. Restoring a subtree restores its PIE metadata without changing PI Session files.
4. The default sidebar hides archived Root Tasks.
5. Permanent deletion, if exposed, removes only PIE metadata for the entire subtree.
6. Session cleanup is not part of this feature.

## Durable preferences

| Preference | Scope | Required semantics |
|---|---|---|
| Theme | Global | Restore on application start |
| Left/right panel open state | Global | Restore on application start |
| Left/right panel width | Global | Restore validated product-supported widths |
| Inspector tab | Global | Restore the last selected tab |
| Show archived | Global | Restore the last choice |
| Workspace group collapse state | Workspace | Keyed by workspace |
| Diff Review compare base | Workspace | Restore the last base for that workspace |
| Diff Review reviewed paths | Workspace + compare base + diff content | A path remains reviewed only while its patch hash is unchanged |
| Composer draft | Task | Restore independently for Root and Child Tasks |

The initial workspace identity is its absolute `cwd`. Moving or relinking a workspace is outside the first release.

## Session indexing

Session content indexing is not part of the first release. A future index may support cross-Session search, metadata aggregation, or usage analysis, provided that:

- It can be rebuilt from PI Session files.
- It records enough Session/entry identity to handle appended and branched Sessions.
- Invalid or stale index rows never modify PI Session files.
- Expensive indexing does not run on the Electron main-process critical path.

## Migration

### Task JSON

1. Migration runs once and is versioned.
2. The JSON import and initial database writes run in one transaction.
3. Imported counts and required fields are verified before commit.
4. Migration is idempotent across interrupted launches.
5. Migration reads the valid primary JSON, or the valid rolling `.bak` when the primary is invalid or missing. If neither is valid but either file exists, migration fails instead of importing an empty catalog.
6. The valid migration source is retained permanently as a timestamped pre-SQLite copy, for example:

   ```text
   pie-workspace-tasks.pre-sqlite-20260724.json
   ```

7. Migration failure leaves the original JSON and rolling backup untouched and usable; it must not replace them with an empty database.
8. After a successful migration, SQLite becomes authoritative and the legacy files are not read during normal startup.

### Legacy browser state

1. Known `localStorage` panel-state keys are imported through a narrow typed renderer-to-main migration call.
2. Legacy keys are removed only after main confirms that the database write committed.
3. Existing `sessionStorage` and memory-only values are not migration sources because they do not survive the application restart required for upgrade; their new durable records start from product defaults.
4. The migration interface accepts only known preference fields, not arbitrary storage keys.

## Failure behavior

- A locked or unwritable database produces a visible startup or operation error.
- PIE must not silently delete, replace, or reset a database after an open, migration, or query failure.
- Direct external SQLite editing is unsupported; no special compatibility is required for handcrafted invalid rows.
- Database constraints and transactions protect normal application paths.
- Missing PI Session files affect only Session availability, not the existence of Task metadata.

## Runtime and packaging constraints

- First-release platform: macOS.
- PIE must acquire Electron's single-instance lock before opening the database.
- The Electron main process owns the only application database adapter.
- Renderer and PI utility processes never receive a raw database handle or generic SQL IPC.
- IPC and storage interfaces remain narrow and typed around Tasks and preferences.
- Database path: `app.getPath("userData")/pie.sqlite3`.
- Initial SQLite implementation: Electron 42's built-in `node:sqlite` (`DatabaseSync`).
- Enable foreign-key enforcement and run explicit transactional schema migrations.
- Normal small local mutations may execute synchronously in main; future expensive Session indexing belongs in a worker or utility process.
- No application-level database encryption is required.

## Initial conceptual records

The schema must represent at least:

- Schema migration versions.
- Tasks with nullable parent identity, Session reference, lifecycle timestamps, status, archive state, and ordering position.
- Active Task identity, from which the selected Root Task is derived.
- Task workflow and ignored Skill metadata.
- Global preferences.
- Workspace preferences.
- Diff Review state tied to compare base and patch identity.
- Task composer drafts.

Exact table decomposition is an implementation decision, but callers should use a small application-storage interface rather than SQL-shaped IPC or table-specific access from UI code.

## Acceptance criteria

1. Existing Task JSON migrates without loss of Task count, identity, order, selection, workflow, archive, Skill, or Session reference data.
2. Restart restores every required preference at its defined scope.
3. Restart after an active execution shows the Task as interrupted.
4. A missing Session remains visible and cannot be silently rebound to a new Session.
5. Drag order survives restart and ordinary Task activity does not change it.
6. Archiving a parent atomically archives all descendants and leaves all Session files untouched.
7. Renderer and utility-process code cannot import or access the database directly.
8. Database or migration failures never produce an empty replacement store.
9. Existing PI Session creation, prompts, continuation, branches, summaries, inspection, and export continue to use PI-owned files and wrapper packages.

## Deferred work

- Child Task navigation UI and tree visualization.
- Session content indexing and cross-Session search.
- Workspace relocation and stable workspace identity beyond `cwd`.
- Automated SQLite backup/export/reset UX beyond retaining the migration backup.
- Windows and Linux packaging support for the new persistence layer.
- Explicit Task dependency graphs distinct from generation lineage.
