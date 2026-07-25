---
status: accepted
---

# Workflow step → Agent Template binding on the instance

## Context

Playbook steps bind Agent Templates for Role Prompt / skill policy snapshots (ADR-0003). The mapping lived only in duplicated code maps (`templateIdForPlaybookStep`, renderer playbooks, main `STARTER_BY_STEP`). `TaskWorkflowStep` carried `agentId` (lazy Session) but not the **business** binding. Users could not see or change which template a step uses; configurability was impossible without more hardcoding.

## Decision

1. **`TaskWorkflowStep.templateId` (and optional `starterPrompt`) is the binding.** Stamped from the playbook catalog when a Task workflow is created; overridable per Task before the step Agent is ensured.
2. **Single playbook catalog** (`shared/playbook-catalog.ts`) supplies defaults for create, UI labels, and legacy backfill. Main and renderer share it.
3. **`ensureStepAgent` reads `resolveStepTemplateId(workflow, stepId)`** (instance stamp, then catalog)—not a private map.
4. **Lazy Agent creation remains.** Binding is present on the step even when `agentId` is unset.
5. **Phase 1 UI:** show binding on the workflow card; rebind via select while unbound; open Templates admin for discovery. Bound steps lock rebind until a later “rebuild Agent” flow.
6. **Phase 2 (later):** persist/edit playbook catalog (global defaults), not only per-Task stamps.

## Consequences

- New workflows serialize template ids on every step JSON.
- Legacy workflows without stamps are normalized on read (`parseWorkflow` / ensure).
- Per-task rebind enables configurability without a full playbook editor yet.
- Snapshot isolation unchanged: changing `templateId` after ensure does not rewrite an existing Agent (phase 1 locks UI instead).
