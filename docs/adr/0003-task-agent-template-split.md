---
status: accepted
---

# Split Task, Agent, and Agent Template

## Context

PIE’s durable model centered on **Task = user work unit = 1 PI Session**, with workflow `rolePrompt` stored on the Root Task and child sessions modeled as Child Tasks. That matched an early sidebar-centric product, but it conflates three concerns: what the user is tracking, what is actually running, and what reusable “kind of agent” was used. Implementation and future features (per-step prompts, skill mounting, reusable agents, usage stats by kind) all want an explicit Agent, not a renamed Task.

The product is not formally released; PIE SQLite catalog may be reshaped without multi-version migration burden. PI Session JSONL files remain the conversation source of truth and are not deleted when PIE metadata is redesigned.

## Decision

1. **Task** is the user-facing work unit (sidebar label stays “Task”): title, archive, ordering, workflow shell. **A Task does not own a PI Session.**
2. **Agent** is the executable unit: exactly one PI Session, instance snapshot (`systemPrompt` / role, skill policy, input/output context), optional parent Agent, owned by one Task.
3. **Agent Template** is a persisted reusable definition. Instantiating an Agent copies a snapshot from the Template; instance edits do not write back through to the Template unless explicitly published.
4. **Always separate:** even playbook step 1 is its own Agent row. The Task never shares a session with step 1.
5. **Workflow steps** bind `agentId` (and status). They do not store role prompt text; prompts live on the Agent (from Template snapshot).
6. **Subagent** means spawning a child Agent; there is no separate Child Task entity.
7. **UI:** main sidebar lists Tasks only; Agents stay reachable via workflow steps / task detail, not as top-level sidebar rows.
8. **First implementation slice:** introduce the split in storage + an Agent-facing facade (bind / spawn / handoff / prompt ownership), keep sidebar copy as Task. Prefer greenfield schema over preserving the flat `tasks`-only shape.

## Considered options

- **Rename Task → Agent only:** aligns some code names but keeps the god-object; does not enable reuse or stats by kind; fights the user “task” mental model.
- **Task + Agent without Templates:** fixes prompt ownership, delays reuse/stats; rejected for the first slice because Templates are the natural registry for playbook roles and skill defaults.
- **Task still 1:1 Session (merged step 1):** smaller migration from today’s root session, but re-entangles shell and runner; rejected while we can still break cleanly.

## Consequences

- ADR-0002’s “each workflow step is a Child Task with a session” becomes “each workflow step binds an Agent with a session.” Task-tree sidebar rules remain for **Tasks**; generation lineage moves to the **Agent Tree**.
- `rolePrompt` on `TaskWorkflowStep` goes away in favor of Agent snapshot fields; activate/bind reads the Agent row.
- Status: prefer **Agent Status** for execution; Task Status is list/shell only and must be defined as rollup or explicit shell state in implementation (not session-derived from the Task).
- Wiping or reshaping `pie.sqlite3` does not remove PI Session files; losing the catalog loses Task/Agent *linkage* until recreated or relinked, not the transcripts themselves.
- `@pi-3.14/subagents` remains the runtime orchestration kit; PIE persistence maps child runs onto Agent rows under a Task.
