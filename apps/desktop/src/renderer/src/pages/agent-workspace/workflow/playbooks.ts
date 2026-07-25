/**
 * Renderer playbook helpers — definitions live in shared/playbook-catalog
 * so main ensure/create use the same stamps.
 */
import type {
  TaskPlaybookId,
  TaskWorkflow,
  TaskWorkflowStep,
} from "../../../../../shared/desktop-contracts";
import {
  PLAYBOOK_CATALOG,
  SETUP_MATT_SKILLS_PROMPT,
  STEP_HANDOFF_PROMPT,
  buildHandoffPrefill,
  createWorkflowFromPlaybook,
  getPlaybook,
  getStepDef,
  type PlaybookDef,
  type PlaybookStepDef,
} from "../../../../../shared/playbook-catalog";
import { templateIdForPlaybookStep } from "../../../../../shared/playbook-templates";

export type { PlaybookDef, PlaybookStepDef };
export {
  PLAYBOOK_CATALOG as PLAYBOOKS,
  SETUP_MATT_SKILLS_PROMPT,
  STEP_HANDOFF_PROMPT,
  buildHandoffPrefill,
  getPlaybook,
  getStepDef,
  templateIdForPlaybookStep,
};

/** @deprecated use createWorkflowFromPlaybook — stamps templateId on every step. */
export function createWorkflow(playbookId: TaskPlaybookId): TaskWorkflow {
  return createWorkflowFromPlaybook(playbookId);
}

export function workflowView(workflow: TaskWorkflow) {
  const playbook = getPlaybook(workflow.playbookId);
  const stepIndex = playbook.steps.findIndex((step) => step.id === workflow.stepId);
  const stepDef = stepIndex >= 0 ? playbook.steps[stepIndex]! : playbook.steps[0]!;
  const bound = workflow.steps.find((s) => s.id === stepDef.id);
  const completed = workflow.steps.every(
    (step) => step.status === "done" || step.status === "skipped",
  );
  return {
    playbook,
    stepDef,
    /** Instance binding (may differ from catalog after per-task rebind). */
    stepTemplateId: bound?.templateId ?? stepDef.templateId,
    stepStarter: bound?.starterPrompt ?? stepDef.starterPrompt,
    stepIndex: Math.max(0, stepIndex),
    stepCount: playbook.steps.length,
    isLast: stepIndex >= playbook.steps.length - 1,
    completed,
  };
}

export function advanceWorkflow(
  workflow: TaskWorkflow,
  mode: "done" | "skipped",
): { workflow: TaskWorkflow; starterPrompt: string | null; nextStepDef: PlaybookStepDef | null } {
  const playbook = getPlaybook(workflow.playbookId);
  const index = playbook.steps.findIndex((step) => step.id === workflow.stepId);
  if (index < 0) return { workflow, starterPrompt: null, nextStepDef: null };

  const steps = workflow.steps.map((step) =>
    step.id === workflow.stepId ? { ...step, status: mode } : step,
  );
  const nextIndex = index + 1;
  if (nextIndex >= playbook.steps.length) {
    return {
      workflow: {
        ...workflow,
        steps,
      },
      starterPrompt: null,
      nextStepDef: null,
    };
  }

  const next = playbook.steps[nextIndex]!;
  const nextSteps = steps.map((step) => {
    if (step.id !== next.id) return step;
    // Preserve instance templateId if already stamped; fill from catalog if missing.
    return {
      ...step,
      status: "active" as const,
      templateId: step.templateId ?? next.templateId,
      starterPrompt: step.starterPrompt ?? next.starterPrompt,
    };
  });
  // Ensure next step exists on the instance array (legacy shells).
  let ensured = nextSteps;
  if (!ensured.some((s) => s.id === next.id)) {
    const insert: TaskWorkflowStep = {
      id: next.id,
      status: "active",
      templateId: next.templateId,
      starterPrompt: next.starterPrompt,
    };
    ensured = [...nextSteps, insert];
  }
  const nextBound = ensured.find((s) => s.id === next.id);
  return {
    workflow: {
      playbookId: workflow.playbookId,
      stepId: next.id,
      steps: ensured,
    },
    starterPrompt: nextBound?.starterPrompt ?? next.starterPrompt,
    nextStepDef: next,
  };
}

/** Compose handoff context + step starter for a new step session. */
export function buildStepOpenPrompt(
  step: PlaybookStepDef | { starterPrompt: string },
  handoff?: string | null,
): string {
  return buildHandoffPrefill(step.starterPrompt, handoff);
}
