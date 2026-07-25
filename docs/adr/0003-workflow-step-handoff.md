---
status: accepted
---

# Workflow step handoff via forced summarization (option C)

## Context

ADR-0002 made each playbook step an independent Task/Session with its own `rolePrompt`. The first slice advanced steps by prefilling the next session with **only the last assistant bubble** (truncated). That drops questionnaire answers, multi-turn decisions, and tool conclusions, so later steps (e.g. to-spec) cannot reliably consume grilling outcomes.

## Decision

When the user marks a step **Done** and a next step exists:

1. **Before** creating the next step session, run a **dedicated handoff turn** on the **current** step session.
2. The handoff prompt is fixed/product-owned (per transition or generic). The model must output a **Step Handoff** document (structured Markdown), not continue product work.
3. The next step’s first user message is:
   - `## Handoff from previous step` + handoff body  
   - separator  
   - next step `starterPrompt`
4. **Skip** does not run the handoff LLM; next step opens with starter only (optional one-line note that the previous step was skipped).
5. If handoff generation fails (error/abort/empty), **do not advance**; surface an error so the user can retry Done.

This is **option C** from product discussion: forced summary round as the bridge between isolated step sessions. User-editable handoff review (option F) and durable JSON artifacts (option D) are non-goals of this ADR and may follow later.

## Handoff content expectations

At minimum the handoff should capture:

- Goal / problem statement for the remaining playbook  
- Confirmed decisions (including questionnaire answers)  
- Explicit non-goals / out-of-scope  
- Constraints (platform, compatibility, data ownership)  
- Open questions (if any)  
- Pointers useful to the next role (key files, ADRs, prior step task id)

It should **not** dump full tool transcripts or thinking.

## Consequences

- Every Done that opens a next step costs **one extra model turn** on the finishing session.
- Handoff quality depends on the model following the handoff prompt; templates can be tuned per playbook transition later.
- Skip remains a fast path with weaker context for the next step (by design).
- ADR-0002’s “optional short handoff from last assistant” is **superseded** for Done transitions.

## Implementation notes

- Renderer (or main) issues `session.prompt(handoffInstruction)` on the active step task, waits for the turn, then reads the latest assistant text as the handoff body.
- Strip incomplete/invalid questionnaire envelopes from handoff text if present; prefer plain Markdown sections.
- UI disables workflow Done/Skip while handoff is generating and shows progress copy.
