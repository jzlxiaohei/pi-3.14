# PIE Workspace

PIE organizes durable code-agent work while leaving PI responsible for the conversation sessions it creates and maintains.

## Language

**Task**:
A durable unit of work owned by PIE and shown to the user (sidebar, archive, ordering). A Task orchestrates work through Agents and workflow metadata; it does not own a PI Session.
_Avoid_: Chat, job, session, agent

**Active Task**:
The Task the user is currently working within. The sidebar highlights this Task while an Agent under it may hold the open PI Session.
_Avoid_: Selected Session

**Agent**:
An executable actor owned by PIE, bound one-to-one with a PI Session. An Agent carries the instance snapshot used to run (Role Prompt, skill policy, input/output context, role-prompt confirmation) and may form a parent/child generation tree under a Task.
_Avoid_: Task, chat, tool call

**Agent Template**:
A reusable Agent definition (name, optional library description, Role Prompt, skill policy, provenance `system` | `user`, and later defaults such as model or tools). Concrete Agents are instantiated from a Template and keep their own snapshot so edits do not mutate the Template. Library description is UI metadata only (not part of the Agent snapshot). System templates are product-seeded and may be customized or reset; user templates are user-authored.
_Avoid_: Skill, playbook (a playbook composes templates into steps; it is not itself a template)

**Role Prompt**:
The Agent- or Template-owned identity and instructions used as the system **role base**. When non-empty it replaces PI’s default coding-assistant system base; when empty, PI’s default base is used. It is not the final live system prompt (product appends, project context, skills, and cwd are assembled around it).
_Avoid_: Full system prompt, append-only role blurb, workflow `rolePrompt`, live assembled prompt

**Role Prompt Confirmation**:
Whether the user has acknowledged the Agent’s current Role Prompt for that instance (for first-run guidance). Confirmation is per Agent and does not change the Role Prompt text itself.
_Avoid_: Tool approval, permission grant

**Active Agent**:
The Agent whose PI Session is currently open and bound to the runtime host.
_Avoid_: Active Task, selected session

**Agent Tree**:
The generation lineage of Agents under a Task (and across delegated children). Every child Agent has exactly one parent Agent, so lineage is a tree rather than a dependency graph.
_Avoid_: Dependency graph, workflow graph, task tree

**Subagent**:
The act of delegating work by spawning a child Agent with its own PI Session. Persisted delegated work is a child Agent, not a separate entity type.
_Avoid_: Child process, background thread, Child Task

**PI Session**:
The PI-managed conversation and execution history that is the source of truth for messages, tool calls, branches, and summaries. PIE references it from an Agent but does not treat application metadata as part of it.
_Avoid_: Task, Agent, transcript copy

**Session Availability**:
Whether the PI Session belonging to an Agent can currently be found and opened. Availability is separate from Agent Status.
_Avoid_: Task status, agent status

**Agent Status**:
The latest execution condition of an Agent: idle, running, done, error, or interrupted. Interrupted means execution ended without a recorded normal completion or explicit error.
_Avoid_: Session availability

**Task Status**:
A Task-level rollup or shell condition for user-facing lists. It is not a substitute for per-Agent Status and is not taken from a Task-owned Session (Tasks have none).
_Avoid_: Session availability

**Archive**:
A reversible PIE state that hides a Task and its Agents from the default workspace without deleting PI Session files.
_Avoid_: Delete, purge

**Preference**:
PIE-owned user interface state expected to survive application restarts, scoped globally, to a workspace, to a Task, or to an Agent (for example composer draft on the Active Agent).
_Avoid_: PI setting
