import type { Agent, TaskWorkflow } from "../../../../../shared/desktop-contracts";
import { getPlaybook } from "./playbooks";

/** One nested sidebar row under a Task with a playbook. */
export type WorkflowSidebarStepRow = {
  stepId: string;
  label: string;
  /** Agent Template id this step binds (instance stamp or catalog default). */
  templateId?: string;
  agentId?: string;
  /** True only when an Agent is already bound — sidebar never creates. */
  clickable: boolean;
  /** done | skipped on the workflow step. */
  checked: boolean;
  /** True when this step’s Agent is the Active Agent (open session). */
  open: boolean;
};

/**
 * Project Task workflow + Active Agent into sidebar step rows.
 * Order follows the playbook definition. View ≠ playbook cursor.
 */
export function workflowSidebarSteps(
  workflow: TaskWorkflow | null | undefined,
  activeAgentId: string | null | undefined,
): WorkflowSidebarStepRow[] {
  if (!workflow) return [];

  let playbook;
  try {
    playbook = getPlaybook(workflow.playbookId);
  } catch {
    return [];
  }

  const byId = new Map(workflow.steps.map((step) => [step.id, step]));

  return playbook.steps.map((def) => {
    const bound = byId.get(def.id);
    const agentId = bound?.agentId;
    const hasAgent = typeof agentId === "string" && agentId.length > 0;
    const status = bound?.status;
    const templateId = bound?.templateId ?? def.templateId;
    return {
      stepId: def.id,
      label: def.label,
      templateId,
      ...(hasAgent ? { agentId } : {}),
      clickable: hasAgent,
      checked: status === "done" || status === "skipped",
      open: Boolean(hasAgent && activeAgentId && agentId === activeAgentId),
    };
  });
}

/**
 * Fallback when playbook shell was cleared: still list Agents under the Task
 * so prior step sessions remain reachable.
 */
export function agentSidebarRows(
  agents: Agent[] | null | undefined,
  activeAgentId: string | null | undefined,
): WorkflowSidebarStepRow[] {
  if (!agents?.length) return [];
  return agents.map((agent, index) => ({
    stepId: agent.id,
    label: agent.name?.trim() || `Agent ${index + 1}`,
    agentId: agent.id,
    clickable: true,
    checked: agent.status === "done",
    open: Boolean(activeAgentId && agent.id === activeAgentId),
  }));
}

/** Prefer playbook step rows; if no workflow, fall back to agent list. */
export function taskNestedSidebarRows(
  workflow: TaskWorkflow | null | undefined,
  agents: Agent[] | null | undefined,
  activeAgentId: string | null | undefined,
): WorkflowSidebarStepRow[] {
  if (workflow) return workflowSidebarSteps(workflow, activeAgentId);
  return agentSidebarRows(agents, activeAgentId);
}
