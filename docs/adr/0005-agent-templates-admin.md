---
status: accepted
---

# Agent Templates admin: user library, editable system rows, insert-only seed

## Context

ADR-0003 introduced persisted **Agent Templates** and snapshot isolation when instantiating **Agents**. ADR-0004 made instance Role Prompt editable but kept **no user Template CRUD** in its first slice. System rows are seeded for playbook steps (`tpl:…` ids) via boot upsert, which **overwrites** existing system rows and prevents durable local customization of factory definitions.

Users now need a real **template library** (browse / create / edit / duplicate / delete user rows; edit + factory-reset system rows) without turning Templates into a Task launchpad and without cascading edits into existing Agent snapshots.

## Decision

1. **Ship a Templates admin surface** (Rail → main view, mutually exclusive with the agent workspace). Purpose: **library CRUD**, not create-task / playbook authoring / publish-back.
2. **Widen `AgentTemplate.source` to `'system' | 'user'`.** `source` is **provenance**, not a permission bit: both are editable in the admin UI.
3. **System templates:** stable `tpl:…` ids; **never deletable**; **per-row factory reset** restores `name`, Role Prompt (`systemPrompt`), and `skillPolicy` from current code seeds and clears `description`.
4. **User templates:** UUID ids; full create / update / delete / duplicate. Duplicate always creates a **user** row (including when forking a system template).
5. **`description`:** optional library-only blurb on the template row; **not** snapshotted onto Agents and **not** sent to the model via template flows.
6. **Boot seed is insert-only:** insert missing system ids from `SYSTEM_TEMPLATE_SEEDS`; **never** `ON CONFLICT DO UPDATE` overwrite existing rows (including edited system templates). Factory text changes in code apply to new installs, newly inserted ids, and explicit reset—not silently on every boot.
7. **Snapshot isolation unchanged (ADR-0003):** template edits do not mutate existing Agents. Delete user template → `Agent.templateId` SET NULL; instance Role Prompt / skill policy retained. Later create-from-template and explicit restore-from-template read the **current** template row.
8. **Explicit deviation from earlier first-slice limits:** ADR-0003 / ADR-0004 / split+role-prompt specs’ “system seed only / no user template editor” no longer constrain product work once this ADR is accepted. Playbook hard-coded system template ids and non-cascade rules remain.

## Considered options

- **Keep instance-only Role Prompt editing:** rejected — does not maintain reusable definitions or durable system customizations under upsert seed.
- **Upsert seed forever + immutable system rows:** rejected — blocks local factory tuning and makes seed text deploys forcibly clobber user edits.
- **Templates as launchpad (create Task/Agent primary):** deferred — separate product surface; this ADR is library admin only.
- **Cascading template → all Agents:** rejected — breaks ADR-0003 snapshot isolation.

## Consequences

- Catalog migration adds `description` and widens `source` CHECK; preload/main gain `pi:templates` write APIs beyond `list`.
- `seedSystemTemplates` implementation must change from upsert to insert-only; reset-factory becomes the intentional path to re-apply code seeds.
- Playbook steps keep referencing system ids; editing those rows affects **subsequent** ensures/restores only.
- Docs that still say “no user template editor” should point here + `docs/specs/agent-templates-admin-v1.md`.
