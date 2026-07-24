---
status: accepted
---

# Use SQLite for PIE application state

PIE will store its Task catalog, Task Tree relationships, selection, ordering, workflow metadata, drafts, and durable UI preferences in a SQLite database under Electron `userData`, owned exclusively by the Electron main process. PI Session JSONL remains the source of truth for conversation and execution history: PIE stores references to Sessions, reads them through `@pi-3.14/session`, and permits normal PI Runtime writes, but does not rewrite Session files or embed PIE metadata in them. This replaces the whole-file task JSON and fragmented browser storage so migrations, tree updates, archiving, ordering, and preferences can be changed transactionally without coupling PIE data to PI's file format.

The initial adapter will use Electron 42's built-in `node:sqlite`, avoiding a native addon rebuild and ASAR packaging dependency. Renderer and PI utility processes access application state only through narrow typed interfaces owned by main.

## Consequences

- Missing Session files make Tasks unavailable; they do not cause silent replacement with a new Session.
- Session-derived indexes, if added later, are rebuildable caches rather than authoritative copies.
- Archiving or permanently deleting PIE records never deletes PI Session files.
- The application runs as a single instance; direct external database editing is unsupported and lock/write failures are surfaced rather than repaired by resetting data.
