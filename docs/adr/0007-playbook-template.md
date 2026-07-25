---
status: accepted
---

# Playbook Template as a first-class catalog entity

## Context

Agent Template (ADR-0003/0005) is the reusable **role definition** (Role Prompt + skill policy suggestions). Playbooks today are code maps (`PLAYBOOK_CATALOG`) that hard-wire step order and which Agent Template each step uses. Users need a UI to change “how many steps / which agent template per step.” Putting that editor on the live Task workflow card confuses **instance progress** with **path definition**, and forces awkward per-Task rebind UX.

Skill policy on Agent Template is a **suggestion / default ignore list** for new Agents, not a forced skill mount. Suggested usage (e.g. starter `/grill-with-docs`) belongs on the playbook step or template blurb, not as locked skill injection.

## Decision

1. Introduce **Playbook Template** (name TBD in UI: 「路径模板」/ Playbooks) as a persisted catalog entity, parallel to Agent Template:
   - `id`, `name`, `description`, `source: system | user`
   - `steps: { id, label, blurb?, agentTemplateId, starterPrompt? }[]`
2. **Task.workflow** remains **instance progress** only: cursor, step status, `agentId`. Optionally stamp `agentTemplateId` at ensure for audit; structure comes from the Playbook Template at Task create (snapshot of step list).
3. **Agent** remains: editable Role Prompt snapshot + skill policy snapshot + Session. UI: show “来自 Agent Template X”, allow edit Role Prompt; do not reconfigure the whole playbook from the chat card.
4. **Config UI** is a Playbook Template admin (or Templates rail sibling), not the workflow progress card.
5. System playbooks seed insert-only from code; user playbooks are full CRUD. Step → Agent Template is edited only on the Playbook Template.

## Consequences

- `TaskPlaybookId` union becomes open `string` (or keep system ids + UUID user ids).
- New Task “choose path” lists Playbook Templates from catalog, not only three hardcoded enums.
- Workflow step card simplifies to progress + provenance.
- Phase after this ADR: schema + IPC + admin page; migrate `PLAYBOOK_CATALOG` into seeds.
