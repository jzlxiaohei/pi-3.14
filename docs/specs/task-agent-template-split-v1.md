---
status: accepted
---

# Task / Agent / Agent Template split v1

Executable specification for [ADR-0003](../adr/0003-task-agent-template-split.md), aligned with [`CONTEXT.md`](../../CONTEXT.md). Supersedes the Child Task / “Task owns Session” assumptions in [ADR-0002](../adr/0002-workflow-step-subagents.md) (already superseded), [`docs/local-persistence.md`](../local-persistence.md), [sqlite-local-persistence-v1](./sqlite-local-persistence-v1.md), and [sidebar-workflow-step-sessions-v1](./sidebar-workflow-step-sessions-v1.md) for catalog shape and step binding.

Product is unreleased: **greenfield PIE catalog**. **Do not delete PI Session JSONL** when reshaping or wiping catalog rows.

## Problem Statement

Users track work as **Tasks**, but today’s `WorkspaceTask` is a god-object: user ticket + PI Session handle + role prompt lookup + half of agent config. Workflow step roles live on root `workflow.steps[].rolePrompt` and are reverse-looked-up at bind time. Step 1 is special-cased as the Root session (ADR-0002). There is no reusable Agent kind, so skill defaults and later usage stats cannot hang off a stable identity.

Implementers cannot own “what runs” without also dragging sidebar/archive semantics, and users cannot get a clean per-step runner with an editable instance prompt.

## Solution

Split the durable model into three concepts:

| Concept | User-facing role |
|---|---|
| **Task** | Sidebar work unit (label stays “Task”): title, archive, order, workflow shell. **No PI Session.** |
| **Agent** | Executable runner: **1:1 PI Session**, instance snapshot (system prompt, skill policy, I/O context), optional parent Agent, owned by one Task. |
| **Agent Template** | Persisted reusable definition. Instantiating an Agent **snapshots** template fields; instance edits do not write through. |

Playbook steps bind `agentId` (not `taskId` / `rolePrompt`). Step 1 is always its own Agent. Subagent work is a **child Agent**, never a Child Task. Main sidebar still lists Tasks only; step sessions open via workflow chrome / nested step rows.

First slice: greenfield schema + contracts + PieStore/RuntimeManager Agent facade + playbook seed/advance rewrite + minimal UI wiring. No visual redesign; no analytics UI. **User template admin** was deferred from this slice and is specified in [agent-templates-admin-v1](./agent-templates-admin-v1.md) / [ADR-0005](../adr/0005-agent-templates-admin.md).

## User Stories

1. As a PIE user, I want the sidebar to keep saying “Task”, so that my work list still matches how I think about work.
2. As a PIE user, I want creating a playbook Task to set up a workflow shell without inventing a Session on the Task itself, so that shell and runner stay separate.
3. As a PIE user, I want playbook step 1 to run in its own Agent Session, so that step 1 is not a special Root-session case.
4. As a PIE user, I want each playbook step to use the right role/system prompt automatically, so that I do not paste roles by hand.
5. As a PIE user, I want advancing to the next step to open a new Agent Session with handoff context, so that later steps start from prior conclusions.
6. As a PIE user, I want skipping a step to mark it skipped and move on without leaving a half-bound runner, so that the path stays honest.
7. As a PIE user, I want to reopen an earlier step’s conversation without moving the playbook cursor, so that “what I’m viewing” ≠ “where the path is.”
8. As a PIE user, I want nested step rows under a selected Task (when it has a playbook), so that I can see which step sessions exist.
9. As a PIE user, I want unstarted steps visible but not creatable from the sidebar, so that creation stays on Next/Skip.
10. As a PIE user, I want clicking a bound step row to activate that step’s Agent Session, so that I can resume it.
11. As a PIE user, I want ordinary (non-playbook) Tasks to still get one chat Session when I start work, so that simple tasks stay simple.
12. As a PIE user, I want Task archive to hide the Task and all its Agents without deleting JSONL files, so that transcripts remain on disk.
13. As a PIE user, I want a missing Session file to make that Agent unavailable (with recover/relink), so that PIE never pretends the old transcript is still there.
14. As a PIE user, I want composer drafts to follow the Agent I’m editing, so that switching steps does not clobber another step’s draft.
15. As a PIE user, I want Active Task (sidebar) and Active Agent (open session) to be distinct, so that I can stay “in” a Task while viewing a specific step Agent.
16. As a PIE user, I want execution status (running/error/…) to reflect the Agent that is actually running, so that list chrome is trustworthy.
17. As a PIE user, I want instance prompt/skill tweaks on one Agent not to rewrite the shared template, so that other runs keep the stock definition.
18. As an implementer, I want AgentTemplate rows seeded from current playbook roles, so that steps resolve by template id.
19. As an implementer, I want activate/bind to read `Agent.systemPrompt` / skill policy from the Agent row, so that main never reverse-looks-up role text from workflow JSON.
20. As an implementer, I want a single Agent facade for create-from-template, bind, spawn child, and handoff I/O, so that renderer orchestration stays thin.
21. As an implementer, I want greenfield catalog reset without multi-version row migration, so that unreleased shape debt is dropped.
22. As an implementer, I want PI Session files left untouched when the catalog is wiped or Tasks/Agents are archived, so that transcripts are never collateral damage.
23. As an implementer, I want `templateId` on every templated Agent, so that later stats can group by kind without a rewrite.
24. As an implementer, I want workflow step defs to reference `templateId` + `starterPrompt` only, so that role text has one home (the template/agent snapshot).
25. As an implementer, I want linear playbook Agents to be peers under a Task (`parentAgentId = null`), so that Agent Tree means true delegation, not step order.
26. As an implementer, I want child Agents from subagent spawn to set `parentAgentId`, so that generation lineage is a real tree.
27. As an implementer, I want package boundaries preserved (renderer → preload → main → utility host; `@pi-3.14/*` only), so that SQLite and PI SDK stay off the renderer.
28. As an implementer, I want stale Child Task APIs removed or reduced to Task-only list APIs, so that the god-object path cannot be reintroduced by accident.

## Implementation Decisions

### Domain invariants

1. **One Agent ↔ one PI Session.** `session_id` / `session_path` unique among Agents when non-null. A Session must not attach to two Agents.
2. **Task never stores session fields** (`sessionId`, `sessionPath`, `sessionAvailability`).
3. **Archive Task ⇒ archive/hide all its Agents** in one transaction; **never delete JSONL**.
4. **Session missing ⇒ Agent unavailable** for normal resume. Reaffirm current product behavior: warn, allow force-bind that creates a **new** Session and updates the Agent row, and keep explicit relink when the user picks the old file. Do not silently replace on every activate without the existing missing path.
5. **Snapshot isolation:** editing `Agent.systemPrompt` or `Agent.skillPolicy` does not mutate `AgentTemplate`.
6. **Generation lineage is a tree:** at most one `parentAgentId`; no DAG edges.
7. **Playbook step Agents are not generation children of each other.** They share `taskId` and are linked only via `workflow.steps[].agentId`. `parentAgentId` stays `null` unless a true subagent spawn created them.
8. **Active Task** = sidebar / work-context highlight. **Active Agent** = bound PiHost + open Session. Both persisted in `app_state`.
9. **Renderer** never imports `@pi-3.14/runtime` or opens SQLite. Main owns DB; utility process owns embedded host.
10. **Single Electron instance** lock before DB open (unchanged).

### Resolved open questions (defaults)

| # | Question | Decision |
|---|---|---|
| 1 | Task Status | **Explicit stored field** on Task, **recomputed** on Agent status changes and workflow advance (algorithm below). Not a live-only mirror with no column. |
| 2 | When is step1 Agent created? | **Lazy on first need:** workflow shell is created when playbook is attached; step Agent + PI Session are created on first activate/open of that step (including first open of a new playbook Task). Creating a Task alone does not create Sessions. |
| 3 | Template authorship | **System seed only** in the split v1 slice (`source = 'system'`). User CRUD + editable system rows: [agent-templates-admin-v1](./agent-templates-admin-v1.md) / [ADR-0005](../adr/0005-agent-templates-admin.md). |
| 4 | `skillPolicy` shape | `{ ignoredSkillNames: string[] }` denylist only. Present on Template and Agent (snapshot + per-instance override). Extensible later. |
| 5 | I/O context | **Persist** `input_context` / `output_context` columns from day one. On step advance (done/skipped), set previous Agent `outputContext` to last assistant text (same source as today’s handoff). New step Agent gets that string as `inputContext`. Composer prefill remains `handoff + starterPrompt`. |
| 6 | Drafts | **Per-Agent** drafts (`agent_drafts`). Drop `task_drafts`. |
| 7 | IPC naming | Keep `pi:tasks:*` for Task shell; add `pi:agents:*` and `pi:templates:list`. Activate/bind moves to **agent id**. |
| 8 | Sidebar nested steps | Reconcile to **`agentId`**; step1 is first step Agent, not Task session. Selection: sidebar selected **Task**; open conversation = **Active Agent**. |
| 9 | Stale docs | Implement phase updates list in Further Notes — not blockers for this spec. |
| 10 | Parent of step Agents | **`parentAgentId = null`** for all playbook step Agents. Only explicit subagent spawn sets parent. |

### Task Status algorithm

Store `tasks.status` with the same enum as today: `idle | running | done | error | interrupted`.

Recompute whenever an Agent under the Task changes status, on workflow advance, and on archive/restore:

1. Consider non-archived Agents for `task_id` (v1: Agents inherit Task archive via Task archive transaction; no separate agent archive UI).
2. If any Agent `status === 'running'` → Task `running`.
3. Else if any Agent `status === 'error'` → Task `error`.
4. Else if Task has workflow and every step status is `done` or `skipped` → Task `done`.
5. Else if any Agent `status === 'interrupted'` → Task `interrupted`.
6. Else → Task `idle`.

Notes:

- Execution authority remains **Agent Status**; Task Status is list/shell chrome only.
- No-workflow Tasks with a single ad-hoc Agent naturally follow that Agent through steps 2–3/5–6 (no step-4 short-circuit).
- Do not read Session files to derive Task Status.

### Agent Status

Same enum: `idle | running | done | error | interrupted`.

Write paths (parity with today’s Task status writes, moved to Agent):

- Bind/create → `idle` (unless a turn immediately starts).
- Prompt / continue start → `running`.
- Turn success → `idle` (in-progress chat) unless product marks step complete.
- Turn error → `error`.
- Abort / app restart while `running` → `interrupted` (startup sweep: `UPDATE agents SET status = 'interrupted' WHERE status = 'running'`).
- Workflow advance marks the **previous step’s Agent** `done` when mode is `done`, leaves status as-is on `skipped` except it must not stay `running` (force `idle` if it was `running`/`interrupted` is acceptable; prefer: abort if running, then `idle`, step status `skipped`).

### Schema (greenfield v2)

Replace the tasks-as-sessions catalog. Prefer a clean v2 schema over multi-step column surgery.

**Startup strategy (simplest):**

1. Single-instance lock (unchanged).
2. Open `userData/pie.sqlite3`.
3. If `schema_migrations` newest version is not exactly the version that defines this split (call it **2**), **close DB**, rename file to `pie.sqlite3.pre-agent-split-{timestamp}`, open a new DB, apply full v2 schema.
4. Do **not** import `pie-workspace-tasks.json` into the new Agent model.
5. Never delete `*.jsonl` Session files during this reset.
6. Seed **system** AgentTemplates (upsert by id) on every successful open after migrations (idempotent).

**Tables (conceptual columns):**

```text
agent_templates
  id TEXT PRIMARY KEY
  name TEXT NOT NULL
  system_prompt TEXT NOT NULL
  skill_policy_json TEXT NOT NULL  -- SkillPolicy, json_valid
  source TEXT NOT NULL CHECK (source IN ('system'))  -- widen later
  created_at INTEGER NOT NULL
  updated_at INTEGER NOT NULL

tasks
  id TEXT PRIMARY KEY
  title TEXT NOT NULL
  cwd TEXT NOT NULL
  status TEXT NOT NULL CHECK (status IN ('idle','running','done','error','interrupted'))
  position INTEGER NOT NULL
  created_at INTEGER NOT NULL
  updated_at INTEGER NOT NULL
  archived_at INTEGER NULL
  workflow_json TEXT NULL CHECK (workflow_json IS NULL OR json_valid(workflow_json))
  -- NO parent_task_id, session_*, ignored_skill_names_json

agents
  id TEXT PRIMARY KEY
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE
  parent_agent_id TEXT NULL REFERENCES agents(id) ON DELETE CASCADE
  template_id TEXT NULL REFERENCES agent_templates(id) ON DELETE SET NULL
  name TEXT NOT NULL
  system_prompt TEXT NOT NULL
  skill_policy_json TEXT NOT NULL
  input_context TEXT NULL
  output_context TEXT NULL
  session_id TEXT NULL
  session_path TEXT NULL
  status TEXT NOT NULL CHECK (status IN ('idle','running','done','error','interrupted'))
  position INTEGER NOT NULL
  created_at INTEGER NOT NULL
  updated_at INTEGER NOT NULL

app_state
  singleton = 1
  active_task_id TEXT NULL REFERENCES tasks(id) ON DELETE SET NULL
  active_agent_id TEXT NULL REFERENCES agents(id) ON DELETE SET NULL

agent_drafts
  agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE
  draft TEXT NOT NULL
  updated_at INTEGER NOT NULL

-- unchanged in spirit:
app_preferences, workspace_preferences, reviewed_files, legacy_imports (optional retain)
```

**Indexes:**

- `UNIQUE agents(session_id) WHERE session_id IS NOT NULL`
- `UNIQUE agents(session_path) WHERE session_path IS NOT NULL`
- `tasks(cwd, position, created_at)` for sidebar order (all tasks are “root”; no parent filter)
- `agents(task_id, position, created_at)`
- `agents(parent_agent_id, position, created_at) WHERE parent_agent_id IS NOT NULL`
- `agents(template_id) WHERE template_id IS NOT NULL` (stats hook)

**workflow_json shape:**

```ts
type TaskWorkflow = {
  playbookId: TaskPlaybookId
  stepId: string // playbook cursor
  steps: Array<{
    id: string
    status: "pending" | "active" | "done" | "skipped"
    agentId?: string
    // no rolePrompt, no taskId
  }>
}
```

### Public contracts (shared types)

Replace/split `WorkspaceTask` usage. Names below are normative for the desktop contract module; keep Orbit/UI copy as “Task”.

```ts
type SkillPolicy = { ignoredSkillNames: string[] }

type TaskStatus = "idle" | "running" | "done" | "error" | "interrupted"
type AgentStatus = TaskStatus
type SessionAvailability = "available" | "missing"

type Task = {
  id: string
  title: string
  cwd: string
  status: TaskStatus
  position: number
  createdAt: number
  updatedAt: number
  archivedAt?: number
  workflow?: TaskWorkflow
}

type AgentTemplate = {
  id: string
  name: string
  systemPrompt: string
  skillPolicy: SkillPolicy
  source: "system"
  createdAt: number
  updatedAt: number
}

type Agent = {
  id: string
  taskId: string
  parentAgentId: string | null
  templateId: string | null
  name: string
  systemPrompt: string
  skillPolicy: SkillPolicy
  inputContext: string | null
  outputContext: string | null
  sessionId: string | null
  sessionPath: string | null
  sessionAvailability: SessionAvailability // derived at read, as today
  status: AgentStatus
  position: number
  createdAt: number
  updatedAt: number
}
```

**Bootstrap** must provide enough for first paint:

- `tasks` (sidebar list; non-archived default)
- `activeTask` / `activeTaskId`
- `activeAgent` / `activeAgentId`
- `agentsByTaskId` at least for `activeTaskId` (or full map if cheap)
- preferences (unchanged)

**Create / update requests:**

- `TaskCreate`: `{ cwd, title?, playbookId? }` → Task only (optional workflow shell, no Agent).
- `TaskUpdate`: title, workflow replace/clear — **not** session fields, **not** ignored skills.
- `AgentUpdate`: name, systemPrompt, skillPolicy, input/output context (as needed).
- `AgentCreateFromTemplate`: `{ taskId, templateId, stepId?, parentAgentId?, inputContext?, name? }`.
- `AgentSpawnChild`: `{ parentAgentId, templateId?, name, systemPrompt?, skillPolicy?, inputContext? }` → child under same `taskId` as parent.
- Session create options no longer take `parentTaskId` / task-owned session; host bind reads Agent snapshot.

**Activate result:** `PiActivateAgentResult` with `agent` + host state + timeline; `session_missing` includes the Agent row.

**Archive result:** includes `activeTaskId`, `activeAgentId`, `disposed` when the bound Agent was under the archived Task.

Remove Child Task list as a product API (`listChildren` of tasks). Optional later: `listAgents(taskId)` / `listChildAgents(parentAgentId)`.

### Playbook → template mapping

Playbook step definitions change from `rolePrompt + starterPrompt` to **`templateId + starterPrompt`**. Role/system text lives only on templates (and Agent snapshots).

**Seed template ids** (stable, system):

| Template id | Playbook step | Name (approx) |
|---|---|---|
| `tpl:feature-default/grilling` | feature-default / grilling | grill-with-docs |
| `tpl:feature-default/to-spec` | feature-default / to-spec | to-spec |
| `tpl:feature-default/implement` | feature-default / implement | implement |
| `tpl:small-tdd/tdd` | small-tdd / tdd | tdd |
| `tpl:small-tdd/code-review` | small-tdd / code-review | code-review |
| `tpl:bugfix/diagnosing-bugs` | bugfix / diagnosing-bugs | diagnosing-bugs |
| `tpl:bugfix/tdd` | bugfix / tdd | tdd (fix) |
| `tpl:bugfix/code-review` | bugfix / code-review | code-review (fix) |

`system_prompt` bodies = current `rolePrompt` strings in playbooks (copy verbatim at seed time). Default `skill_policy_json = {"ignoredSkillNames":[]}`.

`createWorkflow(playbookId)`:

- Builds steps with statuses (`first → active`, rest `pending`).
- Does **not** embed role prompts.
- Does **not** create Agents.

`advanceWorkflow` pure helper:

- Marks current step done/skipped; activates next step row status; returns next step def (`templateId`, `starterPrompt`).
- Does not create Agents (facade does).

### Runtime lifecycle

#### A. Create Task (no playbook)

1. Insert Task (`status=idle`).
2. Set Active Task.
3. No Agent/Session yet.
4. On first send/open chat: create **ad-hoc Agent** (`templateId=null`, default empty systemPrompt or host-only defaults, `parentAgentId=null`), create PI Session, bind host, set Active Agent, recompute Task status.

#### B. Create Task with playbook / attach playbook

1. Insert/update Task with `workflow` shell (`stepId` = first step, statuses as above).
2. No Agents yet.
3. Set Active Task.

#### C. Activate Task (sidebar select / open)

1. Set Active Task.
2. Choose Agent to open:
   - If workflow: prefer Agent for `workflow.stepId` if `agentId` present; else **ensure** step Agent for `stepId` (create-from-template + session); else if user had a remembered Active Agent under this Task that still exists, may reopen it only when explicitly activating that agent — default open follows playbook cursor.
   - If no workflow: prefer existing Active Agent under Task if any; else latest Agent by position; else create ad-hoc Agent on demand when user starts a session (empty timeline until then is OK).
3. `activateAgent(agentId)`.

#### D. `ensureStepAgent(taskId, stepId)`

1. If step already has `agentId` and row exists → return it (idempotent; never second Agent for same step).
2. Resolve playbook step → `templateId`.
3. Load template; snapshot `systemPrompt` + `skillPolicy` onto new Agent.
4. `inputContext` = previous step Agent’s `outputContext` when advancing; null on cold step1.
5. Create PI Session **before** insert finalize (same ordering rule as ADR-0001: session file first, then row; on row failure dispose host, leave orphan JSONL).
6. Persist Agent with session ids/paths; set `workflow.steps[i].agentId`; recompute Task status.
7. Host bind uses Agent snapshot:
   - `appendSystemPrompts: [agent.systemPrompt]` when non-empty
   - `ignoredSkillNames: agent.skillPolicy.ignoredSkillNames`

#### E. `activateAgent(agentId)`

1. Load Agent (+ parent Task for cwd).
2. Set `active_task_id` / `active_agent_id`.
3. Bind host from Agent session path + snapshot fields (replace `rolePromptsForTask`).
4. Missing file path: existing warn + new session bind behavior, update Agent row.
5. Return agent + state + timeline.

#### F. Advance step (Next done / Skip)

Renderer may still call pure `advanceWorkflow` for the next shell snapshot, but **persistence and Agent creation go through main facade** (recommended single entry: `advanceTaskWorkflow({ taskId, mode })`) to keep handoff consistent:

1. Require Active Task with workflow; current step = `workflow.stepId`.
2. Capture handoff text from Active Agent timeline (last assistant), write previous Agent `outputContext`.
3. Mark previous step `done`|`skipped`; adjust previous Agent status per rules above.
4. If no next step: persist workflow; recompute Task status (`done` if all terminal); return.
5. Else set next step `active`, `workflow.stepId = next`.
6. `ensureStepAgent` for next with `inputContext = handoff`.
7. Activate new Agent; prefill composer with `buildStepOpenPrompt(starter, handoff)` (draft on **new** agent id).
8. Do not create Child Tasks; do not write `rolePrompt` into workflow JSON.

#### G. Nested sidebar step click

- If step has `agentId` → `activateAgent` only.
- Do **not** change `workflow.stepId` or step statuses (view ≠ cursor).
- If no `agentId` → no-op (muted row).

#### H. Root/Task row click

- Select Task; activate playbook cursor Agent if any, else ensure/open default Agent as in (C).
- Not “activate Task session.”

#### I. Subagent spawn (facade ready; deep product tool optional)

1. `spawnChildAgent` under parent Agent’s `taskId`, `parentAgentId = parent`.
2. Optional template snapshot or ad-hoc prompts.
3. Own Session; activate child when product asks.
4. Full generic `subagent` tool productization remains out of scope; facade is the seam.

#### J. Archive / restore

- Archive Task tree replacement: archive Task row + all Agents (same `archived_at` stamp); clear active ids if pointed inside; dispose host if bound Agent archived.
- Restore clears archive on Task + its Agents.
- JSONL untouched.

#### K. Relink

- Relink is **per Agent** (pick JSONL, verify session id rules as today’s task relink).

#### L. Skill ignore toggles

- Persist on **Agent.skillPolicy**; force-rebind Active Agent (quiet rebind path preserved).

### Agent facade responsibilities (main)

One module surface (RuntimeManager + PieStore as needed) must own:

| Op | Responsibility |
|---|---|
| `createTask` | Task row ± workflow shell |
| `attachPlaybook` / `clearPlaybook` | workflow_json only |
| `createAgentFromTemplate` / `ensureStepAgent` | snapshot + session + step bind |
| `createAdHocAgent` | templateId null |
| `activateAgent` | host bind from Agent row |
| `spawnChildAgent` | parent link + session |
| `advanceTaskWorkflow` | handoff I/O + step statuses + ensure next |
| `updateAgent` | prompt/skills/context |
| `setAgentStatus` / rollup Task status | execution writes |
| `archiveTask` / `restoreTask` | task + agents |
| `relinkAgentSession` | availability recovery |
| drafts get/save by `agentId` | preferences |

Renderer keeps: timeline UX, composer, playbook labels, pure workflow view helpers, calling facade/IPC.

### IPC surface (delta)

| Channel | Notes |
|---|---|
| `pi:tasks:bootstrap` | New payload shape (tasks + active agent + agents slice) |
| `pi:tasks:create` | No session; optional playbookId |
| `pi:tasks:update` | Shell fields only |
| `pi:tasks:archive` / `restore` / `move` / `set-active` | Task-level; set-active may also resolve default agent |
| ~~`pi:tasks:list-children`~~ | Remove or no-op deprecated |
| `pi:tasks:activate` | **Remove or redirect** — replace with agents activate |
| `pi:agents:list` | by taskId |
| `pi:agents:activate` | primary bind entry |
| `pi:agents:create` | from template / ad hoc |
| `pi:agents:update` | snapshot fields |
| `pi:agents:spawn` | child agent |
| `pi:agents:advance-workflow` | optional single entry for F |
| `pi:agents:relink` | session pick |
| `pi:templates:list` | seed/debug; editor not required |
| `pi:preferences:getDraft` / `saveDraft` | keys become `agentId` |

Host command `create` still accepts `appendSystemPrompts` + `ignoredSkillNames`; main supplies them from the Agent row only.

### UI touch list (minimal)

- Sidebar: Tasks only; nested steps projection uses `agentId`, click → activate agent; selected id = Task id; open highlight = Active Agent matches step.agentId.
- Workflow card Next/Skip → new advance path (no Child Task spawn, no rolePrompt persistence).
- Session/workspace model: track `activeTaskId` + `activeAgentId`; drafts keyed by agent; remove parentTaskId child-task plumbing.
- Task create / playbook attach: write shell only.
- Missing session / relink copy: say Agent/Session, not Task session.
- No Agent tree browser; no template admin UI; no analytics UI.

### Modules / seams

Prefer **one primary product seam**: the **Agent facade** on main (create/ensure/activate/advance/spawn/archive). Secondary **pure** seams (no Electron):

1. Playbook defs ↔ template ids + `createWorkflow` / `advanceWorkflow` / `buildStepOpenPrompt`.
2. Task status rollup function `(task, agents) → TaskStatus`.
3. Sidebar step-row projection `(task.workflow, playbook labels, activeAgentId) → rows`.

Do not add a second persistence stack. Do not put catalog logic in `@pi-3.14/*`.

### Package boundaries

Unchanged from project PI usage skill: desktop app uses `@pi-3.14/runtime`, `@pi-3.14/session`, and later `@pi-3.14/subagents` for orchestration kits; PIE maps child runs onto Agent rows.

## Testing Decisions

Per `AGENTS.md`: **no new test suite by default** for early-flux UI/store. Prefer typecheck + manual verification.

**Good tests** (only if touched pure helpers are stable and silent-break risk is high): external behavior of pure functions — workflow advance, rollup, sidebar projection, template id mapping — not DOM, not IPC, not SQLite integration unless already extending `pie-store` tests the user asks to keep green.

**If** existing `pie-store` tests encode Child Task / session-on-task assumptions, update or gut them so greenfield schema is the source of truth; do not preserve obsolete migration tests as product requirements.

**Manual acceptance** (implement gate): see Acceptance Criteria below.

## Acceptance Criteria

Observable checks for “v1 done”:

1. Fresh app start with old `pie.sqlite3` v1 → catalog reset backup created; app boots empty; existing JSONL files still on disk.
2. Create Task without playbook → Task row only; no `session_*` on Task; first chat creates one Agent + Session.
3. Create/attach playbook → `workflow_json` has steps **without** `rolePrompt`/`taskId`; no Agents until first open/advance need.
4. First open of playbook Task → step1 Agent exists, `templateId` set, Session bound, `workflow.steps[0].agentId` set; Task has no session fields.
5. Activate reads Agent `systemPrompt` (host append) — workflow JSON is not consulted for roles.
6. Next (done) → previous Agent `outputContext` set; previous step `done`; new Agent snapped from next template; `inputContext` = handoff; composer prefill = handoff + starter; no Child Task rows.
7. Skip → step `skipped`; next Agent created similarly; no requirement that skipped step has an Agent if it never had one.
8. Sidebar lists Tasks only; nested steps show for selected playbook Task; bound steps clickable by `agentId`; unstarted muted; click does not move `workflow.stepId`.
9. Viewing an earlier step keeps playbook cursor unchanged; Active Agent switches; Active Task stays the same Task.
10. Archive Task hides Task + Agents; JSONL remains; active ids cleared if needed; host disposed if bound inside.
11. Missing Session on an Agent → unavailable path; force/new bind or relink updates **Agent**, not Task.
12. Drafts restore per Agent across step switches.
13. `agent_templates` contains the eight seeded system templates after boot; playbook steps resolve those ids.
14. Editing Agent system prompt does not change template row.
15. Typecheck passes for desktop app contracts after the split.

## Out of Scope

- Generic model-driven `subagent` tool productization / marketplace.
- Parallel fan-out, DAG dependencies between steps.
- Full Agent tree browser UI.
- Usage analytics UI (schema hook `template_id` only).
- User-authored template editor / publish-back-to-template. *(Editor/CRUD later specified in agent-templates-admin-v1; publish-back still out.)*
- Preserving or migrating old `tasks` session rows / Child Task trees.
- Permanent delete / purge UI for JSONL or catalog.
- Visual redesign of sidebar/workflow beyond binding fixes.
- Rewriting `@pi-3.14/*` APIs for this split.
- Multi-window or multi-DB.

## Further Notes

### Doc debt (implement or immediate follow-up)

| Doc | Action |
|---|---|
| `CONTEXT.md` | Already updated — keep as glossary authority |
| `docs/adr/0003-task-agent-template-split.md` | Authority for decision — no change required |
| `docs/adr/0002-workflow-step-subagents.md` | Already superseded; leave banner |
| `docs/adr/0001-sqlite-for-pie-application-state.md` | Soft-update wording: catalog is Task + Agent (+ templates), Session refs hang off Agents |
| `docs/local-persistence.md` | Rewrite Task↔Session 1:1 and Child Task sections |
| `docs/specs/sqlite-local-persistence-v1.md` | Mark superseded/partially replaced by this spec for catalog tables; preferences/startup still partly apply |
| `docs/specs/sidebar-workflow-step-sessions-v1.md` | Mark stale on step1=root / `taskId`; replace binding with `agentId` + Active Agent (or fold into this spec and archive) |

### Rejected alternatives (do not reopen)

- Rename Task → Agent only  
- Task remains 1:1 Session / merged step1  
- Templates later / code-only forever  
- Agent-centric sidebar  
- Heavy migration of old tasks table  

### Glossary reminder

Use **Task, Active Task, Agent, Active Agent, Agent Template, Agent Tree, Subagent, PI Session, Session Availability, Agent Status, Task Status, Archive** per `CONTEXT.md`. Avoid Child Task, Task Tree (for generation), and “Task session.”
