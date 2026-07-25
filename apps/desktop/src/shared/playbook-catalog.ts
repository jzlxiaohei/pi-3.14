import type {
  PlaybookTemplate,
  PlaybookTemplateStep,
  TaskPlaybookId,
  TaskWorkflow,
  TaskWorkflowStep,
} from "./desktop-contracts";

/**
 * System playbook seeds + helpers for stamping Task.workflow.
 * Runtime prefers DB PlaybookTemplate rows; seeds backfill insert-only + factory reset.
 */

export type PlaybookStepDef = {
  id: string;
  label: string;
  blurb: string;
  /** @deprecated use agentTemplateId — kept for call sites mid-migration */
  templateId: string;
  agentTemplateId: string;
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

function step(
  id: string,
  label: string,
  blurb: string,
  agentTemplateId: string,
  starterPrompt: string,
): PlaybookStepDef {
  return {
    id,
    label,
    blurb,
    agentTemplateId,
    templateId: agentTemplateId,
    starterPrompt,
  };
}

/**
 * Built-in path definitions (also SQLite insert-only seeds).
 * Methodology skills are suggested via starterPrompt, not forced mounts.
 */
export const PLAYBOOK_CATALOG: PlaybookDef[] = [
  {
    id: "feature-default",
    title: "普通功能，细节未清",
    description: "grill-with-docs → to-spec → implement",
    steps: [
      step(
        "grilling",
        "grill-with-docs",
        "把需求和边界问清楚，再往下走。",
        "tpl:feature-default/grilling",
        "/grill-with-docs\n\n帮我把这个功能的需求、约束和未决问题问清楚。",
      ),
      step(
        "to-spec",
        "to-spec",
        "把结论收成可执行规格，不再扩需求。",
        "tpl:feature-default/to-spec",
        "/to-spec\n\n根据以上讨论起草可执行规格；不要重新发散需求。",
      ),
      step(
        "implement",
        "implement",
        "按已定规格实现，不在实现阶段重开需求。",
        "tpl:feature-default/implement",
        "/implement\n\n按已定规格实现；实现阶段不要重新讨论需求。",
      ),
    ],
  },
  {
    id: "small-tdd",
    title: "小任务，路径清楚",
    description: "tdd → code-review",
    steps: [
      step(
        "tdd",
        "tdd",
        "小步 red-green-refactor，对准稳定接口。",
        "tpl:small-tdd/tdd",
        "/tdd\n\n按 TDD 完成这个小改动：一次一个 red-green-refactor 循环。",
      ),
      step(
        "code-review",
        "code-review",
        "对照改动做审查，抓回归与遗漏。",
        "tpl:small-tdd/code-review",
        "/code-review\n\n审查刚才的改动，指出风险与遗漏。",
      ),
    ],
  },
  {
    id: "bugfix",
    title: "修 bug",
    description: "diagnosing-bugs → tdd → code-review",
    steps: [
      step(
        "diagnosing-bugs",
        "diagnosing-bugs",
        "先定位根因，再改代码。",
        "tpl:bugfix/diagnosing-bugs",
        "/diagnosing-bugs\n\n帮我定位这个 bug 的根因，先别急着改。",
      ),
      step(
        "tdd",
        "tdd",
        "用失败测试锁根因，再修到绿灯。",
        "tpl:bugfix/tdd",
        "/tdd\n\n针对已定位的根因补测试并修复，走完 red-green-refactor。",
      ),
      step(
        "code-review",
        "code-review",
        "确认修复完整且无副作用。",
        "tpl:bugfix/code-review",
        "/code-review\n\n审查这次 bug 修复是否完整、有无回归风险。",
      ),
    ],
  },
];

/** Seed shape for SQLite insert-only / factory reset. */
export type SystemPlaybookSeed = {
  id: string;
  name: string;
  description: string;
  steps: PlaybookTemplateStep[];
};

export const SYSTEM_PLAYBOOK_SEEDS: SystemPlaybookSeed[] = PLAYBOOK_CATALOG.map((pb) => ({
  id: pb.id,
  name: pb.title,
  description: pb.description,
  steps: pb.steps.map((s) => ({
    id: s.id,
    label: s.label,
    blurb: s.blurb,
    agentTemplateId: s.agentTemplateId,
    starterPrompt: s.starterPrompt,
  })),
}));

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

export function catalogTemplateIdForStep(
  playbookId: string,
  stepId: string,
): string | null {
  return getStepDef(playbookId, stepId)?.agentTemplateId ?? null;
}

export function catalogStarterForStep(playbookId: string, stepId: string): string {
  return getStepDef(playbookId, stepId)?.starterPrompt ?? `/${stepId}`;
}

/** Stamp Task.workflow from a DB/runtime PlaybookTemplate row. */
export function createWorkflowFromPlaybookTemplate(
  playbook: Pick<PlaybookTemplate, "id" | "steps">,
): TaskWorkflow {
  if (!playbook.steps.length) {
    throw new Error(`Playbook ${playbook.id} has no steps`);
  }
  const steps: TaskWorkflowStep[] = playbook.steps.map((step, index) => ({
    id: step.id,
    status: index === 0 ? ("active" as const) : ("pending" as const),
    templateId: step.agentTemplateId,
    starterPrompt: step.starterPrompt,
    label: step.label,
  }));
  return {
    playbookId: playbook.id,
    stepId: playbook.steps[0]!.id,
    steps,
  };
}

/**
 * Build workflow from code catalog (tests / fallback when DB row missing).
 * Prefer createWorkflowFromPlaybookTemplate with a DB row in production.
 */
export function createWorkflowFromPlaybook(playbookId: TaskPlaybookId): TaskWorkflow {
  const playbook = getPlaybook(playbookId);
  return createWorkflowFromPlaybookTemplate({
    id: playbook.id,
    steps: playbook.steps.map((s) => ({
      id: s.id,
      label: s.label,
      blurb: s.blurb,
      agentTemplateId: s.agentTemplateId,
      starterPrompt: s.starterPrompt,
    })),
  });
}

export function normalizeWorkflowBindings(workflow: TaskWorkflow): TaskWorkflow {
  const steps = workflow.steps.map((step) => {
    const def = getStepDef(workflow.playbookId, step.id);
    const templateId =
      (typeof step.templateId === "string" && step.templateId.trim()) ||
      def?.agentTemplateId ||
      undefined;
    const starterPrompt =
      (typeof step.starterPrompt === "string" && step.starterPrompt.trim()) ||
      def?.starterPrompt ||
      undefined;
    const label =
      (typeof step.label === "string" && step.label.trim()) || def?.label || undefined;
    return {
      ...step,
      ...(templateId ? { templateId } : {}),
      ...(starterPrompt ? { starterPrompt } : {}),
      ...(label ? { label } : {}),
    };
  });
  return { ...workflow, steps };
}

export function resolveStepTemplateId(
  workflow: TaskWorkflow,
  stepId: string,
): string | null {
  const step = workflow.steps.find((s) => s.id === stepId);
  if (step?.templateId?.trim()) return step.templateId.trim();
  return catalogTemplateIdForStep(workflow.playbookId, stepId);
}

export function resolveStepStarter(workflow: TaskWorkflow, stepId: string): string {
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

export function normalizePlaybookSteps(
  steps: PlaybookTemplateStep[] | undefined,
): PlaybookTemplateStep[] {
  if (!steps?.length) {
    return [
      {
        id: "step-1",
        label: "步骤 1",
        blurb: "",
        agentTemplateId: "tpl:feature-default/implement",
        starterPrompt: "",
      },
    ];
  }
  const seen = new Set<string>();
  return steps.map((raw, index) => {
    let id = (raw.id ?? "").trim() || `step-${index + 1}`;
    if (seen.has(id)) id = `${id}-${index + 1}`;
    seen.add(id);
    return {
      id,
      label: (raw.label ?? "").trim() || id,
      blurb: (raw.blurb ?? "").trim(),
      agentTemplateId: (raw.agentTemplateId ?? "").trim(),
      starterPrompt: raw.starterPrompt ?? "",
    };
  });
}
