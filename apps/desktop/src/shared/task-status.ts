import type { Agent, AgentStatus, Task, TaskStatus, TaskWorkflow } from "./desktop-contracts";

/**
 * Pure Task Status rollup (spec §Task Status algorithm).
 * Execution authority remains Agent Status.
 */
export function rollupTaskStatus(
  task: Pick<Task, "status"> & { workflow?: TaskWorkflow },
  agents: Array<Pick<Agent, "status">>,
): TaskStatus {
  if (agents.some((agent) => agent.status === "running")) return "running";
  if (agents.some((agent) => agent.status === "error")) return "error";
  if (task.workflow && allStepsTerminal(task.workflow)) return "done";
  if (agents.some((agent) => agent.status === "interrupted")) return "interrupted";
  return "idle";
}

function allStepsTerminal(workflow: TaskWorkflow): boolean {
  if (workflow.steps.length === 0) return false;
  return workflow.steps.every((step) => step.status === "done" || step.status === "skipped");
}

export function isAgentStatus(value: unknown): value is AgentStatus {
  return (
    value === "idle" ||
    value === "running" ||
    value === "done" ||
    value === "error" ||
    value === "interrupted"
  );
}
