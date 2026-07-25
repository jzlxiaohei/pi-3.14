---
status: accepted
---

# Agent Role Prompt (replace PI base) v1

Executable specification for [ADR-0004](../adr/0004-agent-role-prompt-replaces-pi-base.md), aligned with [`CONTEXT.md`](../../CONTEXT.md) and extending [task-agent-template-split-v1](./task-agent-template-split-v1.md).

Unreleased product: additive catalog change is OK. Do **not** delete PI Session JSONL. Do **not** reopen append-only vs dual-mode debates — replace + empty-fallback is fixed.

## Problem Statement

Playbook steps are separate Agents with different jobs (grilling vs implement vs review). PIE still binds each Agent by **appending** `Agent.systemPrompt` after PI’s default coding-assistant system base (“You are an expert coding assistant…”). Non-coding roles keep a coding identity, and users cannot reliably own the **role base** per Agent instance.

Users need to:

- See and edit each Active Agent’s Role Prompt
- Confirm the role on first run without being blocked from chatting
- Restore the Template snapshot default
- Understand Role Prompt vs the live full system prompt (product appends, project context, skills, cwd)

## Solution

Treat `Agent.systemPrompt` as the **Role Prompt (role base)**:

| Condition | Bind behavior |
|---|---|
| Role Prompt **non-empty** (trim) | **Replace** PI’s default coding system base |
| Role Prompt **empty** | **Fall back** to PI’s default coding base |
| Always | Attach ordered **product appends** (v1: questionnaire only), then PI project_context + skills + cwd |

Users edit the role base in **Inspector → Context**, with a new-Agent **confirmation banner**. Save / restore-default / confirm / first send mark the Agent confirmed. Rebind is quiet (same family as skill ignore) and applies to **subsequent** turns only; if a turn is running, **wait for it to finish** (do not abort solely to rebind Role Prompt).

System Template seeds are rewritten as **minimal full role bases** (identity, goals, non-goals, style), not short appends that assume the PI coding opener.

## User Stories

1. As a PIE user, I want each playbook step Agent to run with a role identity suited to that step, so that grilling does not behave like a generic coding assistant bolted onto a blurb.
2. As a PIE user, I want an empty Role Prompt to keep today’s PI default coding base, so that ad-hoc Agents stay familiar.
3. As a PIE user, I want the UI to show that empty means “default” (not a mysterious blank brain), so that I know what the model is working from.
4. As a PIE user, I want to edit the Active Agent’s Role Prompt in Inspector → Context, so that I can tune one step without hunting settings.
5. As a PIE user, I want Role Prompt editing clearly separated from the live full system prompt, so that I do not paste questionnaire/protocol text into the role by accident.
6. As a PIE user, I want to save a Role Prompt and have later turns use it without a scary full session reset UX, so that tweaks feel safe.
7. As a PIE user, I want to restore the Template’s Role Prompt on a templated Agent, so that I can undo instance edits.
8. As a PIE user, I want restore-default disabled or explained when the Agent has no Template, so that ad-hoc Agents are not offered a fake reset.
9. As a PIE user, I want a banner when an Agent’s Role Prompt is not yet confirmed, so that multi-step playbooks prompt me to glance at the role.
10. As a PIE user, I want the banner to not block sending, so that I can keep moving if I already know the role.
11. As a PIE user, I want clicking confirm on the banner to dismiss it and remember confirmation on that Agent, so that I am not nagged again.
12. As a PIE user, I want my first message on an unconfirmed Agent to count as confirmation, so that normal chat clears the banner.
13. As a PIE user, I want saving the Role Prompt to count as confirmation, so that deliberate edits settle the guidance state.
14. As a PIE user, I want restoring the Template default to count as confirmation, so that reset is a complete action.
15. As a PIE user, I want confirmation remembered per Agent instance, so that step 2 does not inherit step 1’s “I already looked” state incorrectly and each new step can guide me again.
16. As a PIE user, I want changing Role Prompt while a turn is running to apply after the turn ends, so that the in-flight reply is not aborted just for a prompt edit.
17. As a PIE user, I want Role Prompt changes not to rewrite chat history, so that prior turns stay as they were.
18. As a PIE user, I want live Context preview to still show the assembled system prompt, skills, and composition, so that power users can verify what will be sent next.
19. As a PIE user, I want product rules (questionnaire protocol) to keep working without putting that text in my Role Prompt editor, so that roles stay readable.
20. As a PIE user, I want instance Role Prompt edits not to change the shared Agent Template, so that other Tasks keep stock seeds (ADR-0003 snapshot isolation).
21. As an implementer, I want a single bind assembly helper for replace/fallback + product appends, so that activate/create/rebind cannot drift.
22. As an implementer, I want host create options to take a role base (not “append agent blurb after default”), so that the transport matches ADR-0004.
23. As an implementer, I want `rolePromptConfirmedAt` on Agent rows, so that banner state survives restart.
24. As an implementer, I want system seeds upserted as full role bases on boot, so that new playbook Agents snapshot the replace-era text.
25. As an implementer, I want existing Agent facade / quiet rebind paths reused, so that skill ignore and Role Prompt share one rebind family.
26. As an implementer, I want package boundaries preserved (renderer → preload → main → utility host; `@pi-3.14/*` only), so that the PI SDK stays off the renderer.
27. As an implementer, I want typecheck-clean desktop contracts after the field and host option changes, so that IPC stays honest.

## Implementation Decisions

### Domain invariants

1. **Role Prompt** = `Agent.systemPrompt` / `AgentTemplate.systemPrompt` string. Glossary name is Role Prompt; column/field may stay `systemPrompt` / `system_prompt`.
2. **Non-empty (trim) Role Prompt → replace** PI default system base on host bind.
3. **Empty (trim) Role Prompt → fall back** to PI default system base.
4. **Product appends are not user-editable Role Prompt.** v1 append list = `[questionnaire system prompt]` only. No global thin-harness style layer.
5. **Assembly order (conceptual):**  
   `roleBase` (custom replace **or** PI default) + `productAppends` + PI `project_context` + skills (after `skillPolicy`) + cwd.  
   PI’s `buildSystemPrompt` already attaches context/skills/cwd when `customPrompt` is set; PIE must not duplicate those in the Role editor.
6. **Snapshot isolation (ADR-0003):** instance Role Prompt edits do not write through to `AgentTemplate`.
7. **Confirmation is per Agent**, stored as `rolePromptConfirmedAt: number | null`. `null` = unconfirmed. Confirmation does not alter Role Prompt text.
8. **Rebind affects subsequent turns only.** Do not rewrite JSONL history.
9. **Running turn + pending Role Prompt rebind:** wait until the turn is not busy, then quiet-rebind. Do **not** abort the turn solely to apply a Role Prompt change (stricter than current skill-toggle path, which may abort).
10. **Renderer** never imports `@pi-3.14/runtime` or opens SQLite.

### Resolved decisions

| Topic | Decision |
|---|---|
| Replace vs append | **Replace** when non-empty; empty falls back. No append\|replace UI flag. |
| Confirmation storage | `rolePromptConfirmedAt: number \| null` (unix ms). |
| Confirm actions | Banner confirm **or** first user send **or** save Role Prompt **or** restore Template default → set `rolePromptConfirmedAt = now`. |
| New Agent | `rolePromptConfirmedAt = null` (show banner when Active). |
| Template restore | Copies `template.systemPrompt` → Agent; sets confirmation; quiet rebind. Requires `templateId != null`. |
| Seed bodies | Minimal **full** role bases; boot upsert overwrites system template text (same as today’s seed upsert). |
| Schema | Additive **v3** migration (no catalog wipe required for this feature). |
| Primary seam | Agent facade bind/update on main. |
| Pure helper | `buildHostSystemPromptOptions({ rolePrompt, productAppends })` in desktop main (not `@pi-3.14/*` for v1). |
| Default text in UI | Empty editor value stays `""`; chrome shows 「默认」badge + short explanation; full effective text visible via live system prompt preview after bind. Do not hardcode PI’s entire default body (it drifts with tools/paths). |
| Style bullets (“be concise”) | Belong in each role/seed text when desired — not a second PIE product layer. |

### Schema (v3 additive)

`CURRENT_VERSION = 3`.

When migrating from v2 → v3:

```sql
ALTER TABLE agents ADD COLUMN role_prompt_confirmed_at INTEGER NULL;
```

Record version `3` in `schema_migrations`. No JSONL deletion. No forced DB rename/reset for this feature (unlike the v2 split reset path).

**Agent row mapping:**

| Column | Contract field |
|---|---|
| `system_prompt` | `systemPrompt` (Role Prompt) |
| `role_prompt_confirmed_at` | `rolePromptConfirmedAt: number \| null` |

**Create Agent** (template, ad-hoc, spawn): always insert `role_prompt_confirmed_at = NULL`.

**Existing rows after migrate:** remain `NULL` (unconfirmed). Acceptable for unreleased/dev DBs; banner may appear once per old Agent when opened.

### Public contracts (delta)

```ts
type Agent = {
  // ...existing fields...
  systemPrompt: string
  /** null = Role Prompt not yet confirmed for this instance. */
  rolePromptConfirmedAt: number | null
  // ...
}

type AgentUpdateRequest = {
  id: string
  name?: string
  systemPrompt?: string
  skillPolicy?: SkillPolicy
  inputContext?: string | null
  outputContext?: string | null
  /**
   * When true, set rolePromptConfirmedAt = now.
   * Used by: banner confirm, save Role Prompt, restore default.
   * First-send may call a dedicated confirm helper instead.
   */
  confirmRolePrompt?: boolean
  /** Explicit timestamp write; prefer confirmRolePrompt for normal UI. */
  rolePromptConfirmedAt?: number | null
}

type AgentRestoreRolePromptResult =
  | { ok: true; agent: Agent }
  | { ok: false; error: string } // e.g. no template
```

**Host create command** (utility process) — replace append-only agent blurb with role base:

```ts
// PiHostCommand create branch
{
  type: "create"
  cwd: string
  sessionPath?: string
  ignoredSkillNames?: string[]
  /**
   * Role Prompt base. Non-empty → systemPromptOverride replace.
   * Empty/omitted → PI default base.
   */
  rolePrompt?: string
}
```

Remove reliance on `appendSystemPrompts` for Agent role text. Product appends (questionnaire) stay **host-owned** inside the utility process (same as today injecting `QUESTIONNAIRE_SYSTEM_PROMPT`), not passed from renderer.

If `PiSessionCreateOptions.appendSystemPrompts` still exists for legacy renderer create paths, route it through the same assembly helper or delete once Agent-only bind is the only path (prefer delete/dead-code after facade owns all binds).

### Pure assembly helper

```ts
type HostSystemPromptLoaderOptions = {
  /** When set, PI uses this as customPrompt (replaces default base). */
  systemPromptOverride?: (base: string | undefined) => string | undefined
  /** Product + optional loader appends; v1 caller passes questionnaire only. */
  appendSystemPrompt: string[]
}

function buildHostSystemPromptOptions(input: {
  rolePrompt: string
  productAppends: readonly string[]
}): HostSystemPromptLoaderOptions {
  const role = input.rolePrompt.trim()
  const appendSystemPrompt = input.productAppends.map((s) => s.trim()).filter(Boolean)
  if (role.length > 0) {
    return {
      systemPromptOverride: () => role,
      appendSystemPrompt,
    }
  }
  return { appendSystemPrompt }
}
```

Host `create` wiring (conceptual):

```ts
const assembled = buildHostSystemPromptOptions({
  rolePrompt: command.rolePrompt ?? "",
  productAppends: [QUESTIONNAIRE_SYSTEM_PROMPT],
})
host = await createEmbeddedPiHost({
  cwd: command.cwd,
  sessionPath: command.sessionPath,
  toolApproval: sessionAutoApprove,
  services: {
    resourceLoaderOptions: {
      ...assembled,
      ...(ignored.size > 0 ? { skillsOverride: ... } : {}),
    },
  },
})
```

**PI behavior note (do not fight it):** with replace, PI `buildSystemPrompt({ customPrompt })` still appends append-section, `<project_context>`, skills list, and cwd. It does **not** keep the default tools/guidelines/docs block from the coding base — seeds and custom roles must be self-contained identities.

### Agent facade responsibilities (delta)

| Op | Behavior |
|---|---|
| `activateAgent` / all bind sites | Pass `rolePrompt: agent.systemPrompt` into host create (via `bindHost`). Stop passing role as `appendSystemPrompts`. |
| `updateAgent` | Persist Role Prompt / skills / contexts; if `confirmRolePrompt` or explicit confirm timestamp, set `rolePromptConfirmedAt`. |
| `confirmAgentRolePrompt(agentId)` | Set `rolePromptConfirmedAt = now` only. |
| `restoreAgentRolePromptFromTemplate(agentId)` | Load template by `agent.templateId`; fail if null/missing; set `systemPrompt = template.systemPrompt`, `rolePromptConfirmedAt = now`; return agent. Caller quiet-rebinds if Active. |
| create-from-template / ad-hoc / spawn | Snapshot prompts as today; `rolePromptConfirmedAt = null`. |
| first user `prompt` on Active Agent | If `rolePromptConfirmedAt == null`, set confirmation (best-effort) before/after sending — must not block send on confirm write failure. |

`bindHost` options become:

```ts
{
  cwd: string
  sessionPath: string | null
  rolePrompt: string
  ignoredSkillNames?: string[]
}
```

### Confirmation + rebind state machine (renderer)

```text
Active Agent bound
  rolePromptConfirmedAt == null → show Role Prompt banner
  else → hide banner

Banner.Confirm → agents.confirmRolePrompt(id) → hide banner
First composer send (unconfirmed) → confirmRolePrompt(id) side effect → hide banner
  (send is never blocked by banner)

Context editor:
  dirty local draft of Role Prompt
  Save → updateAgent({ systemPrompt, confirmRolePrompt: true })
        → scheduleRolePromptRebind()
  Restore default → restoreAgentRolePromptFromTemplate
        → scheduleRolePromptRebind()
  Cancel/revert → discard local draft

scheduleRolePromptRebind:
  if agent not active → no-op
  if session busy → set pendingRolePromptRebind = true; wait for idle
  else → rebindActiveTask({ quiet: true })  // do not abort for this path

on turn settles / isBusy becomes false:
  if pendingRolePromptRebind → quiet rebind; clear flag
```

**Busy policy:** Role Prompt rebind **waits**; it must not call `abort()` only to apply prompt changes. (Skill ignore may keep its existing abort-or-rebind behavior unless unified later.)

**Quiet rebind:** reuse existing activate(`force: true`) quiet path — preserve timeline, restore draft, no full blanking flash.

### Context UI (Inspector → Context)

Extend existing context preview; do not add a second editor surface.

1. **Role Prompt (editable)**  
   - Text area bound to Active Agent Role Prompt draft.  
   - Empty value: show 「默认」badge + helper text that PI’s default coding base is used until the user saves a custom role.  
   - Non-empty: show 「自定义」or no default badge.  
   - Actions: **Save**, **Restore Template default** (disabled with reason when `templateId == null`), discard-if-dirty as needed.

2. **Product appends (read-only)**  
   - v1 one row/section: “Questionnaire protocol (app-owned)” — short description, not a second full dump required if live prompt already includes it.

3. **Live system prompt (read-only)**  
   - Keep today’s live host `systemPrompt` collapsible.  
   - Caption: assembled after role base + product appends + project context + skills + cwd; host-local; not historical from JSONL.

4. Skills / composition / assembled JSON blocks remain as today (copy still says task where leftover — prefer “this Agent” when touching strings).

### Banner UX

- Placement: chat chrome near other banners (tool approval / fork / extract-skill family).
- Copy (normative intent, not final i18n): title like “确认本步角色”; body shows Agent name + first lines of effective role (custom text, or “默认 PI coding base”); actions: **确认** primary; optional “在 Context 中编辑” focus/open inspector Context tab.
- Visible only when Active Agent is bound and `rolePromptConfirmedAt == null`.
- Not a modal; does not disable composer.

### System template seeds

`SYSTEM_TEMPLATE_SEEDS[*].systemPrompt` uses **thin playbook boundaries** (not full skill bodies):

- **Thin non-empty Role** — step identity + in/out of scope only (e.g. grill / to-spec / diagnose / review). Methodology lives in Matt skills triggered by playbook starters (`/grill-with-docs`, `/to-spec`, …).
- **Empty Role** — full PI default coding base at bind. Used for coding-heavy steps (`implement`, `tdd`) where the step method is the skill, not a custom base.
- MUST NOT embed questionnaire protocol, paraphrase entire skill markdown, or assume PI’s default opener is present when Role is non-empty (non-empty **replaces** PI base).

Boot seed is **insert-only** (ADR-0005): missing system ids are inserted; existing rows are not overwritten. Use **Reset factory** (or a fresh catalog) to pick up seed text changes. **Already-created Agents keep their snapshotted text** until restore-from-template or user edit.

| Template id | Role strategy |
|---|---|
| `tpl:feature-default/grilling` | Thin: discovery step boundary |
| `tpl:feature-default/to-spec` | Thin: specification step boundary |
| `tpl:feature-default/implement` | Empty → PI default; `/implement` skill |
| `tpl:small-tdd/tdd` | Empty → PI default; `/tdd` skill |
| `tpl:small-tdd/code-review` | Thin: review findings boundary |
| `tpl:bugfix/diagnosing-bugs` | Thin: diagnosis step boundary |
| `tpl:bugfix/tdd` | Empty → PI default; `/tdd` skill |
| `tpl:bugfix/code-review` | Thin: fix-review residual risk boundary |

### IPC surface (delta)

| Channel | Change |
|---|---|
| `pi:agents:update` | Accept `confirmRolePrompt` / `rolePromptConfirmedAt`; return updated Agent including confirmation |
| `pi:agents:confirm-role-prompt` | Optional dedicated channel **or** update with confirm flag only — pick one; prefer dedicated small call for banner/first-send |
| `pi:agents:restore-role-prompt` | Restore from template + confirm |
| `pi:agents:activate` / bind | Uses role replace assembly (no API shape change required beyond Agent field) |
| Host create | `rolePrompt` instead of agent text in `appendSystemPrompts` |

### Modules / seams

| Seam | Kind | Responsibility |
|---|---|---|
| **Agent facade** (RuntimeManager + PieStore) | **Primary product** | Persist Role Prompt + confirmation; bind with role assembly; restore from template |
| **`buildHostSystemPromptOptions`** | Pure helper (desktop main) | replace vs fallback + append list |
| **Confirmation + pending rebind** | Renderer session/UI state | Banner visibility; defer quiet rebind until idle |
| **Context inspector** | UI | Edit role base; layered read-only live view |
| **System seeds** | Data | Full role bases upserted on boot |

Do not add a second persistence stack. Do not move assembly into `@pi-3.14/*` in v1.

### Package boundaries

Unchanged: desktop app uses `@pi-3.14/runtime` `createEmbeddedPiHost` + `resourceLoaderOptions` (`systemPromptOverride`, `appendSystemPrompt`, `skillsOverride`). No raw `@earendil-works/pi-coding-agent` in renderer.

## Testing Decisions

Per `AGENTS.md`: **no new UI/store test suite by default**. Prefer typecheck + manual verification.

**Good tests only if added:** pure `buildHostSystemPromptOptions` external behavior:

- empty role → no `systemPromptOverride`, appends = product list  
- non-empty role → override returns trimmed role, appends = product list  
- trims whitespace-only role to fallback  

Do not assert full PI `buildSystemPrompt` string bodies in desktop tests.

**Manual acceptance** gates release of this slice (below).

## Acceptance Criteria

1. **Replace bind:** Agent with non-empty Role Prompt → live system prompt **starts from that role text** (not preceded by PI “expert coding assistant” default base). Questionnaire still present in live prompt.
2. **Fallback bind:** Agent with empty Role Prompt → live system prompt uses PI default coding base + questionnaire + context/skills/cwd. Context editor shows 「默认」, not an unexplained empty brain.
3. **No role-in-append regression:** Role text is not merely appended after the full default base when non-empty.
4. **Product append seam:** Questionnaire protocol still works (model can emit envelope; UI still parses). Role editor does not contain questionnaire protocol body as user text.
5. **Edit + save:** Change Role Prompt → Save → Agent row updated; `rolePromptConfirmedAt` set; after quiet rebind, live prompt reflects new role; timeline/history retained.
6. **Restore default:** Templated Agent with dirty role → Restore → `systemPrompt` matches current template seed text; confirmed; rebind applies. Ad-hoc Agent (`templateId == null`) cannot fake-restore.
7. **Snapshot isolation:** Editing Agent Role Prompt does not change `agent_templates.system_prompt`.
8. **Banner new Agent:** Fresh step/ad-hoc Agent shows confirmation banner when active; confirm hides it and persists across reopening that Agent.
9. **Banner first send:** Unconfirmed Agent + user sends first message → banner clears; `rolePromptConfirmedAt` non-null after refresh/bootstrap.
10. **Banner non-blocking:** Composer send works while banner visible.
11. **Per-Agent confirmation:** Confirming step1 does not auto-confirm a newly created step2 Agent.
12. **Running turn wait:** Start a long turn → Save Role Prompt mid-turn → turn completes without abort-from-rebind → then host rebinds and **next** turn uses new role.
13. **Seeds:** New playbook Agents created after boot snapshot rewritten full role bases (identity/goals/non-goals/style), not the old append-only blurbs.
14. **Skills still work:** Ignored skills + quiet rebind still function; questionnaire still injected when skills change rebinds.
15. **Typecheck:** Desktop app contracts/main/renderer typecheck passes.
16. **JSONL safety:** No Session files deleted by migration or rebind.

## Out of Scope

- User Template CRUD / template gallery *(superseded for library CRUD by agent-templates-admin-v1 / ADR-0005; gallery launchpad still out)*
- Publish-back instance → template
- Custom playbook authoring UI
- Subagent spawn Role Prompt picker UI
- Protocol registry UI / multiple product-append plugins management
- append \| replace dual-mode flag per Agent
- Global PIE thin-harness style layer beside questionnaire
- Rewriting `@pi-3.14/*` public APIs for prompts
- Bulk rewrite of existing Agent instance prompts on upgrade
- Visual redesign of Inspector beyond Context Role editor + banner
- Analytics on role edits

## Further Notes

### Relationship to split v1

[task-agent-template-split-v1](./task-agent-template-split-v1.md) § Runtime lifecycle still says host bind uses `appendSystemPrompts: [agent.systemPrompt]`. **This spec supersedes that bind detail.** All other split invariants (Task without session, Agent 1:1 Session, template snapshot, playbook `templateId`, quiet skill rebind family) remain.

### Doc pointers

| Doc | Role |
|---|---|
| `CONTEXT.md` | Glossary: Role Prompt, Role Prompt Confirmation |
| `docs/adr/0004-agent-role-prompt-replaces-pi-base.md` | Decision authority |
| `docs/adr/0003-task-agent-template-split.md` | Agent/Template snapshot authority |
| This spec | Executable implementation + acceptance |

### Rejected alternatives (do not reopen)

- Keep append-only Agent blurbs after PI coding base  
- Dual-mode append\|replace flag in v1  
- Global product style harness (“be concise…”) forced beside questionnaire  
- Template editor / publish-back in the first knife  
- Storing confirmation as boolean only or content-hash (timestamp nullable is enough)

### Glossary reminder

Use **Role Prompt**, **Role Prompt Confirmation**, **Agent**, **Active Agent**, **Agent Template**, **PI Session** per `CONTEXT.md`. Avoid calling the editable field “full system prompt” or “append role blurb.”
