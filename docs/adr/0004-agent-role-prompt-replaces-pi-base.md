---
status: accepted
---

# Agent Role Prompt replaces PI default system base

## Context

Playbook steps are separate Agents with different jobs (grilling vs implement). PIE previously passed step text only via PI `appendSystemPrompt`, leaving PI’s default base — *“You are an expert coding assistant…”* — always in force. That fights non-coding roles. Users also need to edit each **Agent** instance’s role text (especially multi-step Tasks) without a Template editor in the first slice.

PI already supports replacing the default base (`customPrompt` / `systemPromptOverride`) while still attaching project context, skills, and cwd. Product-owned contracts (e.g. questionnaire protocol) must stay outside user-editable text.

## Decision

1. **`Agent.systemPrompt` is the Role Prompt (role base), not an append-only blurb.**
2. **Non-empty Role Prompt → replace** PI’s default coding system base when binding the host.
3. **Empty Role Prompt → fall back** to PI’s default coding base (ad-hoc Agents keep today’s behavior). UI must show that default and label it as default, never a blank editor with no explanation.
4. **Assemble with a fixed seam:**  
   `roleBase` + ordered **product appends** (v1: questionnaire only) + PI project_context + skills (skillPolicy) + cwd.  
   Role Prompt and product appends stay separate so future protocols extend the append list without entering the user editor.
5. **Instance customization (original first slice):** edit Active Agent Role Prompt, quiet rebind (same pattern as skill ignore), restore from Template snapshot source, new-Agent confirm banner. No publish-back, no custom playbook authoring, no protocol registry UI, no append|replace dual-mode flag. **Template library CRUD** is specified later in [ADR-0005](./0005-agent-templates-admin.md) and does not replace instance editing.

## Considered options

- **Append-only (status quo):** smallest change; rejected because non-coding steps keep a coding identity.
- **Dual-mode append|replace per Agent:** flexible; rejected for v1 as extra mental model while replace+empty-fallback covers ad-hoc and playbook.
- **Global thin harness forced by PIE (be concise, etc.):** rejected — those bullets belong in each role/seed text, not a second product layer beside questionnaire.

## Consequences

- System Template seeds must be rewritten as **minimal full role bases** (identity, goals, non-goals, style), not short appends that assume the PI coding opener.
- Host bind path must wire replace/fallback + product appends; Context UI should distinguish Role Prompt vs live assembled prompt.
- Editing Role Prompt does not rewrite history; rebind applies to subsequent turns (wait out an in-flight turn).
- ADR-0003’s snapshot isolation still holds: instance edits do not mutate Agent Templates unless a later publish-back feature is explicitly added.
