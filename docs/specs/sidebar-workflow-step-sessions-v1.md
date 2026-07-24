## Problem Statement

When a Root Task runs a playbook, later steps live in separate Child Task PI Sessions (ADR-0002). The main task sidebar only lists Root Tasks. After advancing, the user cannot see or jump back to earlier step sessions from the nav—they lose the map of “which step sessions exist” and “which one is open,” even though those sessions are independently resumable.

## Solution

In the main task sidebar, when the selected Root Task has a playbook workflow, nest a simple step list under that Root:

- One row per playbook step (order preserved).
- Steps that already have a bound Task/session are clickable and open that session.
- Steps not yet created are visible but not creatable from the sidebar.
- Light progress: highlight the step whose session is currently open; check mark on done/skipped steps.
- Creating and skipping steps stays on the existing WorkflowSteps Next/Skip controls—unchanged in this slice.

Selection model stays as today: sidebar selection remains the Root Task; the open conversation may be a Child Task (Active Task).

## User Stories

1. As a PIE user, I want to see playbook steps under the selected Root Task in the sidebar, so that I know which step sessions belong to this work.
2. As a PIE user, I want step rows in playbook order, so that the nav matches the engineering path I attached.
3. As a PIE user, I want step 1 to appear in the nested list even though it is the Root Task’s own session, so that the full path is visible without a missing head.
4. As a PIE user, I want later steps that already have Child Tasks to appear under the Root, so that I can find those sessions without hunting.
5. As a PIE user, I want to click an existing step row to open that step’s PI Session, so that I can review or continue that step’s conversation.
6. As a PIE user, I want the Root Task to stay the selected sidebar item while a Child step session is active, so that I do not lose which Task Tree I am in.
7. As a PIE user, I want clicking the Root row itself to open the Root/step-1 session, so that I can return to the first step quickly when a Child is active.
8. As a PIE user, I want the currently open step row to be visually highlighted, so that I can tell which session I am looking at even when the Root stays selected.
9. As a PIE user, I want done and skipped steps to show a check mark, so that I can skim progress without opening the workflow card.
10. As a PIE user, I want steps that do not yet have a taskId to appear in a non-clickable (disabled/muted) state, so that I see remaining work without implying a session already exists.
11. As a PIE user, I do not want the sidebar to create new step sessions when I click an unstarted step, so that session creation stays on the explicit Next/Skip path.
12. As a PIE user, I want Next and Skip on the existing WorkflowSteps chrome to keep working as they do today, so that advancing the playbook does not regress.
13. As a PIE user, I want switching to an earlier step session to leave workflow.stepId and step statuses unchanged, so that “what I’m viewing” is not confused with “where the playbook currently is.”
14. As a PIE user, I want only the currently selected Root to auto-expand its step list, so that the sidebar stays quiet when many Roots have playbooks.
15. As a PIE user, I want Roots without a workflow to look and behave exactly as they do today (no nested step block), so that ordinary tasks stay simple.
16. As a PIE user, I want clicking the same existing step repeatedly to only reactivate that session, so that I never duplicate Child Tasks for one step.
17. As a PIE user, I want nested step labels to be readable at a glance (playbook step labels are enough), so that I can navigate without long titles.
18. As a PIE user, I want nested rows not to offer archive/rename/drag handles, so that the sidebar stays navigation-only for steps.
19. As a PIE user, I want search, group collapse, and Root reorder behavior to remain about Root Tasks only, so that nested steps do not complicate existing sidebar mechanics.
20. As a PIE user, I want this navigation to work after app restart for workflows that already have step taskIds persisted on the Root, so that historical step sessions remain reachable.
21. As an agent implementer, I want a pure projection from workflow + playbook + activeTaskId to sidebar step rows, so that display rules are testable without Electron or DOM.
22. As an agent implementer, I want to reuse existing task activate APIs, so that opening a step session does not require new IPC or persistence shapes.

## Implementation Decisions

### Scope and product rules

- Placement: main task sidebar only; nested under the selected Root Task.
- Data source: Root Task `workflow` + playbook step definitions. Do not build a general Task Tree browser. Do not require `listChildren` for this slice.
- Clickable iff `TaskWorkflowStep.taskId` is present.
- Unstarted steps (no `taskId`): show muted/disabled; sidebar must not create sessions.
- Activate existing step: call existing activate-by-taskId path; never create a second Task for the same step.
- Sidebar selection: keep `selectedTaskId` on the Root (`rootTaskId`); `activeTaskId` is the opened step Task (Root or Child).
- Root row click: activate the Root/step-1 session (same Task as nested step 1 when step 1 is bound to the Root).
- Resume earlier step: switch Active Task/session only; do not rewrite `workflow.stepId` or step statuses.
- Progress chrome (minimal):
  - Highlight row where `step.taskId === activeTaskId`.
  - Check mark when workflow step status is `done` or `skipped`.
- Expand policy: auto-expand nested steps only for the currently selected Root that has a workflow; other Roots stay collapsed / without open nest.
- WorkflowSteps card: no behavior change in this slice (Next/Skip/Done remain the way to create/advance/skip). Weakening or removing that card is later work.
- No new glossary terms; follow CONTEXT.md (Root Task, Child Task, Active Task, PI Session, TaskWorkflow).
- Aligns with ADR-0002 (workflow steps as independent sessions); this is the minimal nav UI called out as a consequence there. No new ADR required for this slice.

### Modules / seams

- **Primary seam (pure function):** project sidebar step rows from:
  - Root workflow (and root id),
  - playbook step defs (id, label, order),
  - current `activeTaskId`.
- Output row model should include at least: step id, label, optional taskId, clickable flag, done/skipped check flag, active/open flag.
- Prefer colocating with existing playbook/workflow pure helpers rather than inventing a second workflow module family.
- **Sidebar UI:** Task sidebar renders nested rows from that projection when the Root is selected and has a workflow; wires clicks to existing session activate.
- **Session/workspace model:** ensure activating a Child keeps Root as sidebar selection (fix any path that temporarily selects the Child id if it breaks Root highlight).
- **No persistence/schema changes** expected: `TaskWorkflow` / `TaskWorkflowStep.taskId` already exist.
- **No new IPC** expected for v1.

### Interaction specifics

- Nested list order = playbook definition order.
- Step 1 included as first nested row; entity is the Root Task when bound that way.
- Disabled unstarted rows are visible (preferred over hiding) so remaining path/progress is understandable.
- Nested rows are not draggable and have no archive control.
- Status dots for Child Task running/idle are out of this slice; check + open highlight are enough.

## Testing Decisions

What makes a good test here: assert the pure projection’s external behavior (which rows, flags, order) from workflow/playbook/activeTaskId fixtures. Do not test DOM structure, CSS, or Electron activate internals.

**Module under test:** the workflow → sidebar step-row pure function (primary seam).

**Cases to cover (representative):**

- No workflow → no rows / empty projection.
- Workflow with only step 1 bound to root → one clickable row; active when `activeTaskId === rootId`.
- Later step with `taskId` → clickable; without → not clickable.
- `done` / `skipped` → check true; `pending` / `active` → check false (unless product maps only done|skipped).
- `activeTaskId` on a Child step → that row open/highlighted even if `workflow.stepId` points elsewhere (resume-without-moving-playbook).
- Order follows playbook order, not task creation time.

**Prior art:** pure workflow helpers beside playbook definitions; desktop persistence tests are for store, not this UI projection. Follow repo preference: add focused tests for this stable pure contract; no broad component/e2e requirement in early flux.

**Manual verification (acceptance):**

1. Select a Root with a playbook → nested steps expand under it.
2. After Next creates a later step session → click back to an earlier bound step → correct PI Session history; can continue chatting.
3. With a Child active → click Root row → step-1/Root session opens.
4. Open step is highlighted; done/skipped show check.
5. Root without workflow → no nested block; unchanged.
6. WorkflowSteps Next/Skip unchanged.
7. Repeated clicks on one step do not create duplicate Tasks.
8. Only the selected Root shows the expanded nest.

## Out of Scope

- Creating step sessions from the sidebar (including jump-ahead create and skip-middle state machines).
- Changing handoff / starterPrompt behavior.
- Listing ad-hoc Child Tasks or generic subagents unrelated to playbook steps.
- Multi-level Task Tree beyond Root → playbook steps.
- Child archive, rename, reorder, or search-hit on nested labels.
- Fetching Child Task.status for running dots; dual status systems in the row.
- Reworking or removing the WorkflowSteps card.
- Parallel execution of steps.
- New persistence fields or IPC for children listing in the renderer.

## Further Notes

- Domain language: use Root Task, Child Task, Active Task, PI Session, TaskWorkflow — avoid “chat job” / “top-level session.”
- Simple defaults deliberately deferred: Next/Skip still follow `workflow.stepId` even if the user is viewing an earlier session (acceptable awkwardness for v1; no disable-when-diverged logic required).
- Label text: playbook step label is sufficient for nested rows; optional use of Task.title later is non-blocking.
- If activate paths currently set sidebar selection to a Child id briefly, fix to Root for stable highlight—this is part of making the selection model match CONTEXT.md, not a new product mode.
