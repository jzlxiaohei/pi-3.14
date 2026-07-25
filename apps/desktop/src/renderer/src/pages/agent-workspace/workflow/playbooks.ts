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
  // Prefer stamped instance steps; fall back to code catalog for legacy system ids.
  let playbook: PlaybookDef;
  try {
    playbook = getPlaybook(workflow.playbookId);
  } catch {
    playbook = {
      id: workflow.playbookId,
      title: workflow.playbookId,
      description: "",
      steps: workflow.steps.map((s) => ({
        id: s.id,
        label: s.label ?? s.id,
        blurb: "",
        templateId: s.templateId ?? "",
        agentTemplateId: s.templateId ?? "",
        starterPrompt: s.starterPrompt ?? "",
      })),
    };
  }
  const stepIndex = Math.max(
    0,
    workflow.steps.findIndex((step) => step.id === workflow.stepId),
  );
  const bound = workflow.steps[stepIndex] ?? workflow.steps[0];
  const catalogStep =
    playbook.steps.find((s) => s.id === bound?.id) ?? playbook.steps[stepIndex] ?? playbook.steps[0];
  const stepDef: PlaybookStepDef = {
    id: bound?.id ?? catalogStep?.id ?? "step",
    label: bound?.label ?? catalogStep?.label ?? bound?.id ?? "step",
    blurb: catalogStep?.blurb ?? "",
    templateId: bound?.templateId ?? catalogStep?.agentTemplateId ?? "",
    agentTemplateId: bound?.templateId ?? catalogStep?.agentTemplateId ?? "",
    starterPrompt: bound?.starterPrompt ?? catalogStep?.starterPrompt ?? "",
  };
  const completed = workflow.steps.every(
    (step) => step.status === "done" || step.status === "skipped",
  );
  const stepCount = Math.max(workflow.steps.length, playbook.steps.length, 1);
  return {
    playbook: {
      ...playbook,
      title: playbook.title || workflow.playbookId,
    },
    stepDef,
    stepTemplateId: stepDef.agentTemplateId,
    stepStarter: stepDef.starterPrompt,
    stepIndex,
    stepCount,
    isLast: stepIndex >= stepCount - 1,
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
