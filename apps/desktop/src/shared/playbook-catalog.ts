import type {
  TaskPlaybookId,
  TaskWorkflow,
  TaskWorkflowStep,
} from "./desktop-contracts";

/**
 * Single source of playbook defaults (step → template + starter).
 * Main and renderer both import this — do not duplicate maps in runtime-manager.
 *
 * Phase 1: code catalog. Later: persisted / editable catalog can replace this.
 */

export type PlaybookStepDef = {
  id: string;
  label: string;
  blurb: string;
  /** Default Agent Template id for this step. */
  templateId: string;
  /** Prefill for the composer when the step becomes active. */
  starterPrompt: string;
};

export type PlaybookDef = {
  id: TaskPlaybookId;
  title: string;
  description: string;
  steps: PlaybookStepDef[];
};

/** Prefill after one-click project install — user sends; do not auto-run. */
export const SETUP_MATT_SKILLS_PROMPT =
  "/setup-matt-pocock-skills\n\n请按步骤帮我配置本仓库的 engineering skills（issue tracker / triage / domain docs）。";

/**
 * Starters assume Matt engineering skills exist in the workspace.
 * Role text lives on Agent Templates (thin boundaries / empty → PI default).
 */
export const PLAYBOOK_CATALOG: PlaybookDef[] = [
  {
    id: "feature-default",
    title: "普通功能，细节未清",
    description: "grill-with-docs → to-spec → implement",
    steps: [
      {
        id: "grilling",
        label: "grill-with-docs",
        blurb: "把需求和边界问清楚，再往下走。",
        templateId: "tpl:feature-default/grilling",
        starterPrompt:
          "/grill-with-docs\n\n帮我把这个功能的需求、约束和未决问题问清楚。",
      },
      {
        id: "to-spec",
        label: "to-spec",
        blurb: "把结论收成可执行规格，不再扩需求。",
        templateId: "tpl:feature-default/to-spec",
        starterPrompt: "/to-spec\n\n根据以上讨论起草可执行规格；不要重新发散需求。",
      },
      {
        id: "implement",
        label: "implement",
        blurb: "按已定规格实现，不在实现阶段重开需求。",
        templateId: "tpl:feature-default/implement",
        starterPrompt: "/implement\n\n按已定规格实现；实现阶段不要重新讨论需求。",
      },
    ],
  },
  {
    id: "small-tdd",
    title: "小任务，路径清楚",
    description: "tdd → code-review",
    steps: [
      {
        id: "tdd",
        label: "tdd",
        blurb: "小步 red-green-refactor，对准稳定接口。",
        templateId: "tpl:small-tdd/tdd",
        starterPrompt:
          "/tdd\n\n按 TDD 完成这个小改动：一次一个 red-green-refactor 循环。",
      },
      {
        id: "code-review",
        label: "code-review",
        blurb: "对照改动做审查，抓回归与遗漏。",
        templateId: "tpl:small-tdd/code-review",
        starterPrompt: "/code-review\n\n审查刚才的改动，指出风险与遗漏。",
      },
    ],
  },
  {
    id: "bugfix",
    title: "修 bug",
    description: "diagnosing-bugs → tdd → code-review",
    steps: [
      {
        id: "diagnosing-bugs",
        label: "diagnosing-bugs",
        blurb: "先定位根因，再改代码。",
        templateId: "tpl:bugfix/diagnosing-bugs",
        starterPrompt: "/diagnosing-bugs\n\n帮我定位这个 bug 的根因，先别急着改。",
      },
      {
        id: "tdd",
        label: "tdd",
        blurb: "用失败测试锁根因，再修到绿灯。",
        templateId: "tpl:bugfix/tdd",
        starterPrompt:
          "/tdd\n\n针对已定位的根因补测试并修复，走完 red-green-refactor。",
      },
      {
        id: "code-review",
        label: "code-review",
        blurb: "确认修复完整且无副作用。",
        templateId: "tpl:bugfix/code-review",
        starterPrompt: "/code-review\n\n审查这次 bug 修复是否完整、有无回归风险。",
      },
    ],
  },
];

export function getPlaybook(id: TaskPlaybookId | string): PlaybookDef {
  const found = PLAYBOOK_CATALOG.find((playbook) => playbook.id === id);
  if (!found) throw new Error(`Unknown playbook: ${id}`);
  return found;
}

export function getStepDef(
  playbookId: TaskPlaybookId | string,
  stepId: string,
): PlaybookStepDef | null {
  try {
    return getPlaybook(playbookId).steps.find((step) => step.id === stepId) ?? null;
  } catch {
    return null;
  }
}

/** Catalog default template id for a playbook step (not the Task instance binding). */
export function catalogTemplateIdForStep(
  playbookId: string,
  stepId: string,
): string | null {
  return getStepDef(playbookId, stepId)?.templateId ?? null;
}

/** Catalog default starter for a playbook step. */
export function catalogStarterForStep(playbookId: string, stepId: string): string {
  return getStepDef(playbookId, stepId)?.starterPrompt ?? `/${stepId}`;
}

/**
 * Build a Task workflow shell: every step stamped with templateId + starterPrompt.
 * No Agents yet — binding materializes on ensureStepAgent.
 */
export function createWorkflowFromPlaybook(playbookId: TaskPlaybookId): TaskWorkflow {
  const playbook = getPlaybook(playbookId);
  const steps: TaskWorkflowStep[] = playbook.steps.map((step, index) => ({
    id: step.id,
    status: index === 0 ? ("active" as const) : ("pending" as const),
    templateId: step.templateId,
    starterPrompt: step.starterPrompt,
  }));
  return {
    playbookId,
    stepId: playbook.steps[0]!.id,
    steps,
  };
}

/**
 * Fill missing templateId / starterPrompt from the catalog (legacy Task.workflow JSON).
 * Does not overwrite existing stamps (per-task rebind wins).
 */
export function normalizeWorkflowBindings(workflow: TaskWorkflow): TaskWorkflow {
  const steps = workflow.steps.map((step) => {
    const def = getStepDef(workflow.playbookId, step.id);
    const templateId =
      (typeof step.templateId === "string" && step.templateId.trim()) ||
      def?.templateId ||
      undefined;
    const starterPrompt =
      (typeof step.starterPrompt === "string" && step.starterPrompt.trim()) ||
      def?.starterPrompt ||
      undefined;
    return {
      ...step,
      ...(templateId ? { templateId } : {}),
      ...(starterPrompt ? { starterPrompt } : {}),
    };
  });
  return { ...workflow, steps };
}

/** Resolve the template id to use for ensure (step stamp, then catalog). */
export function resolveStepTemplateId(
  workflow: TaskWorkflow,
  stepId: string,
): string | null {
  const step = workflow.steps.find((s) => s.id === stepId);
  if (step?.templateId?.trim()) return step.templateId.trim();
  return catalogTemplateIdForStep(workflow.playbookId, stepId);
}

/** Resolve starter prefill for a step (instance stamp, then catalog). */
export function resolveStepStarter(
  workflow: TaskWorkflow,
  stepId: string,
): string {
  const step = workflow.steps.find((s) => s.id === stepId);
  if (step?.starterPrompt?.trim()) return step.starterPrompt.trim();
  return catalogStarterForStep(workflow.playbookId, stepId);
}

export function buildHandoffPrefill(
  starter: string,
  handoff?: string | null,
): string {
  const block = handoff?.trim()
    ? `## Handoff from previous step\n\n${handoff.trim()}\n\n---\n\n`
    : "";
  return `${block}${starter}`;
}

/**
 * Forced handoff turn on the current step session before Next (Done).
 * ADR-0003 option C.
 */
export const STEP_HANDOFF_PROMPT = [
  "Stop product work for this step.",
  "Write a **Step Handoff** document in Markdown for the *next* playbook step only.",
  "Use these sections (omit a section only if truly empty):",
  "",
  "## Goal",
  "## Confirmed decisions",
  "## Non-goals / out of scope",
  "## Constraints",
  "## Open questions",
  "## Notes for next step",
  "",
  "Rules:",
  "- Capture questionnaire answers and multi-turn decisions, not just the last reply.",
  "- Be concise and structured; no full tool transcripts or thinking dumps.",
  "- Do not implement code or continue the prior task.",
  "- Output only the handoff Markdown (no preamble).",
].join("\n");
