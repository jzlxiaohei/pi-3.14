import type {
  TaskPlaybookId,
  TaskWorkflow,
  TaskWorkflowStep,
} from "../../../../../shared/desktop-contracts";

export type PlaybookStepDef = {
  id: string;
  label: string;
  blurb: string;
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
 * Starters assume Matt engineering skills exist in the workspace (project-local
 * preferred; not vendored into PIE). Slash names match `mattpocock/skills`
 * engineering set (e.g. `/grill-with-docs`).
 */
export const PLAYBOOKS: PlaybookDef[] = [
  {
    id: "feature-default",
    title: "普通功能，细节未清",
    description: "grill-with-docs → to-spec → implement",
    steps: [
      {
        id: "grilling",
        label: "grill-with-docs",
        blurb: "把需求和边界问清楚，再往下走。",
        starterPrompt:
          "/grill-with-docs\n\n帮我把这个功能的需求、约束和未决问题问清楚。",
      },
      {
        id: "to-spec",
        label: "to-spec",
        blurb: "把结论收成可执行规格，不再扩需求。",
        starterPrompt: "/to-spec\n\n根据以上讨论起草可执行规格；不要重新发散需求。",
      },
      {
        id: "implement",
        label: "implement",
        blurb: "按已定规格实现，不在实现阶段重开需求。",
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
        starterPrompt: "/tdd\n\n按 TDD 完成这个小改动：一次一个 red-green-refactor 循环。",
      },
      {
        id: "code-review",
        label: "code-review",
        blurb: "对照改动做审查，抓回归与遗漏。",
        starterPrompt: "/code-review\n\n审查刚才的改动，指出风险与遗漏。",
      },
    ],
  },
  {
    id: "bugfix",
    title: "Bug 修复",
    description: "diagnosing-bugs → tdd → code-review",
    steps: [
      {
        id: "diagnosing-bugs",
        label: "diagnosing-bugs",
        blurb: "先定位根因，再改代码。",
        starterPrompt: "/diagnosing-bugs\n\n帮我定位这个 bug 的根因，先别急着改。",
      },
      {
        id: "tdd",
        label: "tdd",
        blurb: "用失败测试锁根因，再修到绿灯。",
        starterPrompt: "/tdd\n\n针对已定位的根因补测试并修复，走完 red-green-refactor。",
      },
      {
        id: "code-review",
        label: "code-review",
        blurb: "确认修复完整且无副作用。",
        starterPrompt: "/code-review\n\n审查这次 bug 修复是否完整、有无回归风险。",
      },
    ],
  },
];

export function getPlaybook(id: TaskPlaybookId): PlaybookDef {
  const found = PLAYBOOKS.find((item) => item.id === id);
  if (!found) throw new Error(`Unknown playbook: ${id}`);
  return found;
}

export function createWorkflow(playbookId: TaskPlaybookId): TaskWorkflow {
  const playbook = getPlaybook(playbookId);
  const steps: TaskWorkflowStep[] = playbook.steps.map((step, index) => ({
    id: step.id,
    status: index === 0 ? "active" : "pending",
  }));
  return {
    playbookId,
    stepId: steps[0]!.id,
    steps,
  };
}

export function workflowView(workflow: TaskWorkflow) {
  const playbook = getPlaybook(workflow.playbookId);
  const index = Math.max(
    0,
    playbook.steps.findIndex((step) => step.id === workflow.stepId),
  );
  const def = playbook.steps[index] ?? playbook.steps[0]!;
  const activeStatus = workflow.steps.find((step) => step.id === def.id)?.status;
  const completed =
    workflow.steps.length > 0 &&
    workflow.steps.every((step) => step.status === "done" || step.status === "skipped");
  return {
    playbook,
    stepDef: def,
    stepIndex: index,
    stepCount: playbook.steps.length,
    completed,
    isLast: index >= playbook.steps.length - 1,
    activeStatus,
  };
}

export function advanceWorkflow(
  workflow: TaskWorkflow,
  mode: "done" | "skipped",
): { workflow: TaskWorkflow; starterPrompt: string | null } {
  const playbook = getPlaybook(workflow.playbookId);
  const index = playbook.steps.findIndex((step) => step.id === workflow.stepId);
  if (index < 0) return { workflow, starterPrompt: null };

  const steps = workflow.steps.map((step) =>
    step.id === workflow.stepId ? { ...step, status: mode } : step,
  );

  const nextIndex = index + 1;
  if (nextIndex >= playbook.steps.length) {
    return {
      workflow: {
        ...workflow,
        stepId: workflow.stepId,
        steps,
      },
      starterPrompt: null,
    };
  }

  const next = playbook.steps[nextIndex]!;
  const nextSteps = steps.map((step) =>
    step.id === next.id ? { ...step, status: "active" as const } : step,
  );
  return {
    workflow: {
      playbookId: workflow.playbookId,
      stepId: next.id,
      steps: nextSteps,
    },
    starterPrompt: next.starterPrompt,
  };
}
