---
status: accepted
---

# Workflow steps as subagents (independent sessions + role prompts)

## Context

PIE playbooks (e.g. grill → to-spec → implement) currently run as **one Root Task / one PI Session**. “Next step” only prefills a starter prompt (`/grill-with-docs`, …). All steps share the same system prompt and an ever-growing transcript, so:

- Step roles blur (grilling vs implementing).
- Compaction and noise from earlier steps pollute later ones.
- Per-step prompt / tool / model optimization is hard.

`@pi-3.14/subagents` already provides concurrent child-session orchestration. PIE Task Tree already supports `parentTaskId` / child tasks.

## Decision

Treat **each workflow step as a subagent-shaped unit of work**:

1. **Root Task** owns the playbook state (`TaskWorkflow`) and is the sidebar selection anchor.
2. **Each step** is bound to a Task that has its own **PI Session** (`TaskWorkflowStep.taskId`).
   - Step 1 may use the Root Task itself (first slice).
   - Later steps use **Child Tasks** under the root (`parentTaskId = root`).
3. **Each playbook step defines a `rolePrompt`** (stable role instructions) separate from `starterPrompt` (user-visible first message).
4. When binding the host for a step session, PIE passes `rolePrompt` via PI `appendSystemPrompt` (alongside existing questionnaire prompt).
5. Advancing a step:
   - Marks the current step done/skipped on the root workflow.
   - Creates (if needed) the next step’s Task + Session with that step’s `rolePrompt`.
   - Activates that Task and prefills `starterPrompt`, optionally prefixed with a short **handoff** from the previous step’s last assistant text.
6. Generic model-driven `subagent` tool (parent agent spawns ad-hoc children) remains a **later** product; this ADR is **workflow-orchestrated** step sessions.

## Non-goals (this decision)

- Parallel execution of all steps at once.
- Per-step tool/model allowlists (allowed later without changing the Task boundary).
- Moving playbook state into the child sessions.
- Deleting or auto-archiving prior step sessions.

## Consequences

- Step isolation improves role fidelity and future optimization surface.
- Users may need UI to open a prior step’s child Task (listChildren / branch-like navigation).
- Root timeline no longer holds the entire playbook transcript after step 1; handoff text is the explicit bridge.
- `rolePrompt` changes require a host rebind (or new session) to take effect; starter-only edits do not.
- Storage: one PI Session JSONL per step Task; more files than a single long session, which is acceptable.

## First implementation slice

- Add `rolePrompt` to playbook step defs; add optional `taskId` on `TaskWorkflowStep`.
- Host `create` accepts extra `appendSystemPrompts`.
- Advance / attach playbook: bind step session with role prompt; spawn child for steps after the first.
- Timeline/UI: keep workflow chrome on root; activate the step’s Task when advancing.
