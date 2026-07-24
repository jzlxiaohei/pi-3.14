import type { TaskWorkflow } from "../../../../../shared/desktop-contracts";
import { getPlaybook } from "./playbooks";

/** One nested sidebar row under a Root Task with a playbook. */
export type WorkflowSidebarStepRow = {
  stepId: string;
  label: string;
  taskId?: string;
  /** True only when a Task/session is already bound — sidebar never creates. */
  clickable: boolean;
  /** done | skipped on the workflow step. */
  checked: boolean;
  /** True when this step’s Task is the Active Task (open session). */
  open: boolean;
};

/**
 * Project Root workflow + Active Task into sidebar step rows.
 * Order follows the playbook definition, not Task creation time.
 */
export function workflowSidebarSteps(
  workflow: TaskWorkflow | null | undefined,
  activeTaskId: string | null | undefined,
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
    const taskId = bound?.taskId;
    const hasTask = typeof taskId === "string" && taskId.length > 0;
    const status = bound?.status;
    return {
      stepId: def.id,
      label: def.label,
      ...(hasTask ? { taskId } : {}),
      clickable: hasTask,
      checked: status === "done" || status === "skipped",
      open: Boolean(hasTask && activeTaskId && taskId === activeTaskId),
    };
  });
}
