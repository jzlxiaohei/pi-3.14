---
status: accepted
---

# Agent Templates admin v1

Executable specification for template-library CRUD and the Templates management page. Aligns with [`CONTEXT.md`](../../CONTEXT.md), [ADR-0003](../adr/0003-task-agent-template-split.md), [ADR-0004](../adr/0004-agent-role-prompt-replaces-pi-base.md), and **[ADR-0005](../adr/0005-agent-templates-admin.md)** (this slice’s decision authority).

Extends [task-agent-template-split-v1](./task-agent-template-split-v1.md) and [agent-role-prompt-v1](./agent-role-prompt-v1.md). **Explicit deviation:** those docs’ first-slice “no user template editor / system seed only” limits are lifted here per ADR-0005. Snapshot isolation, playbook hard-coded system template ids, and “edits do not cascade to existing Agents” remain.

Unreleased product: **additive** catalog change is OK. **Do not delete PI Session JSONL.**

## Problem Statement

Agent Templates already exist as seeded system rows and are snapshotted into Agents, but users cannot browse or maintain the library:

- There is no Templates entry in product nav; Rail only toggles the Task list.
- IPC only exposes `pi:templates:list`.
- `source` is locked to `'system'`; there is no user-authored template path.
- Boot seed **upserts** system rows and silently overwrites user edits to system templates.
- Instance Role Prompt editing (ADR-0004) is not a substitute for editing the reusable definition used by **later** create-from-template / restore-from-template.

Users need a dedicated **template library admin** (not a launchpad): list, search, create, edit, duplicate, delete user templates, and reset system templates to factory seeds—without cascading into existing Agents or deleting sessions.

## Solution

Add a **Templates** primary surface:

| Layer | Behavior |
|---|---|
| **Rail** | Tasks \| Templates. Templates **replaces the main workspace** (mutually exclusive with chat workspace). Entering Templates **collapses the Task sidebar**. Tasks returns to the workspace. |
| **Page IA** | Left list (System / User groups + badges + search) + right detail editor. |
| **Catalog** | Widen `source` to `system \| user`; add UI-only `description`; full CRUD IPC; **insert-only** system seed; system rows editable + resettable, never deletable; user rows creatable / editable / deletable / duplicatable. |
| **References** | Delete user template → `Agent.templateId` SET NULL; instance snapshots kept. Template edits never cascade to existing Agents. |

## User Stories

1. As a PIE user, I want a Templates item on the leftmost Rail, so that I can open the template library without hunting settings.
2. As a PIE user, I want Templates to replace the main work area (not nest inside the Task sidebar), so that library management feels like its own place.
3. As a PIE user, I want the Task sidebar to collapse when I enter Templates, so that list chrome does not compete with the library.
4. As a PIE user, I want clicking Tasks on the Rail to return me to the agent workspace, so that I can resume chat work.
5. As a PIE user, I want a left list of all Agent Templates, so that I can scan the library.
6. As a PIE user, I want System and User templates grouped with clear badges, so that I know origin without treating source as a permission bit.
7. As a PIE user, I want to search templates by name (and description), so that I can find a definition quickly.
8. As a PIE user, I want selecting a list row to show its detail on the right, so that I can inspect and edit one template at a time.
9. As a PIE user, I want to edit a system template’s name, description, Role Prompt, and ignored skills, so that factory defaults can be tuned locally.
10. As a PIE user, I want system templates to be non-deletable, so that playbook hard-coded ids cannot disappear.
11. As a PIE user, I want to restore one system template to factory seed (name, Role Prompt, skillPolicy; description cleared), so that I can undo local system edits without wiping the whole library.
12. As a PIE user, I want a confirmation before factory reset, so that I do not wipe local system edits by accident.
13. As a PIE user, I want to create a new user template, so that I can capture reusable roles beyond playbook seeds.
14. As a PIE user, I want to edit a user template’s fields the same way as system ones, so that source is not a second editor mode.
15. As a PIE user, I want to delete a user template, so that obsolete definitions leave the library.
16. As a PIE user, I want deleting a user template to keep existing Agents’ snapshotted Role Prompt / skills, so that past runs are not rewritten.
17. As a PIE user, I want deleted user templates to clear `templateId` on referencing Agents, so that restore-from-template no longer pretends the row exists.
18. As a PIE user, I want to duplicate any template into a new user template, so that I can fork system or user definitions quickly.
19. As a PIE user, I want duplicate default names like `{name} 的副本`, so that the new row is obviously a copy.
20. As a PIE user, I want an explicit Save (button + ⌘S) for template edits, so that partial keystrokes are not silently persisted.
21. As a PIE user, I want a discard confirmation when leaving a dirty editor (switch row / leave page), so that I do not lose work silently or discard by accident.
22. As a PIE user, I want `description` on templates for library browsing only, so that I can annotate intent without sending that text into the model.
23. As a PIE user, I want Role Prompt on a template to be optional/empty, so that empty still means “PI default coding base” at instantiate time (same semantics as Agent).
24. As a PIE user, I want template skill ignore UI to match the Agent skills ignore pattern, so that I already know how to denylist skills.
25. As a PIE user, I want boot to add any missing system template ids without overwriting my edited system rows, so that upgrades extend the library without clobbering customization.
26. As a PIE user, I want changing a template not to rewrite Agents already created from it, so that instance snapshot isolation holds.
27. As a PIE user, I want later create-from-template and restore-from-template to read the **current** template row, so that library edits matter for new work and explicit restore only.
28. As a PIE user, I want UI copy primarily in Chinese consistent with nearby app chrome, so that the page matches the rest of the desktop shell.
29. As an implementer, I want `pi:templates:*` write APIs beside list, so that renderer never touches SQLite.
30. As an implementer, I want user template ids to be UUIDs and system ids to stay `tpl:…`, so that playbook maps keep working.
31. As an implementer, I want delete/reset/source guards enforced in main, so that the UI cannot smuggle illegal mutations.
32. As an implementer, I want package boundaries preserved (renderer → preload → main), so that persistence stays main-only.
33. As an implementer, I want typecheck-clean shared contracts after `description` + widened `source`, so that IPC stays honest.
34. As an implementer, I want no Session JSONL deletion from any template operation, so that transcripts stay safe.

## Implementation Decisions

### Domain invariants

1. **Agent Template** fields in this slice: `id`, `name`, `description`, `systemPrompt` (Role Prompt), `skillPolicy`, `source`, `createdAt`, `updatedAt`.
2. **`description` is UI metadata only.** Never copied into Agent snapshot, never sent as Role Prompt / product append / model context by template flows.
3. **`source` is provenance, not ACL.** Both `system` and `user` are fully editable in the admin UI. Differences: seed/reset eligibility, delete eligibility, id scheme.
4. **System templates:** `id` stable `tpl:…` from seeds; **never delete**; support **per-row factory reset**.
5. **User templates:** `id = UUID`; create / update / delete / duplicate allowed.
6. **Snapshot isolation (ADR-0003):** editing a template does **not** cascade to existing Agents. Only subsequent `create-from-template` and explicit `restore-role-prompt` (and any future restore that reads the template) observe new values.
7. **Delete user template:** rely on FK `agents.template_id → agent_templates(id) ON DELETE SET NULL` (already present). Agent `systemPrompt` / `skillPolicy` rows unchanged.
8. **Playbook** continues to hard-code system template ids. Editing system template body affects Agents **ensured after** the edit; it does not rewrite playbook structure.
9. **Seed policy (ADR-0005):** on every successful open/migrate, **insert missing system ids only**. Never `ON CONFLICT DO UPDATE` for seeds. Factory bodies live in `SYSTEM_TEMPLATE_SEEDS` for insert + reset only.
10. **Renderer** never opens SQLite or imports PI runtime for this feature. Main owns DB writes.
11. **No PI Session JSONL** create/delete/move from template APIs.

### Schema (additive)

Bump catalog schema version **3 → 4** (additive migration; do not wipe DB solely for this feature).

`agent_templates` delta:

| Column | Change |
|---|---|
| `description` | `TEXT NOT NULL DEFAULT ''` |
| `source` | CHECK widened to `IN ('system', 'user')` |

SQLite note: rebuilding CHECK may require table rebuild (create new → copy → drop → rename) inside migration v4; preserve all existing rows; set `description = ''` for existing system rows. Do **not** rename/move JSONL. Do **not** drop `agents` / `tasks`.

`CURRENT_VERSION = 4` after migration. Existing openPieStore “version ≠ CURRENT → backup & fresh” behavior remains for unsupported/newer mismatches; v3 → v4 must be an in-place migration path so user data is not wiped on upgrade.

### Seed behavior

Replace `seedSystemTemplates` upsert with insert-only:

```text
for seed in SYSTEM_TEMPLATE_SEEDS:
  if row id missing:
    INSERT id, name, system_prompt, skill_policy_json,
           description='', source='system', created_at, updated_at
  else:
    no-op  // keep user-edited system row as-is
```

- Still runs after migrations on boot (idempotent).
- New product seeds (new ids) appear on next boot without clobbering old ids.
- Changing seed **text** in code does **not** auto-push to existing DB rows; users use **Reset factory** per row (or delete DB in dev).

### Factory reset (system only)

`resetFactory(id)`:

1. Reject if missing or `source !== 'system'`.
2. Look up `SYSTEM_TEMPLATE_SEEDS` by id; fail if seed removed from code.
3. Set: `name`, `system_prompt`, `skill_policy_json` from seed; `description = ''`; bump `updated_at`.
4. Do **not** change `id`, `source`, `created_at`.
5. Return updated `AgentTemplate`.

### Contracts (shared)

```ts
type AgentTemplateSource = "system" | "user";

type AgentTemplate = {
  id: string;
  name: string;
  /** Library-only blurb; not part of Agent snapshot / model prompt. */
  description: string;
  systemPrompt: string; // Role Prompt
  skillPolicy: SkillPolicy;
  source: AgentTemplateSource;
  createdAt: number;
  updatedAt: number;
};

type AgentTemplateCreateRequest = {
  name: string;
  description?: string;
  systemPrompt?: string;
  skillPolicy?: SkillPolicy;
};

type AgentTemplateUpdateRequest = {
  id: string;
  name?: string;
  description?: string;
  systemPrompt?: string;
  skillPolicy?: SkillPolicy;
};

type AgentTemplateDeleteResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

type AgentTemplateResetResult =
  | { ok: true; template: AgentTemplate }
  | { ok: false; error: string };
```

Validation (main):

| Field | Rule |
|---|---|
| `name` | Required on create; on update if present must be non-empty after trim. Store trimmed. |
| `description` | Optional; default `''`; store string (trim implementer choice; empty OK). |
| `systemPrompt` | Optional; default `''`. Empty = PI default base at instantiate (same as Agent). Prefer same normalize helper family as Agent Role Prompt save if applicable. |
| `skillPolicy` | Default `{ ignoredSkillNames: [] }`; names unique/trimmed like Agent path. |

### IPC / preload

Extend `window.piDesktop.templates`:

| Channel | Preload | Behavior |
|---|---|---|
| `pi:templates:list` | `templates.list()` | All templates. Sort: `source` system-first, then `name` ascending (case-insensitive), then `id`. |
| `pi:templates:create` | `templates.create(req)` | Insert user row; `id = randomUUID()`; `source = 'user'`; return row. |
| `pi:templates:update` | `templates.update(req)` | Update allowed fields for **either** source; reject unknown id; return row. **Must not** change `source` or `id`. |
| `pi:templates:delete` | `templates.delete(id)` | **User only**; system → error; FK clears Agent.templateId; return ok. |
| `pi:templates:duplicate` | `templates.duplicate(id)` | Load source row; insert new **user** UUID row; `name = `${name} 的副本``; copy description, systemPrompt, skillPolicy; return row. |
| `pi:templates:reset-factory` | `templates.resetFactory(id)` | System only; see above. |

Main handlers thin-wrap PieStore (same style as `pi:templates:list` today).

Errors: return result objects or throw consistent with nearby agent APIs; UI shows toast on failure. Illegal source operations must fail closed in main even if UI hides the action.

### PieStore API (main)

Add alongside `listTemplates` / `getTemplate`:

- `createTemplate(req): AgentTemplate`
- `updateTemplate(req): AgentTemplate | null`
- `deleteTemplate(id): AgentTemplateDeleteResult`
- `duplicateTemplate(id): AgentTemplate | null`
- `resetTemplateFactory(id): AgentTemplateResetResult`

`toTemplate` must map `description` + real `source` (stop hardcoding `"system"`).

### Navigation / shell

Shell primary view state machine (conceptual):

```text
mainView: "workspace" | "templates"

Rail Tasks:
  → mainView = workspace
  → Task sidebar uses existing tasksOpen preference behavior

Rail Templates:
  → if templates editor dirty → confirm discard → abort or continue
  → mainView = templates
  → force Task sidebar collapsed for this view (do not require persisting tasksOpen=false unless convenient; leaving Templates may restore prior tasksOpen)

Workspace chat UI and Templates page are mutually exclusive in the main content region.
Rail remains visible in both views.
```

- Templates is **not** a Task-sidebar mode and **not** a route that keeps chat mounted as the primary surface.
- Implement as app/shell state (acceptable: top-level signal beside existing workspace model). Full URL router optional; not required if app is still single-workspace shell.

### Templates page UI

**Layout:** list-detail, Orbit tokens via `shared/ui`.

**Left list**

- Sections: **系统** (`source === 'system'`) then **用户** (`source === 'user'`).
- Row: name (primary), optional description snippet, source badge（系统 / 用户）.
- Search box: filter by case-insensitive substring on `name` **or** `description`; filter applies within groups; empty group may hide or show empty state.
- Actions: **新建** (user template); optional row menu with 复制 / 删除(user) / 恢复出厂(system).
- Default selection: first visible system row, or first visible row after search; after create/duplicate select the new id.
- Sort within group: name ascending, `id` tiebreak (match list API).

**Right detail**

Fields:

| UI label | Field | Notes |
|---|---|---|
| 名称 | `name` | Required |
| 描述 | `description` | Optional; helper: 仅用于模板库展示，不会进入模型 |
| Role Prompt | `systemPrompt` | Textarea; empty semantics aligned with Agent Role Prompt (default PI base at instantiate) |
| 技能忽略 | `skillPolicy.ignoredSkillNames` | Same interaction pattern as Agent skills ignore (`task-skills-dialog` family); persists only on Save with other fields |

Chrome:

- Badge for source; system: show **恢复出厂** (confirm dialog); user: show **删除** (confirm dialog).
- **复制** always available when a row is selected.
- **保存** enabled when dirty; **⌘S / Ctrl+S** triggers save while detail focused / page active.
- Dirty = local draft ≠ last loaded/saved server snapshot for the selected id.
- Switch selection or leave `mainView` while dirty → confirm **丢弃未保存的更改？** (丢弃 / 取消). No auto-save.
- After successful save: clear dirty; toast short success（已保存模板）.
- Reset factory / delete / duplicate: if dirty on current row, confirm discard first or block with same discard dialog.

**New user template defaults**

- `name`: `未命名模板` (or prompt inline—default name is fine)
- `description`: `''`
- `systemPrompt`: `''`
- `skillPolicy`: `{ ignoredSkillNames: [] }`
- Select new row after create; user edits + Save (create may insert immediately with defaults, then update on Save—**prefer** create-on-click with defaults so the row has a stable id; empty name rejected on create/update).

**Duplicate name:** `` `${original.name} 的副本` ``.

**Delete confirm copy (normative intent):** 删除后不可恢复；已从该模板创建的 Agent 会保留快照，但不再关联此模板。

**Reset confirm copy (normative intent):** 将名称、Role Prompt、技能策略恢复为产品出厂种子，并清空描述；已有 Agent 快照不受影响。

### Interaction with Agent restore / create

- `agents.restoreRolePrompt` continues to load **current** template by `agent.templateId` (Role Prompt only, existing behavior). If template was deleted, keep failing with clear error (templateId null after delete ⇒ already unrestorable).
- `create-from-template` snapshots `name` (as agent name default), `systemPrompt`, `skillPolicy` from current row. **Do not** snapshot `description` onto Agent (Agent has no description field).
- No publish-back, no create-task-from-template in this slice.

### Modules / seams

| Seam | Kind | Responsibility |
|---|---|---|
| **Template catalog facade** (PieStore + `pi:templates:*` + preload) | **Primary product** | list/create/update/delete/duplicate/resetFactory; source guards; FK delete behavior |
| **Insert-only system seed** | Data | Missing-id insert only; factory bodies from `SYSTEM_TEMPLATE_SEEDS` |
| **Schema / contracts** | Additive | `description`; `source: system \| user`; request/result types |
| **Templates admin page** | Renderer page state | list-detail; search; dirty/save/⌘S; confirms; CRUD actions |
| **Shell nav state** | Thin UI | Rail Tasks ↔ Templates; collapse Task sidebar on Templates |

Do not add a second persistence stack. Do not put admin UI inside Task sidebar list.

### File-level plan (implementer guide)

Indicative paths (adjust if structure shifts):

| Area | Paths |
|---|---|
| Contracts | `apps/desktop/src/shared/desktop-contracts.ts` |
| Seeds | `apps/desktop/src/shared/playbook-templates.ts` (unchanged ids; seeds remain factory source) |
| Migration + seed | `apps/desktop/src/main/persistence/migrations.ts` |
| Store | `apps/desktop/src/main/persistence/pie-store.ts` |
| IPC register | `apps/desktop/src/main/index.ts` (or templates router if split) |
| Preload | `apps/desktop/src/preload/index.ts` |
| Shell / Rail | `…/agent-workspace/ui/rail.tsx`, `app-shell.tsx` / page route owner |
| New page | `apps/desktop/src/renderer/src/pages/agent-templates/` (model + ui list/detail) |
| Styles | page CSS using Orbit semantic tokens |
| ADR / glossary | `docs/adr/0005-…`, light notes on 0003/0004 / old specs |

### Package boundaries

Unchanged: renderer → preload → main; SQLite main-only; no raw PI SDK in renderer; `@pi-3.14/*` untouched for this slice.

## Testing Decisions

Per `AGENTS.md`: **no new UI test suite by default**. Prefer typecheck + manual verification.

**Good automated tests only if added** (stable pure / silent-break risk):

| Behavior | Notes |
|---|---|
| Insert-only seed | Second boot does not overwrite edited system name/prompt; missing id inserted |
| Delete user | `template_id` null on agents; system delete rejected |
| Reset factory | Restores seed fields; rejects user id |
| Duplicate | New uuid, `source=user`, copied prompt/policy |

Do not assert Orbit layout or exact Chinese copy in unit tests.

**Manual acceptance** is the release gate (below).

## Acceptance Criteria

1. **Rail:** Templates entry visible; activates Templates main view; Tasks returns to workspace.
2. **Sidebar:** Entering Templates collapses Task sidebar; workspace chat is not the primary surface while Templates is active.
3. **List-detail:** Templates show in 系统 / 用户 groups with badges; search filters by name/description; selection loads detail.
4. **Edit + Save:** Change fields → Save / ⌘S persists; reload/list refresh shows new values; dirty cleared.
5. **Dirty guard:** Dirty + switch row or leave Templates → confirm; cancel keeps editor; confirm discards local draft.
6. **System edit:** System template content editable; no delete action success path; main rejects delete.
7. **System reset:** Reset restores name + Role Prompt + skillPolicy from current code seed; description `''`; existing Agents unchanged.
8. **User CRUD:** Create / edit / delete user templates works; delete confirms; Agents keep snapshot; `templateId` cleared.
9. **Duplicate:** Any template → new user row named `{name} 的副本` with copied prompt/policy/description.
10. **Seed insert-only:** Edited system row survives app restart; new seed ids (if added in code) appear without resetting old rows.
11. **No cascade:** Edit template → already-created Agent Role Prompt unchanged until explicit restore-from-template.
12. **Description isolation:** Description never appears in Agent bind Role Prompt / live system prompt assembly.
13. **Playbook:** Existing playbook steps still resolve hard-coded `tpl:…` ids; ensure-after-edit uses updated system template body.
14. **Typecheck:** Desktop contracts/main/preload/renderer typecheck pass.
15. **JSONL safety:** No Session files deleted by migration or template APIs.
16. **Non-goals held:** No create-task-from-template, playbook binding UI, publish-back, import/export, cloud sync, usage stats, version history, in-page try-run.

## Out of Scope

- Creating Task/Agent from the Templates page (launchpad)
- Playbook step ↔ template binding UI / custom playbooks
- Agent → template publish-back / save-as-template
- Import/export, cloud sync, team sharing
- Usage stats, version history, in-admin try-run / mini chat
- Default model / tools and other “later defaults” on templates
- Cascading template edits into existing Agent snapshots
- Deleting or rewriting PI Session JSONL
- Changing `@pi-3.14/*` public APIs
- Multi-user permissions / `source` as ACL

## Further Notes

### Relationship to prior specs / ADRs

| Doc | Role after this slice |
|---|---|
| ADR-0003 | Still authority for Task/Agent/Template split + snapshot isolation |
| ADR-0004 | Still authority for Role Prompt replace/fallback; instance editor remains; library admin is additional |
| **ADR-0005** | Authority for user templates, editable system templates, insert-only seed, admin UI |
| task-agent-template-split-v1 | First-slice “system seed only / no user template editor” **superseded** by this spec + ADR-0005 |
| agent-role-prompt-v1 | Out-of-scope “User Template CRUD” **superseded** for admin CRUD; publish-back still out |

### Implementer defaults (non-blocking)

- List sort: system group first, then name case-insensitive
- Duplicate suffix: `的副本`
- Create default name: `未命名模板`
- Confirm dialogs: reuse existing `Dialog` / confirm-dialog patterns (`delete-task-dialog` family)
- ⌘S: match platform (`Meta+S` macOS, `Ctrl+S` elsewhere), preventDefault when Templates view handles it

### Rejected alternatives (do not reopen)

- Templates as Task-sidebar list mode
- Launchpad / create-agent as primary Templates purpose in v1
- Seed upsert that overwrites system rows every boot
- `source` as read-only ACL (system immutable)
- Cascading template edits to all Agents
- Publish-back in the same slice
- description stored on Agent or injected into Role Prompt

### Glossary reminder

Use **Agent Template**, **Role Prompt**, **Agent**, **Task**, **PI Session** per `CONTEXT.md`. Do not call a playbook a template. Do not call this page a skill manager.
