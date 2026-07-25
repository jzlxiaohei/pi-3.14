# Handoff: Task / Agent / Agent Template split → to-spec

**Date:** 2026-03-25  
**From:** grill-with-docs session  
**To:** to-spec agent  
**Goal of next step:** Produce an executable specification for the domain + storage + runtime facade + minimal product wiring. Do **not** implement in to-spec unless the user asks.

---

## 1. One-line summary

Split today’s god-object `WorkspaceTask` (user work + session + role prompt + tree) into:

| Concept | Role |
|---|---|
| **Task** | User-facing work unit (sidebar still says “Task”) — **no PI Session** |
| **Agent** | Executable runner — **1:1 PI Session**, owns systemPrompt / skills / I/O context |
| **Agent Template** | Persisted reusable definition; Agents snapshot from it |

Product not formally released → **greenfield PIE schema OK**; **do not** design multi-version migration of old `tasks` rows. PI Session JSONL files stay on disk and must not be deleted by catalog changes.

---

## 2. Authoritative docs (read these first)

| Doc | Why |
|---|---|
| [`CONTEXT.md`](../../CONTEXT.md) | **Updated glossary** — Task / Agent / Agent Template / Active Agent / Agent Tree / Subagent. Prefer this over older docs. |
| [`docs/adr/0003-task-agent-template-split.md`](../adr/0003-task-agent-template-split.md) | Accepted decision + rejected alternatives |
| [`docs/adr/0002-workflow-step-subagents.md`](../adr/0002-workflow-step-subagents.md) | **Superseded by 0003** for “step = Child Task”; still useful for “each step = independent session + role isolation” intent |
| [`docs/adr/0001-sqlite-for-pie-application-state.md`](../adr/0001-sqlite-for-pie-application-state.md) | SQLite owns PIE catalog; PI JSONL owns transcript |
| [`docs/local-persistence.md`](../local-persistence.md) | **Stale on Task↔Session 1:1 and Child Task** — use for preferences/archive/ordering intent only until rewritten |
| [`docs/specs/sqlite-local-persistence-v1.md`](../specs/sqlite-local-persistence-v1.md) | Current SQLite v1 shape (to be replaced/extended) |
| [`docs/specs/sidebar-workflow-step-sessions-v1.md`](../specs/sidebar-workflow-step-sessions-v1.md) | Sidebar nested steps UX — **written against old Child Task model**; must be reconciled (step binds `agentId`, step1 is not Root session) |

Package boundaries: `.agents/skills/pi-3-14-usage` — app uses `@pi-3.14/*`, not raw PI SDK.

---

## 3. User intent & success criteria (from grill)

### Motivation

- Users understand **tasks**; implementation should center **agents**.
- Each playbook step’s **system/role prompt** should be easy to own and edit on the runner.
- Later: **reuse agents**, natural **skills** mounting, **stats** on which agent kinds are used most.

### Explicit decisions (questionnaire)

1. **Model:** Split Task + Agent + Agent Template (not rename-only).
2. **Step 1:** Always separate Agent — Task never holds a session (not “merged step1 on root”).
3. **Templates:** Persist AgentTemplate in the **first** implementation slice (not code-only registry forever).
4. **First slice shape:** Storage split + Agent facade (bind / spawn / handoff / prompt ownership); sidebar copy remains “Task”.
5. **UI word:** Keep sidebar label **Task**; Agents not top-level sidebar rows (`hidden-via-workflow` — expose via workflow steps / detail).
6. **Migration:** No historical burden; greenfield catalog OK.
7. **Sessions:** PI session files are source of truth for transcripts; wiping PIE DB loses linkage only, not JSONL content.

### Success criteria (observable)

- Creating a playbook Task creates **Task row + Agent per activated step**, never a session on the Task.
- Step role/system prompt lives on **Agent** (from Template snapshot), not on `workflow.steps[].rolePrompt`.
- Activate/bind reads Agent row for `systemPrompt` / skill policy.
- AgentTemplate rows exist and playbook steps resolve to template ids.
- Sidebar still lists Tasks only; opening a step activates that step’s Agent session.
- Child/delegated work is a **child Agent**, not Child Task.
- Foundation for later: group-by `templateId` stats; skill policy on template/instance.

---

## 4. Current code model (as-is) — what to-spec must replace

### Contract

`apps/desktop/src/shared/desktop-contracts.ts`

```ts
WorkspaceTask = {
  id, parentTaskId, rootTaskId,
  title, cwd,
  sessionPath, sessionId, sessionAvailability,  // Task owns session today
  status, position, createdAt, updatedAt, archivedAt?,
  workflow?: {
    playbookId, stepId,
    steps: [{ id, status, taskId?, rolePrompt? }]  // role lives here
  },
  ignoredSkillNames?: string[]
}
```

### Storage

`apps/desktop/src/main/persistence/`

- Table `tasks` (single god table): parent_task_id, session_*, workflow_json, ignored_skill_names_json, …
- `app_state.active_task_id`
- `task_drafts.task_id`

### Runtime

`apps/desktop/src/main/pi/runtime-manager.ts`

- `createSession` / `activateTask` bind host by Task
- `rolePromptsForTask()` walks **root.workflow.steps** to find `rolePrompt` by taskId
- Status transitions on Task during prompt/continue/abort

### Renderer

- `pages/agent-workspace/model.ts` — sidebar Root Tasks only (`parentTaskId === null`)
- `session.ts` — `spawnWorkflowChild` creates Child Task + `appendSystemPrompts`
- `workflow/playbooks.ts` — step defs with `rolePrompt` + `starterPrompt`; handoff = last assistant text prefixed into starter
- `app-shell.tsx` — advance step orchestration

### Related packages

- `@pi-3.14/subagents` — in-process/process child orchestration (not yet fully product-mapped to PIE catalog)
- `@pi-3.14/runtime` — PiHost bind
- `@pi-3.14/session` — read-only JSONL

### Pain points the split fixes

1. Role prompt **not on the runner row** — reverse-lookup from root workflow JSON.
2. Task means three things: user ticket, session handle, half agent config.
3. No template id → cannot reuse or stats-by-kind.
4. Step1 special-cased as root session (ADR-0002) — rejected going forward.

---

## 5. Target domain model (frozen in grill)

```text
Task (sidebar)
  id, title, cwd
  archive, position, timestamps
  workflow?: {
    playbookId
    stepId                    // playbook cursor (where work is), not merely "what UI shows"
    steps: [{ id, status, agentId? }]
  }
  // NO sessionId / sessionPath
  // Task Status = shell/rollup (spec must define algorithm or explicit field)

AgentTemplate (persisted)
  id, name
  systemPrompt
  skillPolicy                 // shape TBD in spec
  // later: defaultModel, toolPolicy, …

Agent (1:1 PI Session)
  id
  taskId                      // owning user Task
  parentAgentId?              // Agent Tree
  templateId?                 // null = ad-hoc
  name
  systemPrompt                // instance SNAPSHOT (editable; does not write through)
  skillPolicy / ignoredSkillNames
  inputContext?               // first slice: text handoff in is enough
  outputContext?              // first slice: optional; may equal last assistant on finish
  sessionId, sessionPath, sessionAvailability
  status                      // idle|running|done|error|interrupted
  timestamps

Active Task  = sidebar highlight / work context
Active Agent = bound PiHost + open session
```

### Instantiation rules

- User creates **Task** (optionally attaches playbook workflow shell with pending steps, no agents yet — or creates step1 agent immediately; **spec must pick**).
- Activating / advancing a step:
  1. Resolve **AgentTemplate** for that playbook step
  2. Insert **Agent** with snapshot fields
  3. Create/bind **PI Session**
  4. Set `workflow.steps[i].agentId`
  5. Optional: `inputContext` from previous agent `outputContext` / handoff text
- Subagent spawn = child Agent under parent Agent (same Task unless spec says otherwise).

### UI rules

- Sidebar: **Tasks only** (no Agent tree as primary nav).
- Workflow chrome / nested step list (existing UX intent): navigate by step → activate `agentId`.
- Changing viewed step ≠ necessarily moving playbook cursor (`stepId`) — see old sidebar spec story 13; reaffirm in new spec.

---

## 6. First implementation slice (in scope for spec)

Include:

1. **Greenfield schema** for tasks / agents / agent_templates (+ FKs, indexes).
2. **Contracts** replacing/splitting `WorkspaceTask`.
3. **PieStore + RuntimeManager** API reshaped around Task shell + Agent bind.
4. **Agent facade** responsibilities: create-from-template, bind/activate, spawn child, apply handoff I/O, expose prompt/skills ownership.
5. **Playbook integration:** map each playbook step → template id; seed templates (from current `playbooks.ts` rolePrompts).
6. **Advance step flow** rewritten: no Child Task; no `rolePrompt` on workflow step.
7. **Status:** Agent status authoritative for execution; define Task status behavior.
8. **active ids:** `activeTaskId` + `activeAgentId` (or equivalent) in app state.
9. **Startup:** old catalog strategy (wipe / ignore / one-shot reset) — pick simplest.
10. **Non-deletion of PI session files** on archive/delete PIE rows.

Explicitly **out of scope** for first slice (unless user expands):

- Generic model-driven `subagent` tool productization (ADR-0002 later item).
- Parallel fan-out / DAG dependencies.
- Full Agent tree browser UI.
- Usage analytics UI (only need schema hook `templateId`).
- User-authored template editor UX (DB can exist; admin/seed may suffice).
- Preserving old `pie.sqlite3` row data.

---

## 7. Open questions for to-spec to resolve (not blocked, but must decide)

1. **Task Status algorithm**  
   - Mirror Active Agent?  
   - Derive from workflow steps?  
   - Independent shell field?

2. **When is step1 Agent created?**  
   - On Task create + attach playbook?  
   - On first open/send?

3. **Template authorship**  
   - System seed only in v1?  
   - User CRUD later?

4. **skillPolicy shape**  
   - Keep `ignoredSkillNames` denylist only?  
   - allow/deny lists on template + instance override?

5. **inputContext / outputContext**  
   - Persist columns from day one (recommended by grill direction) vs ephemeral handoff string only?
   - Who writes `outputContext` (explicit end step vs automatic last assistant)?

6. **Composer drafts**  
   - Move `task_drafts` → per-agent drafts?

7. **IPC naming**  
   - Keep `pi:tasks:*` and add `pi:agents:*`, or reshape?

8. **Reconcile** `sidebar-workflow-step-sessions-v1.md`  
   - step1 is no longer Root session; nested rows bind `agentId`.

9. **Stale docs update list** for implement phase  
   - `local-persistence.md`, sqlite spec, any Child Task references in UI copy.

10. **Parent of first agent**  
    - `parentAgentId = null`; later steps parent = previous step agent or null + only taskId? (tree vs linear workflow-only)

---

## 8. Suggested target types (sketch only — spec may refine)

```ts
type Task = {
  id: string
  title: string
  cwd: string
  status: TaskStatus // define
  position: number
  createdAt: number
  updatedAt: number
  archivedAt?: number
  workflow?: TaskWorkflow
}

type TaskWorkflow = {
  playbookId: TaskPlaybookId
  stepId: string
  steps: Array<{
    id: string
    status: "pending" | "active" | "done" | "skipped"
    agentId?: string
    // no rolePrompt
  }>
}

type AgentTemplate = {
  id: string
  name: string
  systemPrompt: string
  skillPolicy: SkillPolicy
  createdAt: number
  updatedAt: number
  // source?: "system" | "user"
}

type Agent = {
  id: string
  taskId: string
  parentAgentId: string | null
  templateId: string | null
  name: string
  systemPrompt: string
  skillPolicy: SkillPolicy
  inputContext?: string | null
  outputContext?: string | null
  sessionId: string | null
  sessionPath: string | null
  sessionAvailability: "available" | "missing"
  status: "idle" | "running" | "done" | "error" | "interrupted"
  position: number
  createdAt: number
  updatedAt: number
}

// Live-only
// bind(agentId) -> PiHost; getContext() projects live system/skills/tools/transcript
```

Playbook step def evolution sketch:

```ts
// today: rolePrompt + starterPrompt
// target: templateId + starterPrompt (template holds systemPrompt)
```

---

## 9. Key code pointers (implementation will touch)

| Area | Path |
|---|---|
| Contracts | `apps/desktop/src/shared/desktop-contracts.ts` |
| DB schema | `apps/desktop/src/main/persistence/migrations.ts` |
| Store | `apps/desktop/src/main/persistence/pie-store.ts` |
| Runtime | `apps/desktop/src/main/pi/runtime-manager.ts` |
| IPC | `apps/desktop/src/main/index.ts`, `preload/index.ts` |
| Workspace model | `apps/desktop/src/renderer/src/pages/agent-workspace/model.ts` |
| Session orchestration | `.../agent-workspace/session.ts` |
| Playbooks | `.../agent-workspace/workflow/playbooks.ts` |
| Advance UI | `.../agent-workspace/ui/app-shell.tsx` |
| Host bind / skills filter | `apps/desktop/src/main/pi/host-process.ts` |

---

## 10. Constraints & invariants

1. **One Agent ↔ one PI Session**; a Session must not attach to two Agents (unique session id/path).
2. **Task never stores session** fields.
3. **Archive Task ⇒ archive/hide all its Agents** (transaction); never delete JSONL.
4. **Session missing** ⇒ Agent unavailable; do not silently create replacement session without product rule (today: warn + bind new — spec should reaffirm or tighten).
5. **Instance snapshot isolation:** editing Agent.systemPrompt does not mutate AgentTemplate.
6. **Generation lineage is a tree** (single parentAgentId), not a DAG.
7. **Renderer** never imports `@pi-3.14/runtime` / PI SDK; main owns DB; utility process owns embedded host.
8. **Single Electron instance** lock before DB open (existing).
9. Prefer **Orbit / existing UI patterns**; this slice is model-first, not visual redesign.
10. **No new tests by default** per AGENTS.md unless pure contract parsing needs them or user asks.

---

## 11. Rejected alternatives (do not re-open without new evidence)

| Rejected | Why |
|---|---|
| Rename Task → Agent only | No reuse/stats; destroys user “task” language; god-object remains |
| Task remains 1:1 Session (merged step1) | Re-entangles shell and runner |
| Templates later / code-only forever | Blocks skills-on-kind and stats; user wanted persist-first |
| Agent-centric sidebar | User explicitly keep Task label; agents via workflow |
| Heavy migration of old tasks table | Not released; greenfield preferred |

---

## 12. Deliverable expected from to-spec

A spec under `docs/specs/` (name suggestion: `task-agent-template-split-v1.md`) including at least:

1. Problem statement & goals  
2. Domain rules / invariants (aligned with CONTEXT + ADR-0003)  
3. Schema (tables, columns, FKs, indexes)  
4. Public contracts / IPC surface  
5. Runtime lifecycle (create task, attach playbook, create agent from template, prompt, advance step, handoff, activate, archive)  
6. Mapping from current playbooks → seeded templates  
7. UI touch list (minimal behavior changes, copy stays “Task”)  
8. Startup / empty-catalog behavior  
9. Acceptance criteria (testable)  
10. Out of scope  
11. Doc debt to update in implement (local-persistence, sidebar spec, etc.)  
12. Open questions only if truly blocked — otherwise decide defaults in the spec  

Use project `/to-spec` skill conventions if available.

---

## 13. Handoff checklist for the next agent

- [ ] Read CONTEXT.md + ADR-0003 (+ 0001 for ownership boundary)
- [ ] Skim as-is: `desktop-contracts.ts`, `pie-store.ts`, `runtime-manager.ts` rolePromptsForTask, `playbooks.ts`, advance flow in `app-shell.tsx`
- [ ] Note ADR-0002 superseded; do not specify Child Task
- [ ] Note sidebar nested-steps spec is stale on step1=root
- [ ] Write executable spec; resolve §7 with explicit defaults
- [ ] Do not implement full feature in to-spec unless user says so
